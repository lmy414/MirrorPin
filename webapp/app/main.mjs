import {
  ALGORITHM_VERSION,
  BOARD_PRESETS,
  countGridMaterials,
  renderPatternImage,
  resolveQualityProfile,
} from './algo.mjs';
import {
  PARAMS_SCHEMA_VERSION,
  normalizeSavedFormState,
  parseOptionalPositiveInteger,
} from './params.mjs';

const DB_NAME = 'mirrorpin-webapp';
const DB_STORE = 'kv';
const DB_VERSION = 2;
const STAGE_LABELS = {
  prepare: '准备图片与前景', resample: '重采样到拼豆网格', candidates: '计算候选色',
  optimize: '空间颜色优化', cleanup: '清理小区域与颜色预算', done: '生成完成',
};

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE); };
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
function val(selector) { return document.querySelector(selector)?.value; }
function checked(selector) { return Boolean(document.querySelector(selector)?.checked); }
function toggleOn(id) { return document.getElementById(id)?.getAttribute('aria-checked') === 'true'; }
function numVal(id) {
  const raw = document.getElementById(id)?.value?.trim() ?? '';
  return raw === '' ? undefined : Number(raw);
}
function positiveIntVal(id) {
  return parseOptionalPositiveInteger(document.getElementById(id)?.value);
}
function mergeAdvanced(base, override) {
  return { ...base, ...override, spatial: { ...(base?.spatial ?? {}), ...(override?.spatial ?? {}) } };
}
const SMOOTH_MAP = {
  l0: { smooth: 'l0', smoothLambda: 0.02 }, weak: { smooth: 'l0', smoothLambda: 0.005 },
  guided: { smooth: 'guided', smoothEps: 100, smoothRadius: 8 }, gaussian: { smooth: 'gauss', smoothSigma: 1 }, off: { smooth: 'none' },
};
function collectParams() {
  const quality = val('input[name="complexity"]:checked') || 'standard';
  const profile = resolveQualityProfile(quality);
  const smoothKey = val('input[name="smooth"]:checked') || 'guided';
  const scaleKey = val('input[name="scale"]:checked') || 'area';
  const spatialEnabled = document.getElementById('spatial-toggle') ? toggleOn('spatial-toggle') : true;
  const spatialStrength = numVal('spatial-strength');
  const cleanupSize = numVal('cleanup-size');
  const override = {
    ...(SMOOTH_MAP[smoothKey] ?? SMOOTH_MAP.guided),
    scale: scaleKey === 'box' ? 'area' : scaleKey,
    maxColors: positiveIntVal('max-colors') ?? profile.advanced?.maxColors,
    dither: toggleOn('dither-toggle'),
    despeckle: toggleOn('despeckle-toggle'),
    renderCell: positiveIntVal('render-cell') ?? 40,
    renderBoard: positiveIntVal('render-board') ?? 29,
    backgroundTolerance: numVal('bg-tolerance') ?? 12,
    spatial: {
      enabled: spatialEnabled,
      ...(spatialStrength === undefined ? {} : { smoothness: spatialStrength }),
      ...(cleanupSize === undefined ? {} : { cleanupMaxSize: cleanupSize }),
    },
  };
  return {
    paramsSchemaVersion: PARAMS_SCHEMA_VERSION,
    board: val('input[name="board-preset"]:checked') || '78x78',
    palette: val('#palette-select') || 'mard221',
    minBeads: profile.minBeads,
    removeBg: toggleOn('remove-bg-toggle'),
    advanced: mergeAdvanced(profile.advanced, override),
    quality,
  };
}
async function decodeImage(blob) {
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width; canvas.height = bmp.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const data = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
  bmp.close();
  return { width: canvas.width, height: canvas.height, data: new Uint8ClampedArray(data) };
}
function setToggle(button, next) {
  if (!button) return;
  button.setAttribute('aria-checked', String(next));
  button.classList.toggle('bg-primary', next); button.classList.toggle('bg-muted', !next);
  const knob = button.querySelector('span');
  if (knob) { knob.classList.toggle(button.classList.contains('h-6') ? 'translate-x-5' : 'translate-x-4', next); knob.classList.toggle('translate-x-0', !next); }
}
function checkRadio(name, value) {
  const input = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (input) input.checked = true;
}
function setInputValue(id, value) {
  const input = document.getElementById(id);
  if (input) input.value = value === undefined ? '' : String(value);
}
function restoreFormState(saved) {
  const state = normalizeSavedFormState(saved);
  checkRadio('board-preset', state.board);
  checkRadio('complexity', state.quality);
  checkRadio('smooth', state.smooth);
  checkRadio('scale', state.scale);
  const palette = document.getElementById('palette-select'); if (palette) palette.value = state.palette;
  setToggle(document.getElementById('remove-bg-toggle'), state.removeBg);
  setToggle(document.getElementById('spatial-toggle'), state.spatialEnabled);
  setToggle(document.getElementById('dither-toggle'), state.dither);
  setToggle(document.getElementById('despeckle-toggle'), state.despeckle);
  setInputValue('spatial-strength', state.spatialStrength);
  setInputValue('cleanup-size', state.cleanupSize);
  setInputValue('max-colors', state.maxColors);
  setInputValue('render-cell', state.renderCell);
  setInputValue('render-board', state.renderBoard);
  setInputValue('bg-tolerance', state.backgroundTolerance);
}
function resetFormGroup(button) {
  const group = button.closest('.space-y-2');
  if (!group) return;
  group.querySelectorAll('input[type="radio"]').forEach((input) => { input.checked = input.dataset.default === 'true'; });
  group.querySelectorAll('input:not([type="radio"])[data-default]').forEach((input) => { input.value = input.dataset.default ?? ''; });
  group.querySelectorAll('[role="switch"][data-default]').forEach((toggle) => setToggle(toggle, toggle.dataset.default === 'true'));
}
function showUpload(blob, name) {
  const empty = document.getElementById('upload-empty');
  const filled = document.getElementById('upload-filled');
  const zone = document.getElementById('upload-zone');
  empty?.classList.add('hidden'); filled?.classList.remove('hidden'); filled?.classList.add('flex');
  zone?.classList.remove('border-dashed'); zone?.classList.add('border-solid');
  const nameEl = filled?.querySelector('p.truncate'); if (nameEl) nameEl.textContent = name;
  const thumb = filled?.querySelector('div.h-20');
  if (thumb) { thumb.innerHTML = ''; const image = document.createElement('img'); image.className = 'h-full w-full object-cover'; image.src = URL.createObjectURL(blob); thumb.appendChild(image); image.onload = () => URL.revokeObjectURL(image.src); }
  const sizeEl = filled?.querySelector('p.text-xs');
  createImageBitmap(blob).then((bmp) => { if (sizeEl) sizeEl.textContent = `${bmp.width} × ${bmp.height} px`; bmp.close(); });
  const cta = document.getElementById('generate-cta'); if (cta) cta.disabled = false;
}
function bootIndex() {
  const fileInput = document.getElementById('upload-input');
  const zone = document.getElementById('upload-zone');
  const cta = document.getElementById('generate-cta');
  if (!cta) return;
  zone?.addEventListener('click', (event) => { if (event.target !== fileInput) fileInput?.click(); });
  zone?.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileInput?.click(); } });
  fileInput?.addEventListener('change', () => { const file = fileInput.files?.[0]; if (file) showUpload(file, file.name); });
  document.querySelector('#upload-filled button')?.addEventListener('click', (event) => { event.stopPropagation(); fileInput?.click(); });
  document.querySelectorAll('.toggle-switch').forEach((button) => button.addEventListener('click', () => setToggle(button, button.getAttribute('aria-checked') !== 'true')));
  document.querySelectorAll('.reset-link').forEach((button) => button.addEventListener('click', () => resetFormGroup(button)));
  const advancedToggle = document.getElementById('advanced-toggle');
  const advancedBody = document.getElementById('advanced-body');
  advancedToggle?.addEventListener('click', () => advancedBody?.classList.toggle('hidden'));
  idbGet('img').then((previous) => { if (previous?.blob) showUpload(previous.blob, previous.name); });
  idbGet('params').then((params) => { if (params) restoreFormState(params); });
  cta.addEventListener('click', async () => {
    const file = fileInput?.files?.[0]; const previous = await idbGet('img');
    if (!file && !previous) return;
    const blob = file ?? previous.blob; const name = file?.name ?? previous.name;
    try {
      await idbPut('img', { name, type: blob.type, blob });
      await idbPut('params', collectParams());
      location.href = './generating.html';
    } catch (error) { await idbPut('error', error instanceof Error ? error.message : String(error)); location.href = './error.html'; }
  });
}
function bootGenerating() {
  const summary = document.querySelector('[data-region="loading"] .mirrorpin-mono');
  const stage = document.getElementById('generation-stage');
  const percentOutput = document.getElementById('generation-percent');
  const progress = document.getElementById('generation-progress');
  const progressFill = document.getElementById('generation-progress-fill');
  const progressNodes = Array.from(document.querySelectorAll('.mirrorpin-progress-node'));
  const stageOrder = Object.keys(STAGE_LABELS);
  const updateProgress = (stageId, value) => {
    const bounded = Math.max(0, Math.min(100, Math.round(value)));
    const currentIndex = Math.max(0, stageOrder.indexOf(stageId));
    if (stage) stage.textContent = STAGE_LABELS[stageId] ?? stageId;
    if (percentOutput) percentOutput.textContent = `${bounded}%`;
    progress?.setAttribute('aria-valuenow', String(bounded));
    progressFill?.style.setProperty('--progress', `${bounded}%`);
    progressNodes.forEach((node, index) => {
      const state = index < currentIndex || stageId === 'done'
        ? 'complete'
        : index === currentIndex
          ? 'current'
          : 'pending';
      node.dataset.state = state;
      if (state === 'current') node.setAttribute('aria-current', 'step');
      else node.removeAttribute('aria-current');
    });
  };
  updateProgress('prepare', 0);
  let worker = null; let requestId = crypto.randomUUID(); let cancelled = false;
  const fail = async (message) => { await idbPut('error', String(message)); location.href = './error.html'; };
  document.getElementById('cancel-generate')?.addEventListener('click', (event) => {
    event.preventDefault(); cancelled = true;
    worker?.postMessage({ type: 'cancel', requestId }); worker?.terminate(); worker = null;
    requestId = ''; location.href = './index.html';
  });
  (async () => {
    const savedImage = await idbGet('img'); const params = (await idbGet('params')) ?? {};
    if (!savedImage) return fail('未找到上传的图片，请返回重新选择。');
    const spec = BOARD_PRESETS[params.board] ?? BOARD_PRESETS['78x78'];
    if (summary) summary.textContent = `${spec.label.split('（')[0]} · ${params.palette === 'mard291' ? 'MARD 291' : 'MARD 221'} · ${params.quality ?? 'standard'} · ${params.removeBg ? '抠白底' : '保留背景'}`;
    try {
      const rgba = await decodeImage(savedImage.blob);
      worker = new Worker(new URL('./algo.worker.mjs', import.meta.url), { type: 'module' });
      const result = await new Promise((resolve, reject) => {
        worker.onmessage = (event) => {
          const message = event.data;
          if (message.requestId !== requestId) return;
          if (message.type === 'progress') updateProgress(message.stage, message.progress);
          else if (message.type === 'done') { updateProgress('done', 100); resolve(message); }
          else if (message.type === 'cancelled') reject(new Error('生成已取消'));
          else if (message.type === 'error') reject(new Error(message.message));
        };
        worker.onerror = (event) => reject(new Error(event.message || 'Worker 运行失败'));
        worker.postMessage({ type: 'generate', requestId, img: rgba, params }, [rgba.data.buffer]);
      });
      worker?.terminate(); worker = null;
      if (cancelled || result.requestId !== requestId) return;
      await idbPut('grid', result.grid);
      await idbPut('meta', {
        schemaVersion: DB_VERSION, algorithmVersion: result.algorithmVersion, name: savedImage.name.replace(/\.[^.]+$/, ''),
        board: params.board, palette: params.palette, quality: params.quality,
        renderCell: params.advanced?.renderCell ?? 40, renderBoard: params.advanced?.renderBoard ?? 29,
        elapsedMs: result.elapsedMs, diagnostics: result.diagnostics,
      });
      location.href = './result.html';
    } catch (error) { worker?.terminate(); worker = null; if (!cancelled) await fail(error instanceof Error ? error.message : error); }
  })();
}
function fmt(value) { return Number(value).toLocaleString('zh-CN'); }
function fmtMs(ms) { return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`; }
function canvasFromRgba(rgba) {
  const canvas = document.createElement('canvas'); canvas.width = rgba.width; canvas.height = rgba.height;
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.data), rgba.width, rgba.height), 0, 0); return canvas;
}
function downloadBlob(blob, filename) { const a = document.createElement('a'); a.download = filename; a.href = URL.createObjectURL(blob); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
function bootResult() {
  (async () => {
    const grid = await idbGet('grid'); const meta = (await idbGet('meta')) ?? {};
    if (!grid) { await idbPut('error', '没有可展示的图纸，请重新生成。'); location.href = './error.html'; return; }
    const materials = countGridMaterials(grid); const total = materials.reduce((sum, row) => sum + row.count, 0);
    const diagnostics = meta.diagnostics ?? {}; const paletteLabel = meta.palette === 'mard291' ? 'MARD 291' : 'MARD 221';
    const info = document.querySelector('[data-region="info-bar"] p');
    if (info) info.textContent = `${grid.cols} × ${grid.rows} 格 · ${materials.length} 色 · 合计 ${fmt(total)} 豆 · ${paletteLabel} · ${fmtMs(meta.elapsedMs ?? 0)} · v${meta.algorithmVersion ?? ALGORITHM_VERSION}`;
    const panel = document.createElement('div'); panel.id = 'optimization-diagnostics'; panel.className = 'mirrorpin-status p-4 text-sm text-muted-foreground';
    panel.textContent = `优化：${diagnostics.colorCountBefore ?? '—'} → ${diagnostics.colorCountAfter ?? grid.colorCount} 色；单格碎片 ${percent(diagnostics.singletonRatioBefore)} → ${percent(diagnostics.singletonRatioAfter)}；小区域 ${percent(diagnostics.smallComponentRatioBefore)} → ${percent(diagnostics.smallComponentRatioAfter)}。`;
    document.querySelector('[data-region="info-bar"]')?.appendChild(panel);
    const svg = document.querySelector('#pattern-preview svg');
    if (svg) { const previewCell = Math.max(6, Math.min(16, Math.floor(600 / grid.cols))); const canvas = canvasFromRgba(renderPatternImage(grid, { cell: previewCell, board: meta.renderBoard ?? 29, gutter: previewCell * 2, showCodes: false, showCoords: false })); canvas.style.maxWidth = '100%'; canvas.style.height = 'auto'; svg.replaceWith(canvas); }
    const tbody = document.querySelector('#material-list tbody');
    if (tbody) tbody.innerHTML = materials.map((row) => `<tr><td class="py-2.5 font-medium">${row.code}</td><td class="py-2.5"><span class="inline-block h-5 w-5 rounded-sm border border-border" style="background-color:#${row.hex}"></span></td><td class="py-2.5 text-right mirrorpin-mono">${fmt(row.count)}</td></tr>`).join('');
    const totalEl = document.querySelector('#material-list tfoot .mirrorpin-mono'); if (totalEl) totalEl.textContent = fmt(total);
    document.getElementById('download-png')?.addEventListener('click', () => canvasFromRgba(renderPatternImage(grid, { cell: meta.renderCell ?? 40, board: meta.renderBoard ?? 29, showCodes: true, showCoords: true })).toBlob((blob) => blob && downloadBlob(blob, `${meta.name || 'pattern'}_pattern.png`), 'image/png'));
    document.getElementById('download-csv')?.addEventListener('click', () => downloadBlob(new Blob([['code,hex,count', ...materials.map((row) => `${row.code},#${row.hex},${row.count}`)].join('\n')], { type: 'text/csv;charset=utf-8' }), `${meta.name || 'pattern'}_materials.csv`));
  })();
}
function percent(value) { return typeof value === 'number' ? `${(value * 100).toFixed(1)}%` : '—'; }
function bootError() { idbGet('error').then((message) => { const target = document.querySelector('.mirrorpin-body') ?? document.querySelector('main p'); if (target && message) target.textContent = message; }); }
const page = location.pathname.split('/').pop() || 'index.html';
if (page.includes('result')) bootResult(); else if (page.includes('generating')) bootGenerating(); else if (page.includes('error')) bootError(); else bootIndex();
