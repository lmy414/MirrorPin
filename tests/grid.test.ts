import { describe, it, expect } from 'vitest';
import { sampleGrid } from '../src';
import { makeImage } from './helpers';

describe('网格采样', () => {
  it('3x3 图每格纯色，dominant 逐格取到该格颜色', () => {
    // 每个格一个纯色：按 (gx,gy) 设色
    const img = makeImage(3, 3, (x, y) => {
      const colors: [number, number, number][][] = [
        [[255, 0, 0], [0, 255, 0], [0, 0, 255]],
        [[255, 255, 0], [255, 0, 255], [0, 255, 255]],
        [[100, 100, 100], [200, 200, 200], [0, 0, 0]],
      ];
      const c = colors[y]![x]!;
      return [c[0], c[1], c[2], 255];
    });
    const grid = sampleGrid(img, 3, 3, 'dominant');
    expect(grid[0]![0]).toEqual({ r: 255, g: 0, b: 0 });
    expect(grid[0]![1]).toEqual({ r: 0, g: 255, b: 0 });
    expect(grid[1]![2]).toEqual({ r: 0, g: 255, b: 255 });
    expect(grid[2]![2]).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('average 取格内均值', () => {
    // 2x2 图，左格两种色各半
    const img = makeImage(2, 1, (x) => (x === 0 ? [0, 0, 0, 255] : [100, 100, 100, 255]));
    const grid = sampleGrid(img, 2, 1, 'average');
    expect(grid[0]![0]).toEqual({ r: 0, g: 0, b: 0 });
    expect(grid[0]![1]).toEqual({ r: 100, g: 100, b: 100 });
  });

  it('忽略半透明像素（alpha < 128）', () => {
    const img = makeImage(2, 1, (x) =>
      x === 0 ? [255, 0, 0, 255] : [255, 255, 255, 0], // 右格全透明
    );
    const grid = sampleGrid(img, 2, 1, 'average');
    expect(grid[0]![0]).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('非法行列抛错', () => {
    const img = makeImage(4, 4);
    expect(() => sampleGrid(img, 0, 2)).toThrow();
    expect(() => sampleGrid(img, 2, -1)).toThrow();
  });
});