(function () {
  'use strict';

  const ALGORITHM_VERSION = '0.2.0';
  const api = window.MirrorPinAlgo;
  if (!api) {
    document.body.textContent = '算法资源加载失败，请重新打开小工具。';
    return;
  }

  const { generateForBoard, countGridMaterials } = api;
  const state = { file: null, previewUrl: null, grid: null, meta: null, image: null };
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));

  const SMOOTH_MAP = {
    l0: { smooth: 'l0', smoothLambda: 0.02 },
    weak: { smooth: 'l0', smoothLambda: 0.005 },
    guided: { smooth: 'guided', smoothEps: 100, smoothRadius: 8 },
    gaussian: { smooth: 'gauss', smoothSigma: 1 },
    off: { smooth: 'none' },
  };

  function setStatus(id, message, kind) {
    const el = $('#' + id);
    if (!el) return;
    el.textContent = message;
    el.dataset.kind = kind || '';
  }

  function setSwitch(button, on) {
    button.classList.toggle('is-on', on);
    button.setAttribute('aria-checked', String(on));
  }

  function switchValue(id) {
    return $('#' + id).getAttribute('aria-checked') === 'true';
  }

  function numberValue(id, fallback) {
    const raw = $('#' + id).value.trim();
    if (raw === '') return fallback;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  function nonNegativeValue(id, fallback) {
    const raw = $('#' + id).value.trim();
    if (raw === '') return fallback;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  }

  function nonNegativeIntegerValue(id, fallback) {
    const raw = $('#' + id).value.trim();
    if (raw === '') return fallback;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
  }

  function selectedValue(name, fallback) {
    const selected = document.querySelector('input[name="' + name + '"]:checked');
    return selected ? selected.value : fallback;
  }

  function collectParams() {
    const complexity = selectedValue('complexity', 'standard');
    const complexityMinBeads = { standard: 0, less: 5, minimal: 10 }[complexity] || 0;
    return {
      board: selectedValue('board', '78x78'),
      palette: $('#palette-select').value,
      minBeads: nonNegativeIntegerValue('min-beads', complexityMinBeads),
      removeBg: switchValue('remove-bg-toggle'),
      advanced: {
        ...(SMOOTH_MAP[$('#smooth-select').value] || SMOOTH_MAP.l0),
        scale: $('#scale-select').value,
        colors: nonNegativeIntegerValue('preprocess-colors', 64),
        maxColors: numberValue('max-colors', undefined),
        dither: switchValue('dither-toggle'),
        despeckle: switchValue('despeckle-toggle'),
        renderCell: numberValue('render-cell', 40),
        renderBoard: nonNegativeValue('render-board', 29),
        backgroundTolerance: nonNegativeValue('bg-tolerance', 12),
      },
    };
  }

  function updateChoiceState() {
    $$('.choice-card').forEach((card) => {
      const input = card.querySelector('input');
      card.classList.toggle('selected', Boolean(input && input.checked));
    });
  }

  function updateGenerateState() {
    const ready = Boolean(state.file);
    $('#generate-cta').disabled = !ready;
    if (ready) setStatus('generate-status', '参数已就绪，可以开始生成。');
  }

  function showSelectedFile(file) {
    if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setStatus('upload-status', '请选择 PNG、JPG 或 WebP 图片。', 'error');
      return;
    }
    state.file = file;
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = URL.createObjectURL(file);
    const preview = $('#source-preview');
    preview.src = state.previewUrl;
    preview.hidden = false;
    $('#file-summary').textContent = file.name;
    $('#file-summary').hidden = false;
    $('.upload-mark').classList.add('is-selected');
    setStatus('upload-status', '已选择图片，可以继续调整参数。', 'success');
    updateGenerateState();
  }

  function decodeImage(blob) {
    if (typeof createImageBitmap === 'function') {
      return createImageBitmap(blob).then((bmp) => {
        const canvas = document.createElement('canvas');
        canvas.width = bmp.width;
        canvas.height = bmp.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(bmp, 0, 0);
        const data = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
        bmp.close();
        return { width: canvas.width, height: canvas.height, data: new Uint8ClampedArray(data) };
      });
    }
    return new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(blob);
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(image, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        URL.revokeObjectURL(url);
        resolve({ width: canvas.width, height: canvas.height, data: new Uint8ClampedArray(data) });
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('图片解码失败。'));
      };
      image.src = url;
    });
  }

  // 与 src/render/node.ts 保持同一套系统字体参数；Canvas 2D 在容器内负责抗锯齿。
  function renderNativePatternCanvas(grid, options) {
    const opts = options || {};
    const cell = opts.cell || 40;
    const board = opts.board === undefined ? 29 : opts.board;
    const gutter = opts.gutter || 42;
    const codeFont = opts.codeFont || 14;
    const coordFont = opts.coordFont || 12;
    const showCodes = opts.showCodes !== false;
    const showCoords = opts.showCoords !== false;
    const width = gutter + grid.cols * cell + 6;
    const height = gutter + grid.rows * cell + 6;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const fontFamily = 'Arial, Helvetica, sans-serif';

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = codeFont + 'px ' + fontFamily;

    const textColor = (hex) => {
      const value = hex.match(/[0-9a-f]{2}/gi).map((part) => parseInt(part, 16));
      const luminance = 0.299 * value[0] + 0.587 * value[1] + 0.114 * value[2];
      return luminance > 140 ? '#000000' : '#ffffff';
    };

    for (let y = 0; y < grid.rows; y += 1) {
      for (let x = 0; x < grid.cols; x += 1) {
        const cellData = grid.cells[y][x];
        const x0 = gutter + x * cell;
        const y0 = gutter + y * cell;
        if (cellData.external) {
          ctx.fillStyle = (x + y) % 2 === 0 ? '#f5f5f5' : '#ededed';
        } else {
          ctx.fillStyle = '#' + cellData.hex;
        }
        ctx.fillRect(x0, y0, cell, cell);
        if (!cellData.external && showCodes && cellData.code) {
          ctx.fillStyle = textColor(cellData.hex);
          ctx.fillText(cellData.code, x0 + cell / 2, y0 + cell / 2);
        }
      }
    }

    const line = (x, y, lineWidth, lineHeight, color) => {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, lineWidth, lineHeight);
    };
    for (let x = 0; x <= grid.cols; x += 1) {
      const major = x % 10 === 0;
      const isBoard = board > 0 && x % board === 0;
      line(gutter + x * cell, gutter, isBoard ? 3 : major ? 2 : 1, grid.rows * cell, isBoard ? '#c82828' : major ? '#6e6e6e' : '#cdcdcd');
    }
    for (let y = 0; y <= grid.rows; y += 1) {
      const major = y % 10 === 0;
      const isBoard = board > 0 && y % board === 0;
      line(gutter, gutter + y * cell, grid.cols * cell, isBoard ? 3 : major ? 2 : 1, isBoard ? '#c82828' : major ? '#6e6e6e' : '#cdcdcd');
    }

    if (showCoords) {
      ctx.fillStyle = '#464646';
      ctx.font = coordFont + 'px ' + fontFamily;
      ctx.textBaseline = 'alphabetic';
      for (let x = 0; x < grid.cols; x += 1) {
        if (x !== 0 && (x + 1) % 5 !== 0) continue;
        ctx.fillText(String(x + 1), gutter + x * cell + cell / 2, 14);
      }
      ctx.textBaseline = 'middle';
      for (let y = 0; y < grid.rows; y += 1) {
        if (y !== 0 && (y + 1) % 5 !== 0) continue;
        ctx.fillText(String(y + 1), 14, gutter + y * cell + cell / 2);
      }
    }
    return canvas;
  }

  function formatNumber(value) {
    return Number(value).toLocaleString('zh-CN');
  }

  function renderMaterialsCanvas(materials) {
    const padding = 56;
    const width = 1400;
    const titleHeight = 118;
    const headerHeight = 54;
    const rowHeight = 54;
    const height = titleHeight + headerHeight + materials.length * rowHeight + padding;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const palette = state.meta.palette === 'mard291' ? 'MARD 291' : 'MARD 221';
    const total = materials.reduce((sum, row) => sum + row.count, 0);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#1f1b18';
    ctx.font = '700 32px Arial, Helvetica, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('MirrorPin 材料清单', padding, 42);
    ctx.fillStyle = '#77706a';
    ctx.font = '18px Arial, Helvetica, sans-serif';
    ctx.fillText(gridSummary(state.grid) + ' · ' + palette + ' · ' + materials.length + ' 色 · 合计 ' + formatNumber(total) + ' 豆 · 算法库 v' + ALGORITHM_VERSION, padding, 86);

    const headerY = titleHeight;
    ctx.fillStyle = '#f3efeb';
    ctx.fillRect(0, headerY, width, headerHeight);
    ctx.fillStyle = '#665f59';
    ctx.font = '700 18px Arial, Helvetica, sans-serif';
    ctx.fillText('色号', padding, headerY + headerHeight / 2);
    ctx.fillText('色值', 260, headerY + headerHeight / 2);
    ctx.textAlign = 'right';
    ctx.fillText('用量（豆）', width - padding, headerY + headerHeight / 2);
    ctx.textAlign = 'left';

    materials.forEach((row, index) => {
      const y = headerY + headerHeight + index * rowHeight;
      if (index % 2 === 1) {
        ctx.fillStyle = '#fbfaf8';
        ctx.fillRect(0, y, width, rowHeight);
      }
      ctx.strokeStyle = '#e8e2dc';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padding, y + rowHeight);
      ctx.lineTo(width - padding, y + rowHeight);
      ctx.stroke();

      ctx.fillStyle = '#' + row.hex;
      ctx.fillRect(260, y + 13, 28, 28);
      ctx.strokeStyle = '#bcb5ae';
      ctx.strokeRect(260, y + 13, 28, 28);
      ctx.fillStyle = '#26211d';
      ctx.font = '700 22px Arial, Helvetica, sans-serif';
      ctx.fillText(row.code, padding, y + rowHeight / 2);
      ctx.fillStyle = '#6f6862';
      ctx.font = '20px Arial, Helvetica, sans-serif';
      ctx.fillText('#' + row.hex, 310, y + rowHeight / 2);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#26211d';
      ctx.font = '700 20px Arial, Helvetica, sans-serif';
      ctx.fillText(formatNumber(row.count), width - padding, y + rowHeight / 2);
      ctx.textAlign = 'left';
    });
    return canvas;
  }

  function gridSummary(grid) {
    return grid.cols + ' × ' + grid.rows + ' 格';
  }

  function renderResult() {
    const grid = state.grid;
    const materials = countGridMaterials(grid);
    const total = materials.reduce((sum, row) => sum + row.count, 0);
    const palette = state.meta.palette === 'mard291' ? 'MARD 291' : 'MARD 221';
    // 结果区也保留原尺寸 backing store，避免模拟器长按保存到低清缩略图。
    // CSS 只负责适配屏幕宽度，保存接口读取的仍是原始像素尺寸。
    const preview = makeFullCanvas();
    const holder = $('#pattern-preview');
    holder.replaceChildren(preview);
    $('#result-summary').innerHTML = '<strong>' + grid.cols + ' × ' + grid.rows + '</strong><span>格</span><span>·</span><strong>' + materials.length + '</strong><span>色</span><span>·</span><span>合计</span><strong>' + formatNumber(total) + '</strong><span>豆</span><span>·</span><span>' + palette + '</span>';
    $('#material-count').textContent = materials.length + ' 色 · ' + formatNumber(total) + ' 豆';

    const tbody = $('#material-table tbody');
    tbody.replaceChildren();
    materials.forEach((row) => {
      const tr = document.createElement('tr');
      const code = document.createElement('td');
      code.textContent = row.code;
      const color = document.createElement('td');
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.backgroundColor = '#' + row.hex;
      swatch.title = '#' + row.hex;
      color.appendChild(swatch);
      color.appendChild(document.createTextNode(' #' + row.hex));
      const count = document.createElement('td');
      count.textContent = formatNumber(row.count);
      tr.append(code, color, count);
      tbody.appendChild(tr);
    });
    $('#materials-text').value = ['code,hex,count'].concat(materials.map((row) => row.code + ',#' + row.hex + ',' + row.count)).join('\n');
    $('#materials-image-preview').replaceChildren();
    $('#materials-image-preview').hidden = true;
    $('#result-section').hidden = false;
  }

  function makeFullCanvas() {
    return renderNativePatternCanvas(state.grid, {
      cell: state.meta.renderCell,
      board: state.meta.renderBoard,
      showCodes: true,
      showCoords: true,
      codeFont: 14,
      coordFont: 12,
    });
  }

  async function saveCanvasToAlbum(canvas, statusId, label) {
    setStatus(statusId, '正在准备' + label + '……');
    try {
      const data = canvas.toDataURL('image/png');
      const miniTool = window.xhs && window.xhs.miniTool;
      if (!miniTool || typeof miniTool.writeTempFile !== 'function' || typeof miniTool.saveImageToPhotosAlbum !== 'function') {
        setStatus(statusId, '当前模拟器未提供相册接口，请长按下方' + label + '预览保存。');
        return;
      }
      const temp = await miniTool.writeTempFile({ data: data });
      await miniTool.saveImageToPhotosAlbum({ filePath: temp.filePath });
      setStatus(statusId, label + '已保存到相册。', 'success');
    } catch (error) {
      setStatus(statusId, '保存失败：' + (error && error.message ? error.message : '请稍后重试。'), 'error');
    }
  }

  async function saveImage() {
    if (!state.grid) return;
    const button = $('#save-image');
    button.disabled = true;
    try {
      await saveCanvasToAlbum(makeFullCanvas(), 'save-status', '图纸');
    } finally {
      button.disabled = false;
    }
  }

  async function saveMaterials() {
    if (!state.grid) return;
    const button = $('#save-materials');
    button.disabled = true;
    try {
      const canvas = renderMaterialsCanvas(countGridMaterials(state.grid));
      const holder = $('#materials-image-preview');
      holder.replaceChildren(canvas);
      holder.hidden = false;
      await saveCanvasToAlbum(canvas, 'materials-save-status', '材料清单');
    } finally {
      button.disabled = false;
    }
  }

  async function generate() {
    if (!state.file) return;
    const button = $('#generate-cta');
    button.disabled = true;
    $('#generate-label').textContent = '正在本地生成……';
    setStatus('generate-status', '正在解码图片并生成网格，请保持页面打开。');
    $('#result-section').hidden = true;
    try {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const image = await decodeImage(state.file);
      const params = collectParams();
      const start = performance.now();
      const result = generateForBoard(image, params);
      state.image = image;
      state.grid = result.grid;
      state.meta = {
        palette: params.palette,
        renderCell: params.advanced.renderCell,
        renderBoard: params.advanced.renderBoard,
        elapsedMs: Math.round(performance.now() - start),
      };
      renderResult();
      setStatus('generate-status', '生成完成，可查看图纸和材料清单。', 'success');
      $('#result-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      setStatus('generate-status', '生成失败：' + (error && error.message ? error.message : '请更换图片后重试。'), 'error');
    } finally {
      button.disabled = !state.file;
      $('#generate-label').textContent = '重新生成图纸';
    }
  }

  function bindToggle(id) {
    const button = $('#' + id);
    button.addEventListener('click', () => setSwitch(button, !switchValue(id)));
  }

  $('#upload-input').addEventListener('change', (event) => showSelectedFile(event.target.files && event.target.files[0]));
  $('#upload-zone').addEventListener('dragover', (event) => {
    event.preventDefault();
    $('#upload-zone').classList.add('is-dragging');
  });
  $('#upload-zone').addEventListener('dragleave', () => $('#upload-zone').classList.remove('is-dragging'));
  $('#upload-zone').addEventListener('drop', (event) => {
    event.preventDefault();
    $('#upload-zone').classList.remove('is-dragging');
    showSelectedFile(event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]);
  });
  $$("input[type='radio']").forEach((input) => input.addEventListener('change', updateChoiceState));
  bindToggle('remove-bg-toggle');
  bindToggle('dither-toggle');
  bindToggle('despeckle-toggle');
  $('#generate-cta').addEventListener('click', generate);
  $('#save-image').addEventListener('click', saveImage);
  $('#save-materials').addEventListener('click', saveMaterials);
  $('#edit-again').addEventListener('click', () => {
    $('#result-section').hidden = true;
    window.scrollTo(0, 0);
    setStatus('generate-status', state.file ? '参数已就绪，可以开始生成。' : '选择图片后即可生成。');
  });
  updateChoiceState();
  updateGenerateState();
})();
