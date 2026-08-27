// MirrorPin webapp 页面逻辑（index / generating / result / error）。
// 浏览器纯本地：IndexedDB 中转图片与结果，不经过任何服务器。
import {
  generateForBoard,
  BOARD_PRESETS,
  renderPatternImage,
  countGridMaterials,
} from './algo.mjs';

// ---------------------------------------------------------------------------
// IndexedDB KV 小助手（零依赖）
// ---------------------------------------------------------------------------
const DB_NAME = 'mirrorpin-webapp';
const DB_STORE = 'kv';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---------------------------------------------------------------------------
// 参数收集（index 页）
// ---------------------------------------------------------------------------
function val(selector) {
  const el = document.querySelector(selector);
  return el ? el.value : undefined;
}
function checked(selector) {
  const el = document.querySelector(selector);
  return el ? el.checked : false;
}
function toggleOn(id) {
  const el = document.getElementById(id);
  return el ? el.getAttribute('aria-checked') === 'true' : false;
}
function numVal(id) {
  const el = document.getElementById(id);
  const v = el ? el.value.trim() : '';
  return v === '' ? undefined : Number(v);
}

const SMOOTH_MAP = {
  l0: { smooth: 'l0', smoothLambda: 0.02 },
  weak: { smooth: 'l0', smoothLambda: 0.005 },
  guided: { smooth: 'guided', smoothEps: 100, smoothRadius: 8 },
  gaussian: { smooth: 'gauss', smoothSigma: 1 },
  off: { smooth: 'none' },
};

function collectParams() {
  const complexity = checked('input[name="complexity"]:checked')
    ? document.querySelector('input[name="complexity"]:checked').value
    : 'standard';
  const minBeads = { standard: 0, less: 5, minimal: 10 }[complexity] ?? 0;
  const smoothSel = document.querySelector('input[name="smooth"]:checked');
  const smoothKey = smoothSel ? smoothSel.value : 'l0';
  const scaleSel = document.querySelector('input[name="scale"]:checked');
  const scaleKey = scaleSel ? scaleSel.value : 'dpid';

  return {
    board: val('input[name="board-preset"]:checked') || '78x78',
    palette: val('#palette-select') || 'mard221',
    minBeads,
    removeBg: toggleOn('remove-bg-toggle'),
    advanced: {
      ...(SMOOTH_MAP[smoothKey] ?? SMOOTH_MAP.l0),
      scale: scaleKey,
      maxColors: numVal('max-colors'),
      dither: toggleOn('dither-toggle'),
      despeckle: toggleOn('despeckle-toggle'),
      renderCell: numVal('render-cell') ?? 40,
      renderBoard: numVal('render-board') ?? 29,
      backgroundTolerance: numVal('bg-tolerance') ?? 12,
    },
  };
}

// ---------------------------------------------------------------------------
// 浏览器解码
// ---------------------------------------------------------------------------
async function decodeImage(blob) {
  const bmp = await createImageBitmap(blob);
  const { width, height } = bmp;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  const data = ctx.getImageData(0, 0, width, height).data;
  bmp.close();
  return { width, height, data: new Uint8ClampedArray(data) };
}

// ---------------------------------------------------------------------------
// 页面：index
// ---------------------------------------------------------------------------
function bootIndex() {
  const fileInput = document.getElementById('upload-input');
  const generateCta = document.getElementById('generate-cta');
  if (!generateCta) return;

  // 设计稿已处理上传 UI；这里补齐真实文件名/尺寸显示
  fileInput?.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    const nameEl = document.querySelector('#upload-filled p.truncate');
    const sizeEl = document.querySelector('#upload-filled p.text-xs');
    if (nameEl) nameEl.textContent = f.name;
    if (sizeEl) {
      const img = new Image();
      img.onload = () => { sizeEl.textContent = `${img.naturalWidth} × ${img.naturalHeight} px`; };
      img.src = URL.createObjectURL(f);
    }
  });

  // 恢复上次已上传的图片（从 IDB），让“返回修改参数”后可直接重生成
  (async () => {
    const prev = await idbGet('img');
    if (!prev) return;
    const nameEl = document.querySelector('#upload-filled p.truncate');
    const sizeEl = document.querySelector('#upload-filled p.text-xs');
    if (nameEl) nameEl.textContent = prev.name;
    const imgEl = new Image();
    imgEl.onload = () => { if (sizeEl) sizeEl.textContent = `${imgEl.naturalWidth} × ${imgEl.naturalHeight} px`; };
    imgEl.src = URL.createObjectURL(prev.blob);
  })();

  generateCta.addEventListener('click', async () => {
    const f = fileInput.files?.[0];
    const prev = await idbGet('img');
    if (!f && !prev) return; // 无图不生成（按钮本已禁用，双保险）
    const blob = f ? f : prev.blob;
    const name = f ? f.name : prev.name;
    try {
      await idbPut('img', { name, type: blob.type, blob });
      await idbPut('params', collectParams());
      location.href = './generating.html';
    } catch (e) {
      await idbPut('error', String(e && e.message ? e.message : e));
      location.href = './error.html';
    }
  });
}

