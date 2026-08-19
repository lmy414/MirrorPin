import { describe, it, expect } from 'vitest';
import { MARD291, generatePattern } from '../src';
import { makeImage, solidImage } from './helpers';

describe('generatePattern 端到端', () => {
  it('纯白图 → 全图背景 external，色号为白系', () => {
    const img = solidImage(4, 4, [255, 255, 255]);
    const g = generatePattern(img, { cols: 4, palette: MARD291 });
    expect(g.rows).toBe(4);
    expect(g.cols).toBe(4);
    for (const row of g.cells) for (const c of row) expect(c.external).toBe(true);
    // 去掉背景后无实质内容
    expect(g.colorCount).toBe(0);
  });

  it('白底中心红色方块 → 边缘删除、中心保留为红', () => {
    // 6x6：白背景，中心 2x2 纯红
    const img = makeImage(6, 6, (x, y) => {
      const core = x >= 2 && x <= 3 && y >= 2 && y <= 3;
      return core ? [213, 43, 30, 255] : [255, 255, 255, 255];
    });
    const g = generatePattern(img, { cols: 6, palette: MARD291 });

    // 四角为外部背景
    expect(g.cells[0]![0]!.external).toBe(true);
    expect(g.cells[0]![5]!.external).toBe(true);
    // 中心保留且为红系列
    expect(g.cells[2]![2]!.external).toBe(false);
    expect(g.cells[2]![2]!.code).toMatch(/^(F|A|R)/); // 红色系（MARD 纯红在 R 系列）
    expect(g.colorCount).toBeGreaterThanOrEqual(1);
  });

  it('removeBackground=false 时不标背景', () => {
    const img = solidImage(3, 3, [255, 255, 255]);
    const g = generatePattern(img, { cols: 3, palette: MARD291, removeBackground: false });
    for (const row of g.cells) for (const c of row) expect(c.external).toBe(false);
  });

  it('行数可自定义', () => {
    const g = generatePattern(solidImage(8, 4, [10, 200, 30]), {
      cols: 8,
      rows: 4,
      palette: MARD291,
    });
    expect(g.rows).toBe(4);
    expect(g.cols).toBe(8);
  });

  it('色号上限会影响归并结果（palette 可用子集）', () => {
    // 两种相近绿，用仅含这两种色的 palette 也能正常生成
    const palette = MARD291.filter((s) => s.code === 'B1');
    const g = generatePattern(solidImage(3, 3, [10, 200, 30]), {
      cols: 3,
      palette,
      removeBackground: false,
    });
    expect(g.cells[0]![0]!.code).toBe('B1');
  });
});