import { describe, it, expect } from 'vitest';
import { MARD291, generatePatternAdvanced, sampleGrid } from '../src';
import { makeImage } from './helpers';

describe('sampleGrid kmeans 模式', () => {
  it('格内多数色被取为代表性主簇', () => {
    // 4x4 单格：3 行红 + 1 行蓝 -> 主色应是红
    const img = makeImage(4, 4, (x, y) =>
      y < 3 ? [220, 30, 30, 255] : [30, 30, 220, 255],
    );
    const grid = sampleGrid(img, 1, 1, 'kmeans');
    const c = grid[0]![0]!;
    expect(c.r).toBeGreaterThan(150); // 主簇偏红
    expect(c.b).toBeLessThan(100);
  });

  it('与 dominant 在局部细节上的代表色都为合理色', () => {
    const img = makeImage(3, 3, (x, y) => {
      const colors = [
        [255, 0, 0], [0, 255, 0], [0, 0, 255],
        [255, 255, 0], [255, 0, 255], [0, 255, 255],
        [100, 100, 100], [200, 200, 200], [0, 0, 0],
      ];
      const c = colors[y * 3 + x]!;
      return [c[0], c[1], c[2], 255];
    });
    const grid = sampleGrid(img, 3, 3, 'kmeans');
    expect(grid).toHaveLength(3);
    expect(grid[0]).toHaveLength(3);
    for (const row of grid) for (const c of row) {
      expect(c.r).toBeGreaterThanOrEqual(0);
      expect(c.r).toBeLessThanOrEqual(255);
    }
  });
});

describe('generatePatternAdvanced（kmeans + 裁剪占满 + 智能背景）', () => {
  it('白背景居中红块 -> 主体仍保留，中心为红', () => {
    const img = makeImage(12, 12, (x, y) => {
      const core = x >= 4 && x < 8 && y >= 4 && y < 8;
      return core ? [213, 43, 30, 255] : [255, 255, 255, 255];
    });
    const g = generatePatternAdvanced(img, { cols: 8, palette: MARD291 });
    // 中心格是主体（红）
    expect(g.cells[3]![3]!.external).toBe(false);
    expect(g.cells[3]![3]!.code).toMatch(/^(R|F|A)/);
    expect(g.colorCount).toBeGreaterThanOrEqual(1);
  });

  it('cropToSubject=false 时不做裁剪，与全图一致', () => {
    const img = makeImage(12, 12, (x, y) => {
      const core = x >= 4 && x < 8 && y >= 4 && y < 8;
      return core ? [213, 43, 30, 255] : [255, 255, 255, 255];
    });
    const g = generatePatternAdvanced(img, { cols: 8, palette: MARD291, cropToSubject: false });
    // 未裁剪 -> 主体只占局部，角落仍是被移除的白色背景
    expect(g.cells[0]![0]!.external).toBe(true);
    expect(g.cells[3]![3]!.external).toBe(false);
  });

  it('透明背景竖条 -> 裁剪占满，竖条主体保留', () => {
    // 12x12，蓝色竖条 x4..7 y1..10，其余透明
    const img = makeImage(12, 12, (x, y) => {
      const bar = x >= 4 && x < 8 && y >= 1 && y < 11;
      return bar ? [30, 40, 200, 255] : [0, 0, 0, 0];
    });
    const g = generatePatternAdvanced(img, { cols: 6, palette: MARD291 });
    // 主体铺满网格：中央应为主体蓝
    expect(g.cells[2]![2]!.external).toBe(false);
    expect(g.cells[2]![2]!.code).toMatch(/^(C|D)/); // 蓝色系
  });
});