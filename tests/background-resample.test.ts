import { describe, expect, it } from 'vitest';
import {
  areaResampleToGrid,
  buildForegroundMask,
  cropImageAndMaskToAspect,
  cropImageAndMaskToSubject,
  dpidResampleToGrid,
  extendMaskedRgb,
  generatePatternBead,
  buildBeadPalette,
  matchDirectData,
  gridSamplesToRgba,
  linearToSrgb,
  srgbToLinear,
} from '../src';
import { makeImage } from './helpers';

describe('buildForegroundMask', () => {
  it('none 模式把源 alpha 精确转换为 coverage', () => {
    const img = makeImage(4, 1, (x) => [10, 20, 30, [0, 127, 128, 255][x]!] as [number, number, number, number]);
    const mask = buildForegroundMask(img, { mode: 'none' });
    expect(mask.width).toBe(4);
    expect(mask.height).toBe(1);
    expect(Array.from(mask.coverage)).toEqual([
      0,
      Math.fround(127 / 255),
      Math.fround(128 / 255),
      1,
    ]);
  });

  it('flood 使用主背景簇并保护少数贴边主体，透明隐藏 RGB 不作为边界种子', () => {
    const img = makeImage(7, 5, (x, y) => {
      if (x === 6 && y === 0) return [255, 0, 255, 0];
      if ((x === 0 && y === 2) || (x >= 2 && x <= 4 && y >= 1 && y <= 3)) return [220, 30, 30, 255];
      return [245, 245, 240, 255];
    });
    const mask = buildForegroundMask(img, { mode: 'flood', tolerance: 8 });
    expect(mask.coverage[2 * 7]!).toBe(1);
    expect(mask.coverage[2 * 7 + 3]!).toBe(1);
    expect(mask.coverage[0]!).toBe(0);
    expect(mask.coverage[4 * 7 + 6]!).toBe(0);
  });

  it('大面积浅色主体占顶部与两侧时置信度不足，安全退化为 alpha-only', () => {
    const img = makeImage(12, 10, (x, y) => {
      const subject = y < 5 || x < 3 || x >= 9;
      return subject ? [248, 248, 246, 255] : [210, 220, 230, 255];
    });
    const mask = buildForegroundMask(img, { mode: 'flood', tolerance: 6 });
    expect(mask.coverage[2 * 12 + 6]).toBe(1);
    expect(mask.coverage[6 * 12 + 1]).toBe(1);
    expect(mask.coverage[6 * 12 + 10]).toBe(1);
  });

  it('白主体与白背景低对比时不猜测删除主体', () => {
    const img = makeImage(10, 10, (x, y) => {
      const subject = x >= 1 && x <= 8 && y <= 7;
      return subject ? [250, 250, 250, 255] : [255, 255, 255, 255];
    });
    const mask = buildForegroundMask(img, { mode: 'flood', tolerance: 4 });
    expect(mask.coverage[4 * 10 + 4]).toBe(1);
  });

  it('四角与角邻域一致时可确认背景并删除四角连通背景', () => {
    const img = makeImage(11, 9, (x, y) => {
      const subject = x >= 3 && x <= 7 && y >= 2 && y <= 6;
      return subject ? [190, 40, 50, 255] : [235, 240, 245, 255];
    });
    const mask = buildForegroundMask(img, { mode: 'flood', tolerance: 5 });
    expect(mask.coverage[0]).toBe(0);
    expect(mask.coverage[4 * 11 + 5]).toBe(1);
  });

  it('边界颜色无多边共识时不 flood', () => {
    const img = makeImage(8, 8, (x, y) => {
      if (y === 0) return [255, 0, 0, 255];
      if (y === 7) return [0, 255, 0, 255];
      if (x === 0) return [0, 0, 255, 255];
      if (x === 7) return [255, 255, 0, 255];
      return [120, 80, 160, 255];
    });
    const mask = buildForegroundMask(img, { mode: 'flood', tolerance: 1 });
    expect(Array.from(mask.coverage).every((value) => value === 1)).toBe(true);
  });

  it('低 tolerance 的候选聚类与 flood seed 使用同一门限', () => {
    const img = makeImage(7, 7, (x, y) => {
      const border = x === 0 || y === 0 || x === 6 || y === 6;
      if (!border) return [200, 20, 20, 255];
      return (x + y) % 2 ? [240, 240, 240, 255] : [242, 242, 242, 255];
    });
    const mask = buildForegroundMask(img, { mode: 'flood', tolerance: 0.2 });
    expect(Array.from(mask.coverage).every((value) => value === 1)).toBe(true);
  });

  it('基于 ForegroundMask 延拓背景颜色并保留原 alpha', () => {
    const img = makeImage(5, 1, (x) => x === 2 ? [200, 30, 40, 255] : [0, 220, 255, 255]);
    const mask = { width: 5, height: 1, coverage: new Float32Array([0, 0, 1, 0, 0]) };
    const out = extendMaskedRgb(img, mask);
    for (let x = 0; x < 5; x++) {
      expect(Array.from(out.data.slice(x * 4, x * 4 + 3))).toEqual([200, 30, 40]);
      expect(out.data[x * 4 + 3]).toBe(255);
    }
  });

  it('mask-aware subject/aspect crop 同步裁图与 mask', () => {
    const img = makeImage(8, 6, (x, y) => x >= 2 && x < 6 && y >= 1 && y < 5
      ? [200, 20, 20, 255]
      : [0, 0, 0, 0]);
    const mask = buildForegroundMask(img, { mode: 'none' });
    const subject = cropImageAndMaskToSubject(img, mask);
    expect([subject.image.width, subject.image.height, subject.mask.width, subject.mask.height]).toEqual([4, 4, 4, 4]);
    const aspect = cropImageAndMaskToAspect(subject.image, subject.mask, 2, 1);
    expect(aspect.image.width / aspect.image.height).toBe(2);
    expect(aspect.mask.coverage.length).toBe(aspect.image.width * aspect.image.height);
  });
});

