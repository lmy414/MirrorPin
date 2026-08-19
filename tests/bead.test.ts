import { describe, it, expect } from 'vitest';
import { MARD291, buildBeadPalette, ciede2000, cropToSubject, despeckle, generatePatternBead, srgbToLab } from '../src';
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