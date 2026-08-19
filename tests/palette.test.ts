import { describe, it, expect } from 'vitest';
import { MARD291, buildPalette, nearestSwatch } from '../src';
import { hexToRgb, oklabDistance, srgbToOklab } from '../src';

const entries = buildPalette(MARD291 as Parameters<typeof buildPalette>[0]);

describe('色卡最近邻匹配', () => {
  it('纯白应命中白色系（H2 FFFFFF）', () => {
    const swatch = nearestSwatch({ r: 255, g: 255, b: 255 }, entries);
    expect(swatch.code.startsWith('H')).toBe(true);
    expect(swatch.hex).toBe('FFFFFF');
  });

  it('纯黑应命中黑色系（H7 000000）', () => {
    const swatch = nearestSwatch({ r: 0, g: 0, b: 0 }, entries);
    expect(swatch.code.startsWith('H')).toBe(true);
    expect(swatch.hex).toBe('000000');
  });

  it('返回结果确实是感知距离最近者', () => {
    const target = { r: 213, g: 43, b: 30 }; // 一种红
    const swatch = nearestSwatch(target, entries);
    const tLab = srgbToOklab(target);
    let min = Infinity;
    for (const e of entries) {
      min = Math.min(min, oklabDistance(tLab, e.lab));
    }
    expect(oklabDistance(tLab, srgbToOklab(hexToRgb(swatch.hex)))).toBeCloseTo(min, 10);
  });

  it('色板条目 rgb 与 hex 一致', () => {
    expect(entries.find((e) => e.swatch.code === 'A1')?.rgb).toEqual({ r: 249, g: 240, b: 205 });
  });
});