// ---------------------------------------------------------------------------
// 页面：generating
// ---------------------------------------------------------------------------
function bootGenerating() {
  const summary = document.querySelector('[data-region="loading"] .mirrorpin-mono');
  const cancel = document.getElementById('cancel-generate');
  let worker = null;

  const fail = async (msg) => {
    await idbPut('error', String(msg));
    location.href = './error.html';
  };

  // 取消：跳回 index（worker 随页面卸载终止，结果丢弃）
  cancel?.addEventListener('click', () => {
    if (worker) worker.terminate();
    location.href = './index.html';
  });

  (async () => {
    const img = await idbGet('img');
    const params = (await idbGet('params')) ?? {};
    if (!img) {
      await fail('未找到上传的图片，请返回重新选择。');
      return;
    }
    const spec = BOARD_PRESETS[params.board] ?? BOARD_PRESETS['78x78'];
    if (summary) {
      summary.textContent = `${spec.label.split('（')[0]} · ${params.palette === 'mard291' ? 'MARD 291' : 'MARD 221'} · ${params.minBeads ? '合并' : '标准'} · ${params.removeBg ? '抠白底' : '保留背景'}`;
    }
    try {
      // 解码在主线程（快）；生成计算移入 Web Worker，动画全程流畅
      const rgba = await decodeImage(img.blob);
      worker = new Worker(new URL('./algo.worker.mjs', import.meta.url), { type: 'module' });
      const result = await new Promise((resolve, reject) => {
        worker.onmessage = (e) => {
          if (e.data.type === 'done') resolve(e.data);
          else reject(new Error(e.data.message));
        };
        worker.onerror = (e) => reject(new Error(e.message || 'worker error'));
        worker.postMessage(
          { type: 'generate', img: { width: rgba.width, height: rgba.height, data: rgba.data }, params },
          [rgba.data.buffer], // transferable 零拷贝
        );
      });
      worker.terminate();
      worker = null;
      await idbPut('grid', result.grid);
      await idbPut('meta', {
        name: img.name.replace(/\.[^.]+$/, ''),
        board: params.board,
        palette: params.palette,
        renderCell: params.advanced?.renderCell ?? 40,
        renderBoard: params.advanced?.renderBoard ?? 29,
        elapsedMs: result.elapsedMs,
      });
      location.href = './result.html';
    } catch (e) {
      if (worker) { worker.terminate(); worker = null; }
      await fail(e && e.message ? e.message : e);
    }
  })();
}

