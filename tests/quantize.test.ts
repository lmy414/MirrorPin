import { describe, it, expect } from 'vitest';
import { kmeansPalette, recoverEmptyCenters } from '../src';
import type { RGB } from '../src';

describe('K-Means++ 减色', () => {
  const cluster = (c: [number, number, number], n: number): RGB[] =>
    Array.from({ length: n }, () => ({ r: c[0], g: c[1], b: c[2] }));

  it('三簇清晰数据聚成 3 个接近簇心的中心', () => {
    const pixels = [
      ...cluster([250, 10, 10], 40), // 红簇
      ...cluster([10, 250, 10], 40), // 绿簇
      ...cluster([10, 10, 250], 40), // 蓝簇
    ];
    const centers = kmeansPalette(pixels, 3).map((c) => [c.r, c.g, c.b] as [number, number, number]);
    // 红绿蓝簇应各有一中心命中
    const redOk = centers.some(([r, g, b]) => r > 150 && g < 100 && b < 100);
    const greenOk = centers.some(([, g, b]) => g > 150 && b < 100);
    const blueOk = centers.some(([r, , b]) => b > 150 && r < 100);
    expect(redOk).toBe(true);
    expect(greenOk).toBe(true);
    expect(blueOk).toBe(true);
  });

  it('k 大于去重颜色数时退回去重集合', () => {
    const pixels = cluster([10, 20, 30], 5);
    const centers = kmeansPalette(pixels, 10);
    expect(centers).toHaveLength(1);
    expect(centers[0]!.r).toBe(10);
  });

  it('相同种子结果可复现', () => {
    const pixels = [
      ...cluster([200, 30, 30], 20),
      ...cluster([30, 200, 30], 20),
      ...cluster([30, 30, 200], 20),
      ...cluster([200, 200, 30], 20),
    ];
    expect(kmeansPalette(pixels, 4)).toEqual(kmeansPalette(pixels, 4));
  });

  it('同一颜色多重集合的 shuffled 输入返回完全一致且规范排序的中心', () => {
    const pixels = [
      ...cluster([240, 10, 20], 13),
      ...cluster([15, 230, 40], 9),
      ...cluster([20, 30, 220], 7),
      ...cluster([180, 180, 30], 5),
      ...cluster([70, 80, 90], 3),
    ];
    const shuffled = [...pixels].sort((a, b) => ((a.r * 17 + a.g * 31 + a.b * 13) % 19) - ((b.r * 17 + b.g * 31 + b.b * 13) % 19));
    const expected = kmeansPalette(pixels, 3, 99);
    expect(kmeansPalette(shuffled, 3, 99)).toEqual(expected);
    expect(expected).toEqual([...expected].sort((a, b) => a.r - b.r || a.g - b.g || a.b - b.b));
  });

  it('k=1 按原始像素频率返回全局平均', () => {
    const pixels = [...cluster([0, 0, 0], 9), ...cluster([255, 255, 255], 1)];
    expect(kmeansPalette(pixels, 1)).toEqual([{ r: 26, g: 26, b: 26 }]);
  });

  it('少数色不会因去重而获得与多数色相同的权重', () => {
    const pixels = [
      ...cluster([0, 0, 0], 90),
      ...cluster([100, 100, 100], 9),
      ...cluster([255, 255, 255], 1),
    ];
    const centers = kmeansPalette(pixels, 2).sort((a, b) => a.r - b.r);
    expect(centers[0]!.r).toBeLessThan(20);
    expect(centers[1]!.r).toBeGreaterThanOrEqual(100);
  });

  it('拒绝非整数 k 与 seed', () => {
    expect(() => kmeansPalette([{ r: 0, g: 0, b: 0 }], 1.5)).toThrow(/整数/);
    expect(() => kmeansPalette([{ r: 0, g: 0, b: 0 }], 1, 1.5)).toThrow(/整数/);
  });

  it('空簇恢复一次性为多个空簇选择不同的 weighted-error 样本', () => {
    const samples = [
      { color: { r: 0, g: 0, b: 0 }, weight: 10 },
      { color: { r: 80, g: 0, b: 0 }, weight: 3 },
      { color: { r: 160, g: 0, b: 0 }, weight: 2 },
      { color: { r: 255, g: 0, b: 0 }, weight: 1 },
    ];
    const centers = [
      { r: 0, g: 0, b: 0 },
      { r: 0, g: 0, b: 0 },
      { r: 0, g: 0, b: 0 },
    ];
    const assignment = new Int32Array([0, 0, 0, 0]);
    const recovered = recoverEmptyCenters(samples, centers, assignment, [1, 2]);
    expect(recovered).toEqual([
      { r: 255, g: 0, b: 0 },
      { r: 160, g: 0, b: 0 },
    ]);
    expect(assignment).toEqual(new Int32Array([0, 0, 0, 0]));
  });

  it('空簇恢复后 kmeans 返回有限且互异的中心', () => {
    const pixels = [
      ...cluster([0, 0, 0], 50),
      ...cluster([1, 1, 1], 1),
      ...cluster([2, 2, 2], 1),
      ...cluster([255, 255, 255], 50),
    ];
    const centers = kmeansPalette(pixels, 3, 7);
    expect(centers).toHaveLength(3);
    expect(new Set(centers.map((c) => `${c.r},${c.g},${c.b}`)).size).toBe(3);
    for (const center of centers) {
      expect(Number.isFinite(center.r + center.g + center.b)).toBe(true);
    }
  });
});