describe('精确 coverage 面积重采样', () => {
  it('none 默认保持 partial-alpha straight RGB，并与 area 手算 oracle 一致', () => {
    const colors: [number, number, number][] = [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 255, 0],
      [0, 255, 255],
    ];
    const alphas = [1, 255, 64, 255, 127, 255, 128, 255, 255, 255];
    const sourceColors = colors.flatMap((color) => [color, color]);
    const img = makeImage(10, 1, (x) => [...sourceColors[x]!, alphas[x]!] as [number, number, number, number]);
    const palette = colors.map((rgb, index) => ({ code: String(index), hex: rgb.map((v) => v.toString(16).padStart(2, '0')).join('') }));
    const srgbToLinearOracle = (value: number) => {
      const normalized = value / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
    };
    const linearToSrgbOracle = (value: number) => {
      const normalized = value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
      return Math.round(Math.min(255, Math.max(0, normalized * 255)));
    };
    const expectedRgba: number[] = [];
    for (let cell = 0; cell < 5; cell++) {
      const x0 = cell * 2;
      const x1 = x0 + 2;
      let total = 0;
      const sums = [0, 0, 0];
      for (let x = x0; x < x1; x++) {
        const alpha = alphas[x]! / 255;
        const weight = alpha;
        total += weight;
        for (let channel = 0; channel < 3; channel++) sums[channel]! += srgbToLinearOracle(sourceColors[x]![channel]!) * weight;
      }
      expectedRgba.push(...sums.map((sum) => linearToSrgbOracle(total ? sum / total : 0)), Math.round((total / 2) * 255));
    }
    const expected = Array.from({ length: 5 }, (_, index) => matchDirectData(
      { gw: 1, gh: 1, data: Uint8ClampedArray.from(expectedRgba.slice(index * 4, index * 4 + 4)) },
      Uint8ClampedArray.from(expectedRgba.slice(index * 4, index * 4 + 4)),
      buildBeadPalette(palette),
    )[0]!);
    const actual = generatePatternBead(img, {
      palette,
      fixed: { w: 5, h: 1 },
      cropToSubject: false,
      removeBg: 'none',
      smooth: 'none',
      scale: 'box',
    });
    expect(actual.cells[0]!.map((cell, index) => cell.code)).toEqual(expected.map((index) => palette[index]!.code));
  });

  it('ForegroundMask coverage 拒绝 NaN、负值和大于 1', () => {
    const img = makeImage(1, 1, () => [20, 30, 40, 255]);
    for (const value of [Number.NaN, -0.1, 1.1]) {
      const mask = { width: 1, height: 1, coverage: new Float32Array([value]) };
      expect(() => areaResampleToGrid(img, 1, 1, { mask })).toThrow(/coverage/);
    }
  });

  it('smoothSigma 必须 finite、正数且不超过 64', () => {
    const img = makeImage(2, 2, () => [20, 30, 40, 255]);
    for (const smoothSigma of [Number.NaN, 0, -1, 65]) {
      expect(() => generatePatternBead(img, {
        palette: [{ code: 'A', hex: '141E28' }],
        fixed: { w: 1, h: 1 },
        cropToSubject: false,
        removeBg: 'none',
        smooth: 'gauss',
        smoothSigma,
      })).toThrow(/smoothSigma|sigma/);
    }
    expect(() => generatePatternBead(img, {
      palette: [{ code: 'A', hex: '141E28' }],
      fixed: { w: 1, h: 1 },
      cropToSubject: false,
      removeBg: 'none',
      smooth: 'gauss',
      smoothSigma: Infinity,
    })).toThrow(/smoothSigma|sigma/);
  });

  it('sRGB 与 linear 往返稳定', () => {
    for (const value of [0, 1, 12, 64, 128, 200, 255]) {
      expect(linearToSrgb(srgbToLinear(value))).toBeCloseTo(value, 10);
    }
  });

  it('3→2 与手算面积 oracle 一致', () => {
    const img = makeImage(3, 1, (x) => [[0, 0, 0, 255], [60, 60, 60, 255], [180, 180, 180, 255]][x]! as [number, number, number, number]);
    const grid = areaResampleToGrid(img, 2, 1);
    const l60 = srgbToLinear(60);
    const l180 = srgbToLinear(180);
    expect(grid.linearRgb[0]!).toBeCloseTo(l60 / 3, 7);
    expect(grid.linearRgb[3]!).toBeCloseTo((l60 / 3) + (l180 * 2 / 3), 7);
    expect(Array.from(grid.coverage)).toEqual([1, 1]);
  });

  it('5→3 coverage oracle 精确计入部分像素', () => {
    const img = makeImage(5, 1, (x) => [100, 100, 100, x === 2 ? 255 : 0]);
    const grid = areaResampleToGrid(img, 3, 1);
    expect(grid.coverage[0]!).toBeCloseTo(0, 12);
    expect(grid.coverage[1]!).toBeCloseTo(3 / 5, 6);
    expect(grid.coverage[2]!).toBeCloseTo(0, 12);
  });

  it('透明像素隐藏 RGB 不污染 linear RGB、variance 与 edge', () => {
    const a = makeImage(4, 2, (x) => x < 2 ? [80, 100, 120, 255] : [0, 0, 0, 0]);
    const b = makeImage(4, 2, (x, y) => x < 2 ? [80, 100, 120, 255] : [255, y * 200, 73, 0]);
    const ga = areaResampleToGrid(a, 2, 1);
    const gb = areaResampleToGrid(b, 2, 1);
    expect(Array.from(ga.linearRgb)).toEqual(Array.from(gb.linearRgb));
    expect(Array.from(ga.coverage)).toEqual(Array.from(gb.coverage));
    expect(Array.from(ga.variance)).toEqual(Array.from(gb.variance));
    expect(Array.from(ga.edgeX)).toEqual(Array.from(gb.edgeX));
    expect(Array.from(ga.edgeY)).toEqual(Array.from(gb.edgeY));
  });

  it('DPID lambda=0 在非纯色非整数比例下等价 area', () => {
    const img = makeImage(5, 3, (x, y) => [x * 41 + y * 7, 220 - x * 23, y * 80, (x + y) % 4 === 0 ? 96 : 255]);
    const area = areaResampleToGrid(img, 3, 2);
    const dpid = dpidResampleToGrid(img, 3, 2, { lambda: 0 });
    expect(Array.from(dpid.linearRgb)).toEqual(Array.from(area.linearRgb));
    expect(Array.from(dpid.coverage)).toEqual(Array.from(area.coverage));
    expect(Array.from(dpid.variance)).toEqual(Array.from(area.variance));
    expect(Array.from(dpid.edgeX)).toEqual(Array.from(area.edgeX));
    expect(Array.from(dpid.edgeY)).toEqual(Array.from(area.edgeY));
  });

  it('DPID lambda=1 与官方 sRGB 欧氏距离 reference oracle 一致', () => {
    const img = makeImage(3, 1, (x) => [[0, 0, 0, 255], [90, 30, 0, 255], [255, 255, 255, 255]][x]! as [number, number, number, number]);
    const actual = dpidResampleToGrid(img, 1, 1, { lambda: 1 });
    const areaGrid = areaResampleToGrid(img, 1, 1);
    const local = [
      linearToSrgb(areaGrid.linearRgb[0]!),
      linearToSrgb(areaGrid.linearRgb[1]!),
      linearToSrgb(areaGrid.linearRgb[2]!),
    ];
    const colors = [[0, 0, 0], [90, 30, 0], [255, 255, 255]];
    const norm = Math.sqrt(3 * 255 * 255);
    const weights = colors.map(([r, g, b]) => Math.hypot(local[0]! - r!, local[1]! - g!, local[2]! - b!) / norm);
    const sum = weights.reduce((a, b) => a + b, 0);
    const expectedSrgb = [0, 1, 2].map((channel) => colors.reduce((acc, color, index) => acc + color[channel]! * weights[index]!, 0) / sum);
    expect(actual.linearRgb[0]!).toBeCloseTo(srgbToLinear(expectedSrgb[0]!), 5);
    expect(actual.linearRgb[1]!).toBeCloseTo(srgbToLinear(expectedSrgb[1]!), 5);
    expect(actual.linearRgb[2]!).toBeCloseTo(srgbToLinear(expectedSrgb[2]!), 5);
  });

  it('DPID 正 lambda 对细线输出与 area 不同', () => {
    const img = makeImage(32, 32, (x) => x >= 14 && x < 18 ? [0, 0, 0, 255] : [255, 255, 255, 255]);
    const area = gridSamplesToRgba(areaResampleToGrid(img, 2, 2));
    const dpid = gridSamplesToRgba(dpidResampleToGrid(img, 2, 2, { lambda: 1 }));
    expect(Array.from(dpid.data)).not.toEqual(Array.from(area.data));
    expect(dpid.data[0]!).toBeLessThan(area.data[0]!);
  });

  it('验证目标尺寸、mask 尺寸和 DPID lambda', () => {
    const img = makeImage(3, 2, () => [0, 0, 0, 255]);
    expect(() => areaResampleToGrid(img, 1.5, 1)).toThrow(/整数/);
    expect(() => areaResampleToGrid(img, 0, 1)).toThrow(/正整数/);
    expect(() => dpidResampleToGrid(img, 1, 1, { lambda: -1 })).toThrow(/lambda/);
    const wrongMask = buildForegroundMask(makeImage(2, 2, () => [0, 0, 0, 255]), { mode: 'none' });
    expect(() => areaResampleToGrid(img, 1, 1, { mask: wrongMask })).toThrow(/mask/);
  });
});
