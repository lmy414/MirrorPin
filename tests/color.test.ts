import { describe, it, expect } from 'vitest';
import { hexToRgb, oklabDistance, rgbToHex, srgbToOklab } from '../src';

describe('色彩空间', () => {
  it('sRGB 白 → Oklab ≈ L=1,a=0,b=0', () => {
    const lab = srgbToOklab({ r: 255, g: 255, b: 255 });
    expect(lab.l).toBeCloseTo(1, 5);
    expect(lab.a).toBeCloseTo(0, 5);
    expect(lab.b).toBeCloseTo(0, 5);
  });

  it('sRGB 黑 → Oklab ≈ L=0', () => {
    const lab = srgbToOklab({ r: 0, g: 0, b: 0 });
    expect(lab.l).toBeCloseTo(0, 5);
  });

  it('Oklab 色差对称', () => {
    const a = srgbToOklab({ r: 200, g: 40, b: 40 });
    const b = srgbToOklab({ r: 30, g: 180, b: 90 });
    expect(oklabDistance(a, b)).toBeCloseTo(oklabDistance(b, a), 10);
    expect(oklabDistance(a, a)).toBe(0);
  });

  it('纯白与纯黑 Oklab 距离约 1（可分辨性强）', () => {
    const d = oklabDistance(
      srgbToOklab({ r: 255, g: 255, b: 255 }),
      srgbToOklab({ r: 0, g: 0, b: 0 }),
    );
    expect(d).toBeGreaterThan(0.9);
    expect(d).toBeLessThanOrEqual(1.0);
  });

  it('hexToRgb 支持带/不带 #', () => {
    expect(hexToRgb('F9F0CD')).toEqual({ r: 249, g: 240, b: 205 });
    expect(hexToRgb('#F9f0cd')).toEqual({ r: 249, g: 240, b: 205 });
  });

  it('hexToRgb 非法输入抛错', () => {
    expect(() => hexToRgb('GGGGGG')).toThrow();
    expect(() => hexToRgb('FFF')).toThrow();
  });

  it('rgbToHex 与 hexToRgb 往返一致', () => {
    const hex = 'F9F0CD';
    expect(rgbToHex(hexToRgb(hex))).toBe(hex);
  });
});