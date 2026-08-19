import { describe, it, expect } from 'vitest';
import { boxBlur, gaussianBlur, generatePatternSoft, MARD291 } from '../src';
import { makeImage, solidImage } from './helpers';

describe('gaussianBlur 预处理', () => {
  it('孤立亮点模糊后峰值降低、扩散到邻域', () => {
    const img = makeImage(3, 3, (x, y) =>
      x === 1 && y === 1 ? [200, 200, 200, 255] : [0, 0, 0, 255],
    );
    const out = gaussianBlur(img, 1);
    const center = (1 * 3 + 1) * 4;
    expect(out.data[center]).toBeGreaterThan(20);
    expect(out.data[center]).toBeLessThan(200);
  });

  it('sigma<=0 返回原图', () => {
    const img = solidImage(4, 4, [50, 60, 70]);
    expect(gaussianBlur(img, 0)).toBe(img);
  });

  it('不改变透明区域 alpha', () => {
    const img = makeImage(4, 1, (x) => (x < 2 ? [10, 10, 10, 255] : [10, 10, 10, 0]));
    const out = gaussianBlur(img, 1);
    expect(out.data[3]).toBe(255);
    expect(out.data[(0 * 4 + 3) * 4 + 3]).toBe(0);
  });
});

describe('boxBlur 预处理', () => {
  it('孤立亮点在模糊后向邻近像素扩散、峰值降低', () => {
    // 3x3，中心 200，其余 0
    const img = makeImage(3, 3, (x, y) =>
      x === 1 && y === 1 ? [200, 200, 200, 255] : [0, 0, 0, 255],
    );
    const out = boxBlur(img, 1);
    // 角点(0,0)在窗口内中心不在 -> 停留 0；中心因邻域含它自身网格 -1..1 平均下降
    const center = 1 * 3 + 1;
    const c = out.data[center * 4] as number;
    expect(c).toBeGreaterThan(20);
    expect(c).toBeLessThan(200);
  });

  it('radius<=0 返回原图（同引用）', () => {
    const img = solidImage(4, 4, [50, 60, 70]);
    expect(boxBlur(img, 0)).toBe(img);
  });

  it('不改变原始 alpha', () => {
    const img = makeImage(4, 1, (x) => (x < 2 ? [10, 10, 10, 255] : [10, 10, 10, 0]));
    const out = boxBlur(img, 1);
    expect(out.data[3]).toBe(255); // (0,0) 不透明
    expect(out.data[(0 * 4 + 3) * 4 + 3]).toBe(0); // (0,3) 透明保留
  });
});

describe('generatePatternSoft（模糊→映射→像素化）', () => {
  it('白背景居中红块 -> 主体保留（禁用裁剪与背景删除，弱模糊）', () => {
    // 10x10：中心 3x3 红，其余白
    const img = makeImage(10, 10, (x, y) => {
      const core = x >= 3 && x < 6 && y >= 3 && y < 6; // 去掉角落的孤立杂点，只留 3x3 红
      return core ? [213, 43, 30, 255] : [255, 255, 255, 255];
    });
    const g = generatePatternSoft(img, { cols: 8, palette: MARD291, blurRadius: 1, cropToSubject: false });
    // 中央格应为红色主体且非背景
    expect(g.cells[4]![4]!.external).toBe(false);
    expect(g.cells[4]![4]!.code).toMatch(/^(R|F|A)/);
    expect(g.colorCount).toBeGreaterThanOrEqual(1);
  });

  it('开启裁剪占满时主体仍保留', () => {
    const img = makeImage(12, 12, (x, y) => {
      const core = x >= 4 && x < 8 && y >= 4 && y < 8;
      return core ? [213, 43, 30, 255] : [255, 255, 255, 255];
    });
    const g = generatePatternSoft(img, { cols: 6, palette: MARD291, blurRadius: 1 });
    expect(g.cells[2]![2]!.external).toBe(false);
    expect(g.cells[2]![2]!.code).toMatch(/^(R|F|A)/);
  });
});