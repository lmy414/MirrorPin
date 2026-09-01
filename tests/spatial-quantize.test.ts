import { describe, expect, it } from 'vitest';
import {
  buildPaletteCandidates,
  optimizeSpatialLabels,
  resolveSpatialQuantizeOptions,
  srgbToLab,
  ciede2000,
  srgbToLinear,
  type GridSamples,
  type SpatialQuantizeOptions,
} from '../src';
import type { Swatch } from '../src';

function samples(width: number, height: number, colors: Array<[number, number, number]>, coverage?: number[]): GridSamples {
  const n = width * height;
  const linearRgb = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const color = colors[i] ?? [0, 0, 0];
    linearRgb[i * 3] = srgbToLinear(color[0]);
    linearRgb[i * 3 + 1] = srgbToLinear(color[1]);
    linearRgb[i * 3 + 2] = srgbToLinear(color[2]);
  }
  return {
    width,
    height,
    linearRgb,
    coverage: Float32Array.from(coverage ?? new Array(n).fill(1)),
    variance: new Float32Array(n),
    edgeX: new Float32Array(n),
    edgeY: new Float32Array(n),
  };
}

const palette: readonly Swatch[] = [
  { code: 'A', hex: '000000' },
  { code: 'B', hex: 'FFFFFF' },
  { code: 'C', hex: 'FF0000' },
];

const baseOptions = {
  enabled: true,
  topK: 2,
  smoothness: 1,
  edgeSigma: 1,
  maxIterations: 8,
  cleanupMaxSize: 2,
  cleanupConfidence: 0.2,
} as const;

describe('top-K CIEDE2000 palette candidates', () => {
  it('returns exact pixel-major labels, costs, and best-to-second margin', () => {
    const input = samples(2, 1, [[0, 0, 0], [255, 0, 0]]);
    const result = buildPaletteCandidates(input, palette, 2);
    expect(result.topK).toBe(2);
    expect(Array.from(result.labels)).toEqual([0, 2, 2, 1]);
    const black = srgbToLab({ r: 0, g: 0, b: 0 });
    const white = srgbToLab({ r: 255, g: 255, b: 255 });
    const red = srgbToLab({ r: 255, g: 0, b: 0 });
    expect(result.costs[0]).toBeCloseTo(0, 7);
    expect(result.costs[1]).toBeCloseTo(ciede2000(black, red), 5);
    expect(result.bestMargin[0]).toBeCloseTo(result.costs[1]! - result.costs[0]!, 5);
    expect(result.bestMargin[1]).toBeGreaterThan(0);
    void white;
  });

  it('uses deterministic code then index tie breaks and defines K=1 margin', () => {
    const tied: readonly Swatch[] = [
      { code: 'Z', hex: '000000' },
      { code: 'A', hex: '000000' },
    ];
    const result = buildPaletteCandidates(samples(1, 1, [[0, 0, 0]]), tied, 1);
    expect(Array.from(result.labels)).toEqual([1]);
    expect(Array.from(result.bestMargin)).toEqual([0]);
    expect(Array.from(result.costs)).toEqual([0]);
  });

  it('excludes transparent and invalid cells from optimization and pairwise pressure', () => {
    const input = samples(3, 1, [[0, 0, 0], [255, 255, 255], [0, 0, 0]], [1, 0, 1]);
    input.linearRgb[3] = Number.NaN;
    input.edgeX[0] = 1000;
    input.edgeX[1] = 1000;
    const candidates = buildPaletteCandidates(input, palette, 2);
    expect(candidates.costs[2]).toBe(Infinity);
    const result = optimizeSpatialLabels(input, candidates, palette, baseOptions);
    expect(result.labels[1]).toBe(0);
    expect(Number.isFinite(result.energyBefore)).toBe(true);
    expect(Number.isFinite(result.energyAfter)).toBe(true);
  });

  it('rejects malformed candidate arrays and invalid requested K', () => {
    const input = samples(1, 1, [[0, 0, 0]]);
    expect(() => buildPaletteCandidates(input, palette, 0)).toThrow(/topK/);
    expect(() => buildPaletteCandidates(input, palette, 1.5)).toThrow(/整数/);
    expect(() => optimizeSpatialLabels(input, {
      labels: new Uint16Array(1),
      costs: new Float32Array(1),
      bestMargin: new Float32Array(1),
      topK: 2,
    }, palette, baseOptions)).toThrow(/长度|topK/);
  });
});