// ---------------------------------------------------------------------------
// 页面：result
// ---------------------------------------------------------------------------
function fmt(n) {
  return Number(n).toLocaleString('zh-CN');
}
function fmtMs(ms) {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function canvasFromRgba(rgba) {
  const canvas = document.createElement('canvas');
  canvas.width = rgba.width;
  canvas.height = rgba.height;
  canvas.getContext('2d').putImageData(
    new ImageData(new Uint8ClampedArray(rgba.data), rgba.width, rgba.height),
    0,
    0,
  );
  return canvas;
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.download = filename;
  a.href = URL.createObjectURL(blob);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function bootResult() {
  (async () => {
    const grid = await idbGet('grid');
    const meta = (await idbGet('meta')) ?? {};
    if (!grid) {
      await idbPut('error', '没有可展示的图纸，请重新生成。');
      location.href = './error.html';
      return;
    }

    const materials = countGridMaterials(grid);
    const total = materials.reduce((s, m) => s + m.count, 0);
    const paletteLabel = meta.palette === 'mard291' ? 'MARD 291' : 'MARD 221';
    const cell = meta.renderCell ?? 40;
    const board = meta.renderBoard ?? 29;

    // 信息条
    const infoBar = document.querySelector('[data-region="info-bar"] p');
    if (infoBar) {
      infoBar.innerHTML = `
        <i data-lucide="info" class="h-4 w-4 text-primary"></i>
        <span class="mirrorpin-mono font-medium text-foreground">${grid.cols} × ${grid.rows}</span><span>格</span>
        <span class="text-border">·</span>
        <span class="mirrorpin-mono font-medium text-foreground">${materials.length}</span><span>色</span>
        <span class="text-border">·</span><span>合计</span>
        <span class="mirrorpin-mono font-medium text-foreground">${fmt(total)}</span><span>豆</span>
        <span class="text-border">·</span><span>色卡</span>
        <span class="font-medium text-foreground">${paletteLabel}</span>
        ${meta.elapsedMs ? `<span class="text-border">·</span><span>用时</span><span class="mirrorpin-mono font-medium text-foreground">${fmtMs(meta.elapsedMs)}</span>` : ''}`;
      if (window.lucide) lucide.createIcons();
    }

    // 图纸预览（替换占位 SVG）
    const svg = document.querySelector('#pattern-preview svg');
    if (svg) {
      // 预览用小 cell 便捷查看，坐标/色号关闭以保证可读
      const previewCell = Math.max(6, Math.min(16, Math.floor(600 / grid.cols)));
      const rgba = renderPatternImage(grid, {
        cell: previewCell,
        board,
        gutter: previewCell * 2,
        showCodes: false,
        showCoords: false,
      });
      const cv = canvasFromRgba(rgba);
      cv.style.maxWidth = '100%';
      cv.style.height = 'auto';
      svg.replaceWith(cv);
    }

    // 材料清单表
    const tbody = document.querySelector('#material-list tbody');
    const tfootNum = document.querySelector('#material-list tfoot .mirrorpin-mono');
    if (tbody) {
      tbody.innerHTML = materials
        .map(
          (m) => `<tr>
            <td class="py-2.5 font-medium">${m.code}</td>
            <td class="py-2.5"><span class="inline-block h-5 w-5 rounded-sm border border-border" style="background-color:#${m.hex}"></span></td>
            <td class="py-2.5 text-right mirrorpin-mono">${fmt(m.count)}</td>
          </tr>`,
        )
        .join('');
    }
    if (tfootNum) tfootNum.textContent = fmt(total);

    // 下载 PNG
    const pngBtn = document.getElementById('download-png');
    pngBtn?.addEventListener('click', () => {
      const rgba = renderPatternImage(grid, { cell, board, showCodes: true, showCoords: true });
      const cv = canvasFromRgba(rgba);
      cv.toBlob((b) => downloadBlob(b, `${meta.name || 'pattern'}_pattern.png`), 'image/png');
    });

    // 下载 CSV
    const csvBtn = document.getElementById('download-csv');
    csvBtn?.addEventListener('click', () => {
      const rows = ['code,hex,count', ...materials.map((m) => `${m.code},#${m.hex},${m.count}`)];
      downloadBlob(new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' }), `${meta.name || 'pattern'}_materials.csv`);
    });
  })();
}

// ---------------------------------------------------------------------------
// 页面：error
// ---------------------------------------------------------------------------
function bootError() {
  (async () => {
    const msg = await idbGet('error');
    const target = document.querySelector('.mirrorpin-body') ?? document.querySelector('main p');
    if (target && msg) target.textContent = msg;
  })();
}

// ---------------------------------------------------------------------------
// 入口：按页面分支
// ---------------------------------------------------------------------------
const page = location.pathname.split('/').pop() || 'index.html';
if (page.includes('result')) bootResult();
else if (page.includes('generating')) bootGenerating();
else if (page.includes('error')) bootError();
else bootIndex();