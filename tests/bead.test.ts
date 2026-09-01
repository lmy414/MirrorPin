import { describe, it, expect } from 'vitest';
import { MARD291, buildBeadPalette, ciede2000, cropToSubject, despeckle, generateForBoard, generatePatternBead, srgbToLab, toGrid, l0MemoryBudget, l0Smooth, neumannNegativeDivergence } from '../src';
import { makeImage, solidImage } from './helpers';

describe('CIEDE2000 感知色差', () => {
  it('距离非负且同色为 0', () => {
    const a = srgbToLab({ r: 200, g: 60, b: 40 });
    expect(ciede2000(a, a)).toBe(0);
  });

  it('相同色距离 0，不同色 > 0', () => {
    const red = srgbToLab({ r: 213, g: 43, b: 30 });
    const blue = srgbToLab({ r: 30, g: 43, b: 213 });
    expect(ciede2000(red, red)).toBe(0);
    expect(ciede2000(red, blue)).toBeGreaterThan(0);
  });

  it('近似色色差明显小于远色', () => {
    const anchor = srgbToLab({ r: 128, g: 60, b: 30 });
    const close = srgbToLab({ r: 130, g: 62, b: 32 });
    const far = srgbToLab({ r: 30, g: 200, b: 30 });
    expect(ciede2000(anchor, close)).toBeLessThan(ciede2000(anchor, far));
  });
});