describe('deterministic edge-sensitive Potts/ICM optimization', () => {
  it('reduces a noisy flat singleton while preserving a strong source edge', () => {
    const input = samples(5, 1, [[0, 0, 0], [255, 255, 255], [0, 0, 0], [255, 255, 255], [255, 255, 255]]);
    input.edgeX.fill(0);
    const candidates = buildPaletteCandidates(input, palette, 2);
    const result = optimizeSpatialLabels(input, candidates, palette, {
      ...baseOptions,
      smoothness: 100,
      edgeSigma: 1,
    });
    expect(new Set(result.labels).size).toBeLessThanOrEqual(2);
    expect(Array.from(result.labels)).not.toEqual([0, 1, 0, 1, 1]);
    expect(result.energyAfter).toBeLessThanOrEqual(result.energyBefore);

    const edgeInput = samples(3, 1, [[0, 0, 0], [0, 0, 0], [255, 255, 255]]);
    edgeInput.edgeX[1] = 100;
    const edgeCandidates = buildPaletteCandidates(edgeInput, palette, 2);
    const edgeResult = optimizeSpatialLabels(edgeInput, edgeCandidates, palette, {
      ...baseOptions,
      smoothness: 100,
      edgeSigma: 1,
    });
    expect(Array.from(edgeResult.labels)).toEqual([0, 0, 1]);
  });

  it('considers current neighbor labels outside each pixel own top-K', () => {
    const input = samples(2, 1, [[0, 0, 0], [255, 0, 0]]);
    const candidates = buildPaletteCandidates(input, palette, 1);
    expect(Array.from(candidates.labels)).toEqual([0, 2]);
    input.edgeX[0] = 0;
    const result = optimizeSpatialLabels(input, candidates, palette, {
      ...baseOptions,
      topK: 1,
      smoothness: 1000,
    });
    expect(new Set(result.labels).size).toBe(1);
  });

  it('supports 1xN, Nx1, and rectangular grids with repeat byte identity', () => {
    for (const [width, height] of [[4, 1], [1, 4], [2, 3]] as Array<[number, number]>) {
      const input = samples(width, height, new Array(width * height).fill([90, 90, 90] as [number, number, number]));
      const candidates = buildPaletteCandidates(input, palette, 2);
      const a = optimizeSpatialLabels(input, candidates, palette, baseOptions);
      const b = optimizeSpatialLabels(input, candidates, palette, baseOptions);
      expect(Array.from(a.labels)).toEqual(Array.from(b.labels));
      expect(a.energyAfter).toBe(a.energyBefore);
    }
  });

  it('uses higher global usage for an initialization tie before code/index tie-break', () => {
    const tiedPalette: readonly Swatch[] = [
      { code: 'A', hex: '000000' },
      { code: 'Z', hex: '000000' },
    ];
    const input = samples(3, 1, [[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
    const candidates = {
      labels: new Uint16Array([0, 1, 1, 0, 1, 1]),
      costs: new Float32Array([0, 0, 0, 0, 0, 0]),
      bestMargin: new Float32Array([0, 0, 0]),
      topK: 2,
    };
    const result = optimizeSpatialLabels(input, candidates, tiedPalette, {
      ...baseOptions,
      maxIterations: 0,
      smoothness: 0,
    });
    expect(Array.from(result.labels)).toEqual([1, 1, 1]);
  });

  it('uses palette code then index when tied initialization usage is equal', () => {
    const tiedPalette: readonly Swatch[] = [
      { code: 'Z', hex: '000000' },
      { code: 'A', hex: '000000' },
    ];
    const input = samples(2, 1, [[0, 0, 0], [0, 0, 0]]);
    const candidates = {
      labels: new Uint16Array([0, 1, 1, 0]),
      costs: new Float32Array([0, 0, 0, 0]),
      bestMargin: new Float32Array([0, 0]),
      topK: 2,
    };
    const result = optimizeSpatialLabels(input, candidates, tiedPalette, {
      ...baseOptions,
      maxIterations: 0,
      smoothness: 0,
    });
    expect(Array.from(result.labels)).toEqual([1, 1]);
  });

  it('uses dynamic global usage before code/index among equally improving sweep moves', () => {
    const tiedPalette: readonly Swatch[] = [
      { code: 'A', hex: '000000' },
      { code: 'B', hex: '000000' },
      { code: 'C', hex: 'FFFFFF' },
    ];
    const input = samples(4, 1, [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]);
    const candidates = {
      labels: new Uint16Array([2, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]),
      costs: new Float32Array([100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      bestMargin: new Float32Array([0, 0, 0, 0]),
      topK: 3,
    };
    const result = optimizeSpatialLabels(input, candidates, tiedPalette, {
      ...baseOptions,
      maxIterations: 1,
      smoothness: 0,
    });
    expect(result.labels[0]).toBe(1);
  });

  it('updates global usage after an accepted move before a later equally improving decision', () => {
    const tiedPalette: readonly Swatch[] = [
      { code: 'A', hex: '000000' },
      { code: 'B', hex: 'FFFFFF' },
      { code: 'Z', hex: '000000' },
    ];
    const input = samples(5, 1, [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]);
    const candidates = {
      labels: new Uint16Array([
        1, 0, 0,
        1, 0, 2,
        0, 0, 0,
        2, 2, 2,
        2, 2, 2,
      ]),
      costs: new Float32Array([
        100, 0, 0,
        100, 0, 0,
        0, 0, 0,
        0, 0, 0,
        0, 0, 0,
      ]),
      bestMargin: new Float32Array(5),
      topK: 3,
    };
    const result = optimizeSpatialLabels(input, candidates, tiedPalette, {
      ...baseOptions,
      maxIterations: 1,
      smoothness: 0,
    });
    expect(Array.from(result.labels.slice(0, 2))).toEqual([0, 0]);
  });

  it('validates GridSamples numeric contracts while allowing hidden RGB in coverage-zero cells', () => {
    const input = samples(1, 1, [[0, 0, 0]]);
    for (const field of ['variance', 'edgeX', 'edgeY'] as const) {
      const malformed = samples(1, 1, [[0, 0, 0]]);
      malformed[field][0] = Number.NaN;
      expect(() => buildPaletteCandidates(malformed, palette, 1)).toThrow(field);
      malformed[field][0] = -0.01;
      expect(() => buildPaletteCandidates(malformed, palette, 1)).toThrow(field);
    }
    const outOfRange = samples(1, 1, [[0, 0, 0]]);
    outOfRange.linearRgb[0] = 1.01;
    expect(() => buildPaletteCandidates(outOfRange, palette, 1)).toThrow(/linearRgb/);
    const hidden = samples(1, 1, [[0, 0, 0]], [0]);
    hidden.linearRgb[0] = Number.NaN;
    hidden.linearRgb[1] = Infinity;
    hidden.linearRgb[2] = -Infinity;
    expect(() => buildPaletteCandidates(hidden, palette, 1)).not.toThrow();
  });

  it('uses edgeY for vertical strong-edge preservation', () => {
    const input = samples(1, 3, [[0, 0, 0], [0, 0, 0], [255, 255, 255]]);
    input.edgeY[1] = 100;
    const candidates = buildPaletteCandidates(input, palette, 2);
    const result = optimizeSpatialLabels(input, candidates, palette, {
      ...baseOptions,
      smoothness: 100,
      edgeSigma: 1,
    });
    expect(Array.from(result.labels)).toEqual([0, 0, 1]);
  });

  it('keeps 104x104 top-K=8 bounded, finite, and deterministic without a wall-clock gate', () => {
    const width = 104;
    const height = 104;
    const colors: Array<[number, number, number]> = [];
    for (let pixel = 0; pixel < width * height; pixel++) {
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      colors.push([(x * 13 + y * 7) % 256, (x * 5 + y * 17) % 256, (x * 19 + y * 3) % 256]);
    }
    const largePalette: readonly Swatch[] = [
      { code: 'A', hex: '000000' }, { code: 'B', hex: 'FFFFFF' }, { code: 'C', hex: 'FF0000' },
      { code: 'D', hex: '00FF00' }, { code: 'E', hex: '0000FF' }, { code: 'F', hex: 'FFFF00' },
      { code: 'G', hex: '00FFFF' }, { code: 'H', hex: 'FF00FF' }, { code: 'I', hex: '808080' },
    ];
    const input = samples(width, height, colors);
    const candidatesA = buildPaletteCandidates(input, largePalette, 8);
    const candidatesB = buildPaletteCandidates(input, largePalette, 8);
    expect(candidatesA.topK).toBe(8);
    expect(candidatesA.labels.length).toBe(width * height * 8);
    expect(candidatesA.costs.length).toBe(width * height * 8);
    expect(candidatesA.bestMargin.length).toBe(width * height);
    expect(Array.from(candidatesA.labels)).toEqual(Array.from(candidatesB.labels));
    expect(Array.from(candidatesA.costs)).toEqual(Array.from(candidatesB.costs));
    const options = { ...baseOptions, topK: 8, maxIterations: 2, smoothness: 0.2 };
    const resultA = optimizeSpatialLabels(input, candidatesA, largePalette, options);
    const resultB = optimizeSpatialLabels(input, candidatesB, largePalette, options);
    expect(resultA.labels.length).toBe(width * height);
    expect(resultA.iterations).toBeLessThanOrEqual(options.maxIterations);
    expect(Number.isFinite(resultA.energyBefore)).toBe(true);
    expect(Number.isFinite(resultA.energyAfter)).toBe(true);
    expect(resultA.energyAfter).toBeLessThanOrEqual(resultA.energyBefore);
    expect(Array.from(resultA.labels)).toEqual(Array.from(resultB.labels));
    expect(resultA.energyAfter).toBe(resultB.energyAfter);
  });
});

describe('SpatialQuantizeOptions validation', () => {
  it('supplies defaults and rejects nonfinite, negative, or noninteger values', () => {
    expect(resolveSpatialQuantizeOptions()).toEqual({
      enabled: true,
      topK: 8,
      smoothness: 0.35,
      edgeSigma: 0.12,
      maxIterations: 6,
      cleanupMaxSize: 2,
      cleanupConfidence: 0.25,
    });
    const invalid: SpatialQuantizeOptions[] = [
      { topK: 0 }, { topK: 1.5 }, { smoothness: -1 }, { smoothness: Number.NaN },
      { edgeSigma: 0 }, { edgeSigma: -1 }, { edgeSigma: Infinity },
      { maxIterations: -1 }, { maxIterations: 1.5 }, { cleanupMaxSize: -1 },
      { cleanupMaxSize: 1.5 }, { cleanupConfidence: -0.1 }, { cleanupConfidence: 1.1 },
      { cleanupConfidence: Number.NaN },
    ];
    for (const options of invalid) expect(() => resolveSpatialQuantizeOptions(options)).toThrow();
  });
});
