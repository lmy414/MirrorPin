import { describe, it, expect } from 'vitest';
import { mergeRegions, removeBackground } from '../src';
import type { Cell } from '../src';

// MARD 实际色值（code 与 hex 一致，用真实色避免依赖色板以外的颜色）
const RED = 'D50E21'; // R1  纯红
const GREEN = '1EF942'; // B4 亮绿
const PINK = 'FFC9D6'; // E18 粉红

function cell(hex: string): Cell {
  return { code: hex, hex, external: false };
}

function grid(rows: string[][]): Cell[][] {
  return rows.map((r) => r.map(cell));
}

describe('mergeRegions 区域合并', () => {
  it('同色连通块整体识别（threshold=0 仅合并同色）', () => {
    const out = mergeRegions(
      grid([
        [RED, RED, RED],
        [RED, RED, RED],
      ]),
      0,
    );
    for (const row of out) for (const c of row) expect(c.code).toBe(RED);
  });

  it('两块分隔的独立区域不被合并（threshold=0）', () => {
    const out = mergeRegions(
      grid([
        [RED, RED, GREEN, GREEN],
        [RED, RED, GREEN, GREEN],
      ]),
      0,
    );
    expect(out[0]![0]!.code).toBe(RED);
    expect(out[0]![3]!.code).toBe(GREEN);
    expect(out[1]![1]!.code).toBe(RED);
    expect(out[1]![2]!.code).toBe(GREEN);
  });

  it('阈值为 1 时全图连通，统一为出现次数最多的色（杂色被众数吃掉）', () => {
    const out = mergeRegions(
      grid([
        [RED, RED, RED, PINK],
        [RED, RED, RED, RED],
        [RED, RED, RED, RED],
        [RED, RED, RED, RED],
      ]),
      1,
    );
    const codes = out.flat().map((c) => c.code);
    expect(codes.every((c) => c === RED)).toBe(true);
  });
});

describe('removeBackground 背景移除', () => {
  const WHITE = 'FFFFFF';
  // 5x5：白色边框 + 中心白色孔洞，其余红色
  function whiteFrame(): Cell[][] {
    const rows: string[][] = [];
    for (let y = 0; y < 5; y++) {
      const r: string[] = [];
      for (let x = 0; x < 5; x++) {
        const border = x === 0 || x === 4 || y === 0 || y === 4;
        r.push(border || (x === 2 && y === 2) ? WHITE : RED);
      }
      rows.push(r);
    }
    return grid(rows);
  }

  it('边界连通近白标为 external', () => {
    const out = removeBackground(whiteFrame(), 0.08);
    expect(out[0]![0]!.external).toBe(true);
    expect(out[0]![2]!.external).toBe(true);
    expect(out[4]![4]!.external).toBe(true);
  });

  it('内部白色孔洞（不与边界连通）得到保留', () => {
    const out = removeBackground(whiteFrame(), 0.08);
    expect(out[2]![2]!.external).toBe(false);
    expect(out[1]![1]!.external).toBe(false);
  });

  it('非近白边界格不被删除（红色距白远）', () => {
    const out = removeBackground(
      grid([
        [RED, WHITE],
        [WHITE, WHITE],
      ]),
      0.08,
    );
    expect(out[0]![0]!.external).toBe(false);
  });
});