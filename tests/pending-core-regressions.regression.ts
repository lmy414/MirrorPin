import { describe, expect, it } from 'vitest';
import { generatePatternBead, l0Smooth } from '../src';
import { makeImage } from './helpers';

describe('后续核心修复门禁：L0', () => {
  it('必须非恒等、降低平坦区噪声并保留强阶跃', () => {
    const img = makeImage(32, 32, (x, y) => {
      const base = x < 16 ? 120 : 180;
      const noise = ((x * 17 + y * 31) % 7) - 3;
      return [base + noise, base + noise, base + noise, 255];
    });
    const out = l0Smooth(img, { lam: 0.02 });

    let changed = 0;
    let beforeNoise = 0;
    let afterNoise = 0;
    for (let y = 4; y < 28; y++) {
      for (let x = 4; x < 12; x++) {
        const i = (y * 32 + x) * 4;
        if (out.data[i] !== img.data[i]) changed++;
        beforeNoise += Math.abs(img.data[i]! - 120);
        afterNoise += Math.abs(out.data[i]! - 120);
      }
    }
    expect(changed).toBeGreaterThan(0);
    expect(afterNoise).toBeLessThan(beforeNoise);
    expect(Math.abs(out.data[(16 * 32 + 20) * 4]! - out.data[(16 * 32 + 12) * 4]!)).toBeGreaterThan(40);
  });
});

describe('后续核心修复门禁：fixed DPID', () => {
  it('fixed 尺寸 scale=dpid 必须与 box 真实不同', () => {
    const palette = [
      { code: 'K', hex: '000000' },
      { code: 'W', hex: 'FFFFFF' },
    ] as const;
    const img = makeImage(32, 32, (x) => x >= 14 && x < 18 ? [0, 0, 0, 255] : [255, 255, 255, 255]);
    const box = generatePatternBead(img, {
      palette,
      fixed: { w: 2, h: 2 },
      scale: 'box',
      cropToSubject: false,
    });
    const dpid = generatePatternBead(img, {
      palette,
      fixed: { w: 2, h: 2 },
      scale: 'dpid',
      dpidLambda: 1,
      cropToSubject: false,
    });
    expect(dpid.cells.map((row) => row.map((cell) => cell.code))).not.toEqual(
      box.cells.map((row) => row.map((cell) => cell.code)),
    );
  });
});
