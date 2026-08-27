import { describe, it, expect } from 'vitest';
import { buildBeadPalette, mergeRareIdx } from '../src/beadpattern/core';
import type { Swatch } from '../src/core/types';

// 红 + 深红（互相接近）+ 绿 + 蓝
const swatches: Swatch[] = [
  { code: 'R1', hex: 'FF0000' },
  { code: 'R2', hex: 'CC0000' },
  { code: 'G1', hex: '00FF00' },
  { code: 'B1', hex: '0000FF' },
];

const countOf = (idx: Int32Array, v: number) => [...idx].filter((x) => x === v).length;

describe('mergeRareIdx 稀有色合并', () => {
  it('用量达标的色原样保留', () => {
    const p = buildBeadPalette(swatches);
    const idx = new Int32Array([0, 0, 0, 0, 0, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3]);
    const out = mergeRareIdx(idx, p, 5);
    expect([...out]).toEqual([...idx]);
  });

  it('稀有色并入 CIEDE2000 最近的在用色', () => {
    const p = buildBeadPalette(swatches);
    // R2 只 1 颗 → 并入最近的 R1，而不是绿
    const idx = new Int32Array([0, 0, 0, 0, 0, 1, 2, 2, 2, 2, 2]);
    const out = mergeRareIdx(idx, p, 5);
    expect(countOf(out, 1)).toBe(0);
    expect(countOf(out, 0)).toBe(6);
    expect(countOf(out, 2)).toBe(5);
  });

  it('级联合并：目标吸收用量后达标即停', () => {
    const p = buildBeadPalette(swatches);
    // R2(2) 并入 R1(3) → R1=5 达标，循环结束
    const idx = new Int32Array([0, 0, 0, 1, 1, 2, 2, 2, 2, 2]);
    const out = mergeRareIdx(idx, p, 5);
    expect(countOf(out, 0)).toBe(5);
    expect(countOf(out, 1)).toBe(0);
    expect(countOf(out, 2)).toBe(5);
  });

  it('只剩一色时不再合并', () => {
    const p = buildBeadPalette(swatches);
    const idx = new Int32Array([0, 0, 0]);
    const out = mergeRareIdx(idx, p, 100);
    expect([...out]).toEqual([0, 0, 0]);
  });

  it('minBeads<=1 原样返回', () => {
    const p = buildBeadPalette(swatches);
    const idx = new Int32Array([0, 1, 2, 3]);
    expect(mergeRareIdx(idx, p, 1)).toBe(idx);
    expect(mergeRareIdx(idx, p, 0)).toBe(idx);
  });
});