describe('cropToSubject / generatePatternBead', () => {
  it('白底居中红块 -> 裁剪到主体并保留红', () => {
    // crop_to_subject 依赖 alpha，需透明背景（对应 bead-pattern：先去背景再裁）
    const img = makeImage(20, 20, (x, y) => {
      const core = x >= 8 && x < 14 && y >= 6 && y < 12;
      return core ? [213, 43, 30, 255] : [0, 0, 0, 0];
    });
    const cropped = cropToSubject(img);
    expect(cropped.width).toBe(6);
    expect(cropped.height).toBe(6);
  });

  it('管线可跑通且主体保留、含有效色号', () => {
    const img = makeImage(12, 12, (x, y) => {
      const core = x >= 4 && x < 8 && y >= 4 && y < 8;
      return core ? [213, 43, 30, 255] : [255, 255, 255, 255];
    });
    const g = generatePatternBead(img, { palette: MARD291, maxSide: 8, cropToSubject: true, removeBg: 'none' });
    // 主体（红）应在网格中心附近被保留
    const mid = g.cells[Math.floor(g.rows / 2)]![Math.floor(g.cols / 2)]!;
    expect(mid.external).toBe(false);
    expect(g.colorCount).toBeGreaterThanOrEqual(1);
  });

  it('纯色图输出为对应的色板色', () => {
    const img = solidImage(10, 10, [255, 255, 255]);
    const g = generatePatternBead(img, { palette: MARD291, fixed: { w: 4, h: 4 }, removeBg: 'none', cropToSubject: false });
    const cell = g.cells[0]![0]!;
    expect(cell.external).toBe(false);
    expect(cell.code).not.toBe('');
  });

  it('色卡构建能覆盖 MARD291 非占位色号', () => {
    const pal = buildBeadPalette(MARD291);
    expect(pal.codes.length).toBeGreaterThan(200);
    expect(pal.lab.length).toBe(pal.codes.length);
  });

  it('L0 预算包含输出 RGBA 峰值并拒绝旧预算会放行的尺寸', () => {
    expect(l0MemoryBudget.float64ArraysPerPixel).toBeGreaterThan(0);
    expect(l0MemoryBudget.float32ArraysPerPixel).toBeGreaterThan(0);
    expect(l0MemoryBudget.uint8ArraysPerPixel).toBe(1);
    expect(l0MemoryBudget.uint8ElementsPerPixel).toBe(4);
    expect(l0MemoryBudget.estimatedMiB).toBe(l0MemoryBudget.estimatedBytes / (1024 * 1024));
    const pixels = Math.floor(l0MemoryBudget.maxBytes / (13 * Float64Array.BYTES_PER_ELEMENT + 6 * Float32Array.BYTES_PER_ELEMENT));
    const width = pixels;
    expect(() => l0Smooth(makeImage(width, 1, () => [20, 30, 40, 255]), { betaMax: 2 })).toThrow(/超过/);
    expect(() => l0Smooth(makeImage(64, 1, () => [20, 30, 40, 255]), { betaMax: 2 })).not.toThrow();
  });

  it('neumannNegativeDivergence 拒绝非正整数网格与长度不匹配', () => {
    const h = new Float64Array(1);
    const v = new Float64Array(1);
    const out = new Float64Array(1);
    expect(() => neumannNegativeDivergence(h, v, 0, 1, out)).toThrow(/正整数/);
    expect(() => neumannNegativeDivergence(h, v, 1.5, 1, out)).toThrow(/正整数|整数/);
    expect(() => neumannNegativeDivergence(h, v, 2, 1, out)).toThrow(/长度/);
  });

  it('公开 toGrid 使用精确 3→2 footprint、linear-light 与 straight-alpha coverage', () => {
    const img = makeImage(3, 1, (x) => [x === 0 ? 0 : x === 1 ? 60 : 180, x === 0 ? 0 : x === 1 ? 60 : 180, x === 0 ? 0 : x === 1 ? 60 : 180, x === 1 ? 128 : 255]);
    const before = new Uint8ClampedArray(img.data);
    const grid = toGrid(img, 2, 1, false);
    const linear = (value: number) => { const n = value / 255; return n <= 0.04045 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4); };
    const encode = (value: number) => Math.round(Math.min(255, Math.max(0, (value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055) * 255)));
    expect(Array.from(grid.data)).toEqual([encode(linear(60) * 0.25 / 1.25), encode(linear(60) * 0.25 / 1.25), encode(linear(60) * 0.25 / 1.25), 213, encode(linear(60) * 0.25 / 1.25 + linear(180) * 1 / 1.25), encode(linear(60) * 0.25 / 1.25 + linear(180) * 1 / 1.25), encode(linear(60) * 0.25 / 1.25 + linear(180) * 1 / 1.25), 213]);
    expect(Array.from(img.data)).toEqual(Array.from(before));
  });

  it.each([
    ['fixed-fill', { fixed: { w: 6, h: 4 }, fill: true }],
    ['fixed-fit', { fixed: { w: 6, h: 4 } }],
    ['auto', { maxSide: 6 }],
  ] as const)('%s 由真实重采样调用计数为 1', (_name, sizing) => {
    const diagnostics = { resamplePasses: 0 };
    const events: string[] = [];
    const img = makeImage(19, 13, (x, y) => [x * 11, y * 17, (x + y) * 5, 255]);
    generatePatternBead(img, {
      palette: MARD291,
      ...sizing,
      cropToSubject: false,
      smooth: 'none',
      scale: 'dpid',
      diagnostics,
      onResample: (event) => events.push(`${event.phase}:${event.method}`),
    });
    expect(diagnostics.resamplePasses).toBe(1);
    expect(events).toEqual([expect.stringMatching(/^(fit|direct):dpid$/)]);
  });

  it('fixed DPID 只执行一次目标重采样', () => {
    const diagnostics = { resamplePasses: 0 };
    const img = makeImage(19, 13, (x, y) => [x * 11, y * 17, (x + y) * 5, 255]);
    generatePatternBead(img, {
      palette: MARD291,
      fixed: { w: 52, h: 52 },
      fill: true,
      cropToSubject: false,
      smooth: 'none',
      scale: 'dpid',
      diagnostics,
    });
    expect(diagnostics).toEqual({ resamplePasses: 1, resampleMethod: 'dpid', sourceFloodApplied: false });
  });

  it.each([
    [52, 52],
    [78, 78],
    [104, 104],
    [78, 52],
  ])('fixed %i×%i 由统一网格采样直接输出精确尺寸', (w, h) => {
    const img = makeImage(19, 13, (x, y) => [x * 11, y * 17, (x + y) * 5, 255]);
    const grid = generatePatternBead(img, {
      palette: MARD291,
      fixed: { w, h },
      fill: true,
      cropToSubject: false,
      smooth: 'none',
      scale: 'dpid',
    });
    expect([grid.cols, grid.rows]).toEqual([w, h]);
  });

  it('alpha=128 统一视为主体与可匹配像素', () => {
    const img = makeImage(3, 1, (x) => x === 1 ? [255, 0, 0, 128] : [0, 0, 0, 0]);
    const cropped = cropToSubject(img);
    expect([cropped.width, cropped.height]).toEqual([1, 1]);
    const grid = generatePatternBead(img, {
      palette: [{ code: 'R', hex: 'FF0000' }],
      fixed: { w: 3, h: 1 },
      cropToSubject: false,
      smooth: 'none',
      scale: 'box',
    });
    expect(grid.cells[0]![1]!.code).toBe('R');
  });

  it('removeBg=flood 在源图阶段构建 mask，缩格后不再被网格边色二次污染', () => {
    const img = makeImage(12, 8, (x, y) => {
      if (x === 0 && y >= 2 && y <= 5) return [220, 30, 30, 255];
      if (x >= 4 && x <= 7 && y >= 2 && y <= 5) return [220, 30, 30, 255];
      return [250, 250, 245, 255];
    });
    const grid = generatePatternBead(img, {
      palette: [
        { code: 'R', hex: 'DC1E1E' },
        { code: 'W', hex: 'FAFAF5' },
      ],
      fixed: { w: 6, h: 4 },
      cropToSubject: false,
      removeBg: 'flood',
      backgroundTolerance: 8,
      smooth: 'none',
      scale: 'box',
    });
    expect(grid.cells.flat().some((cell) => cell.code === 'R')).toBe(true);
    expect(grid.cells[0]![5]!.external).toBe(true);
  });

  it.each(['guided', 'l0'] as const)('source flood 背景在 %s smooth 前被 mask 延拓隔离', (smooth) => {
    const palette = [
      { code: 'R', hex: 'C83232' },
      { code: 'B', hex: '1446DC' },
    ] as const;
    const clean = makeImage(24, 16, (x, y) => x >= 8 && x < 16 && y >= 4 && y < 12
      ? [200, 50, 50, 255]
      : [245, 245, 245, 255]);
    const polluted = makeImage(24, 16, (x, y) => x >= 8 && x < 16 && y >= 4 && y < 12
      ? [200, 50, 50, 255]
      : [20, 70, 220, 255]);
    const options = {
      palette,
      fixed: { w: 12, h: 8 },
      cropToSubject: false,
      removeBg: 'flood' as const,
      backgroundTolerance: 5,
      smooth,
      smoothRadius: 2,
      smoothEps: 30,
      smoothLambda: 0.02,
      scale: 'box' as const,
    };
    expect(generatePatternBead(polluted, options).cells).toEqual(generatePatternBead(clean, options).cells);
  });

  it('generateForBoard 默认使用 guided 并与显式 guided 接线一致', () => {
    const img = makeImage(18, 12, (x, y) => [x * 10, y * 15, 100, 255]);
    const implicit = generateForBoard(img, { board: '52x52', cropToSubject: false });
    const explicit = generateForBoard(img, { board: '52x52', cropToSubject: false, advanced: { smooth: 'guided' } });
    expect(implicit.grid.cells).toEqual(explicit.grid.cells);
  });

  it('BeadOptions.colorQuantize 在主管线统一执行且默认关闭', () => {
    const palette = [
      { code: 'K', hex: '000000' },
      { code: 'W', hex: 'FFFFFF' },
    ] as const;
    const img = makeImage(8, 1, (x) => [x * 32, x * 32, x * 32, 255]);
    const baseline = generatePatternBead(img, { palette, fixed: { w: 8, h: 1 }, cropToSubject: false, smooth: 'none' });
    const explicitOff = generatePatternBead(img, { palette, fixed: { w: 8, h: 1 }, cropToSubject: false, smooth: 'none', colorQuantize: { colors: 256 } });
    expect(explicitOff.cells).toEqual(baseline.cells);
    expect(() => generatePatternBead(img, { palette, fixed: { w: 8, h: 1 }, colorQuantize: { colors: 1.5 } })).toThrow(/整数/);
  });
});

describe('despeckle 去杂', () => {
  it('单格孤立色被并入邻域多数色', () => {
    // 3x3，全部 0，中心 1（孤立）
    const idx = new Int32Array([0, 0, 0, 0, 1, 0, 0, 0, 0]);
    const out = despeckle(idx, 3, 3, 2);
    expect(out[4]).toBe(0);
  });

  it('成片区域不被误删（min_region 内保留）', () => {
    // 2x2 全同色 5（区域面积=4 >= 2，不并入）
    const idx = new Int32Array([5, 5, 5, 5]);
    const out = despeckle(idx, 2, 2, 2);
    expect(out[0]).toBe(5);
  });
});