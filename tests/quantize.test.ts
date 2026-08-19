import { describe, it, expect } from 'vitest';
import { kmeansPalette } from '../src';
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

  it('k=1 时返回全局平均（近似）', () => {
    const pixels = [...cluster([100, 200, 50], 10), ...cluster([150, 250, 100], 10)];
    const [c] = kmeansPalette(pixels, 1);
    expect(c!.r).toBeGreaterThanOrEqual(100);
    expect(c!.r).toBeLessThanOrEqual(150);
  });
});