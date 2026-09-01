import { describe, expect, it } from 'vitest';
import { applyMaskForSmoothing } from '../src/core/smoothing';
import { gaussianBlur } from '../src/core/preprocess';
import { guidedSmooth } from '../src/core/guided';
import { l0Smooth } from '../src/core/l0';
import { extendMaskedRgb, type ForegroundMask } from '../src/core/background';
import { generatePatternBead } from '../src/beadpattern/core';
import { makeImage } from './helpers';
import type { RgbaImage } from '../src/core/types';

const SUBJECT_X0 = 2;
const SUBJECT_X1 = 10;
const SUBJECT_Y0 = 2;
const SUBJECT_Y1 = 10;

function fixture(width: number, background: [number, number, number]): { image: RgbaImage; mask: ForegroundMask } {
  const image = makeImage(width, 12, (x, y) => {
    if (x >= SUBJECT_X0 && x < SUBJECT_X1 && y >= SUBJECT_Y0 && y < SUBJECT_Y1) {
      return [40 + (x - SUBJECT_X0) * 24, 30 + (y - SUBJECT_Y0) * 20, 80 + ((x + y) % 3) * 35, 255];
    }
    return [...background, 0] as [number, number, number, number];
  });
  const coverage = new Float32Array(width * 12);
  for (let y = SUBJECT_Y0; y < SUBJECT_Y1; y++) {
    for (let x = SUBJECT_X0; x < SUBJECT_X1; x++) coverage[y * width + x] = 1;
  }
  return { image, mask: { width, height: 12, coverage } };
}

function smooth(kind: 'gauss' | 'guided' | 'l0', image: RgbaImage, coverage?: Float32Array): RgbaImage {
  if (kind === 'gauss') return gaussianBlur(image, 1, coverage);
  if (kind === 'guided') return guidedSmooth(image, { r: 2, eps: 30, coverage });
  return l0Smooth(image, { lam: 0.02 });
}

function subjectRgb(image: RgbaImage, width: number): number[] {
  const values: number[] = [];
  for (let y = SUBJECT_Y0; y < SUBJECT_Y1; y++) {
    for (let x = SUBJECT_X0; x < SUBJECT_X1; x++) {
      const o = (y * width + x) * 4;
      values.push(image.data[o]!, image.data[o + 1]!, image.data[o + 2]!);
    }
  }
  return values;
}

describe('mask-aware smoothing', () => {
  it.each(['gauss', 'guided', 'l0'] as const)('%s 不受 mask 外原始 RGB 与额外背景范围影响', (kind) => {
    const a = fixture(12, [240, 20, 220]);
    const b = fixture(20, [10, 230, 30]);
    const smoothedA = applyMaskForSmoothing(a.image, a.mask, (tile, coverage) => smooth(kind, tile, coverage));
    const smoothedB = applyMaskForSmoothing(b.image, b.mask, (tile, coverage) => smooth(kind, tile, coverage));
    expect(subjectRgb(smoothedA, a.image.width)).toEqual(subjectRgb(smoothedB, b.image.width));
    expect(Array.from(smoothedA.data.filter((_, i) => i % 4 === 3))).toEqual(Array.from(a.image.data.filter((_, i) => i % 4 === 3)));
    expect(Array.from(smoothedB.data.filter((_, i) => i % 4 === 3))).toEqual(Array.from(b.image.data.filter((_, i) => i % 4 === 3)));
  });

  it.each(['gauss', 'guided', 'l0'] as const)('真实 generatePatternBead %s 输出不受隐藏背景颜色影响', (kind) => {
    const a = fixture(12, [240, 20, 220]).image;
    const b = fixture(12, [10, 230, 30]).image;
    const options = {
      palette: [
        { code: 'A', hex: '281E50' },
        { code: 'B', hex: 'DCDC1E' },
        { code: 'C', hex: '1EE646' },
      ],
      fixed: { w: 8, h: 8 },
      cropToSubject: false,
      removeBg: 'none' as const,
      smooth: kind,
      smoothRadius: 2,
      smoothEps: 30,
      smoothLambda: 0.02,
      scale: 'box' as const,
    };
    expect(generatePatternBead(a, options).cells).toEqual(generatePatternBead(b, options).cells);
  });

  it.each(['gauss', 'guided'] as const)('%s 保留正 coverage 的原始 straight RGB，不预混 owner RGB', (kind) => {
    const image = makeImage(3, 1, (x) => [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]][x]! as [number, number, number, number]);
    const coverage = new Float32Array([1, 0.25, 0.5]);
    let tileCenter: number[] | undefined;
    const out = applyMaskForSmoothing(image, { width: 3, height: 1, coverage }, (tile, passedCoverage) => {
      expect(Array.from(passedCoverage)).toEqual(Array.from(coverage));
      tileCenter = Array.from(tile.data.slice(4, 7));
      return kind === 'gauss'
        ? gaussianBlur(tile, 1, passedCoverage)
        : guidedSmooth(tile, { r: 1, eps: 30, coverage: passedCoverage });
    });
    expect(tileCenter).toEqual([0, 255, 0]);
    expect(out.data[7]!).toBe(255);
  });

  it('guided 对 coverage=0 外部与 bbox 内部洞的 hidden RGB 不敏感', () => {
    const make = (outside: [number, number, number], hole: [number, number, number]) => {
      const image = makeImage(7, 1, (x) => {
        if (x === 0 || x === 6) return [...outside, 0] as [number, number, number, number];
        if (x === 3) return [...hole, 0] as [number, number, number, number];
        return [200, 20, 30, 255];
      });
      const coverage = new Float32Array([0, 1, 1, 0, 1, 1, 0]);
      return applyMaskForSmoothing(image, { width: 7, height: 1, coverage }, (tile, passedCoverage) => guidedSmooth(tile, { r: 2, eps: 30, coverage: passedCoverage }));
    };
    const a = make([0, 0, 0], [0, 0, 0]);
    const b = make([255, 255, 255], [255, 0, 255]);
    for (const x of [1, 2, 4, 5]) expect(Array.from(a.data.slice(x * 4, x * 4 + 3))).toEqual(Array.from(b.data.slice(x * 4, x * 4 + 3)));
  });

  it('coverage=0 的 hidden RGB 不参与 smoothing，内部洞也不污染前景', () => {
    const make = (hidden: [number, number, number]) => {
      const image = makeImage(5, 1, (x) => x === 2 ? [...hidden, 255] as [number, number, number, number] : [200, 20, 30, 255]);
      const coverage = new Float32Array([1, 1, 0, 1, 1]);
      return applyMaskForSmoothing(image, { width: 5, height: 1, coverage }, (tile, passedCoverage) => gaussianBlur(tile, 1, passedCoverage));
    };
    const a = make([0, 0, 0]);
    const b = make([255, 255, 255]);
    for (const x of [0, 1, 3, 4]) expect(Array.from(a.data.slice(x * 4, x * 4 + 3))).toEqual(Array.from(b.data.slice(x * 4, x * 4 + 3)));
  });

  it('证明旧 extendMaskedRgb 后直接平滑仍会把背景当作有效像素', () => {
    const pair = fixture(12, [240, 20, 220]);
    const polluted = extendMaskedRgb(pair.image, pair.mask);
    const baseline = smooth('guided', pair.image, pair.mask.coverage);
    const legacy = guidedSmooth(polluted, { r: 2, eps: 30 });
    expect(subjectRgb(legacy, pair.image.width)).not.toEqual(subjectRgb(baseline, pair.image.width));
  });
});
