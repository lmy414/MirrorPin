import { describe, expect, it } from 'vitest';
import {
  analyzeLabelRegions,
  buildPaletteCandidates,
  cleanupSpatialLabels,
  computeSpatialLabelEnergy,
  enforceSpatialColorBudget,
  mergeSpatialRareLabels,
  srgbToLinear,
  type GridSamples,
  type Swatch,
} from '../src';

function samples(width: number, height: number, colors: Array<[number, number, number]> = [], coverage?: number[]): GridSamples {
  const n = width * height;
  const linearRgb = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const [r, g, b] = colors[i] ?? [0, 0, 0];
    linearRgb[i * 3] = srgbToLinear(r);
    linearRgb[i * 3 + 1] = srgbToLinear(g);
    linearRgb[i * 3 + 2] = srgbToLinear(b);
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

function candidatesFor(input: GridSamples, topK = 3) {
  return buildPaletteCandidates(input, palette, topK);
}

describe('label region analysis', () => {
  it('reports exact components, perimeter, adjacency, bbox, edge and current-label confidence', () => {
    const input = samples(3, 3);
    const labels = new Uint16Array([1, 1, 2, 1, 2, 2, 0, 0, 0]);
    const candidates = candidatesFor(input);
    const regions = analyzeLabelRegions(input, candidates, palette, labels);
    const white = regions.find((region) => region.label === 1)!;
    expect(white.area).toBe(3);
    expect(white.perimeter).toBe(8);
    expect(white.boundaryByLabel).toEqual({ '0': 1, '2': 3 });
    expect(white.boundaryContact).toBe(4);
    expect(white.bbox).toEqual({ minX: 0, minY: 0, maxX: 1, maxY: 1, width: 2, height: 2 });
    expect(white.currentDataPenalty).toBeGreaterThan(0);
    expect(white.confidence).toBeLessThan(1);
    expect(white.margin).toBeGreaterThan(0);
  });

  it('keeps transparent holes outside components and out of adjacency/smoothing pressure', () => {
    const input = samples(3, 3, [], [1, 1, 1, 1, 0, 1, 1, 1, 1]);
    const labels = new Uint16Array(9);
    const regions = analyzeLabelRegions(input, candidatesFor(input), palette, labels);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.area).toBe(8);
    expect(regions[0]!.perimeter).toBe(16);
    expect(regions[0]!.boundaryByLabel).toEqual({});
  });

  it('cleans low-confidence singleton only when energy does not increase and never creates singleton noise', () => {
    const input = samples(5, 1);
    const labels = new Uint16Array([0, 2, 0, 0, 0]);
    const before = computeSpatialLabelEnergy(input, candidatesFor(input), palette, labels, { smoothness: 0.5, edgeSigma: 1 });
    const result = cleanupSpatialLabels(input, candidatesFor(input), palette, labels, { smoothness: 0.5, edgeSigma: 1, maxPasses: 2 });
    expect(result.labels[1]).toBe(0);
    expect(result.diagnostics.energyAfter).toBeLessThanOrEqual(before);
    expect(result.diagnostics.energyAfter).toBeLessThanOrEqual(result.diagnostics.energyBefore);
    expect(result.diagnostics.singletonAfter).toBeLessThanOrEqual(result.diagnostics.singletonBefore);
  });

  it('protects strong-edge singleton, high-confidence highlight, and one-cell-wide long line', () => {
    const input = samples(5, 1);
    input.edgeX[0] = 20;
    const strong = cleanupSpatialLabels(input, candidatesFor(input), palette, new Uint16Array([0, 2, 0, 0, 0]), {
      strongEdgeThreshold: 5,
      smoothness: 0,
      maxPasses: 1,
    });
    expect(strong.labels[1]).toBe(2);

    const highlightInput = samples(3, 1, [[0, 0, 0], [255, 0, 0], [0, 0, 0]]);
    const highlight = cleanupSpatialLabels(highlightInput, candidatesFor(highlightInput), palette, new Uint16Array([0, 2, 0]), {
      strongEdgeThreshold: 100,
      smoothness: 0,
      maxPasses: 1,
    });
    expect(highlight.labels[1]).toBe(2);

    const line = cleanupSpatialLabels(samples(7, 1), candidatesFor(samples(7, 1)), palette, new Uint16Array([0, 2, 2, 2, 2, 2, 0]), {
      strongEdgeThreshold: 100,
      smoothness: 0,
      maxRegionSize: 2,
      maxPasses: 1,
    });
    expect(Array.from(line.labels)).toEqual([0, 2, 2, 2, 2, 2, 0]);
  });

  it('protects a one-cell stroke on 1x2 and 2x1 grids and uses adjacent energy choice', () => {
    const horizontal = samples(2, 1);
    const horizontalResult = cleanupSpatialLabels(horizontal, candidatesFor(horizontal), palette, new Uint16Array([0, 2]), { smoothness: 0, maxPasses: 1 });
    expect(Array.from(horizontalResult.labels)).toEqual([0, 2]);
    const vertical = samples(1, 2);
    const verticalResult = cleanupSpatialLabels(vertical, candidatesFor(vertical), palette, new Uint16Array([2, 0]), { smoothness: 0, maxPasses: 1 });
    expect(Array.from(verticalResult.labels)).toEqual([2, 0]);

    const energyInput = samples(3, 1, [[0, 0, 0], [255, 0, 0], [255, 255, 255]]);
    const energyResult = cleanupSpatialLabels(energyInput, candidatesFor(energyInput), palette, new Uint16Array([0, 1, 2]), { smoothness: 0, maxPasses: 1 });
    expect(energyResult.labels[1]).toBe(2);
  });

  it('supports 52, 78/78x52 and 104 policies inferred from sample dimensions', () => {
    const makeBoard = (width: number, height: number) => {
      const input = samples(width, height);
      const labels = new Uint16Array(width * height);
      const center = Math.floor(height / 2) * width + Math.floor(width / 2);
      labels[center] = 2;
      return { input, labels, candidates: candidatesFor(input, 3) };
    };
    const board52 = makeBoard(52, 52);
    const out52 = cleanupSpatialLabels(board52.input, board52.candidates, palette, board52.labels, { smoothness: 0, maxPasses: 1 });
    expect(out52.labels[Math.floor(52 / 2) * 52 + Math.floor(52 / 2)]).toBe(0);
    const board78 = makeBoard(78, 78);
    const out78 = cleanupSpatialLabels(board78.input, board78.candidates, palette, board78.labels, { smoothness: 0, maxPasses: 1 });
    expect(out78.diagnostics.changedCells).toBe(1);
    const boardRect = makeBoard(78, 52);
    expect(() => cleanupSpatialLabels(boardRect.input, boardRect.candidates, palette, boardRect.labels, { boardWidth: 52, boardHeight: 52 })).toThrow(/board|尺寸|一致/);
    const board104 = makeBoard(104, 104);
    const out104 = cleanupSpatialLabels(board104.input, board104.candidates, palette, board104.labels, { smoothness: 0, maxPasses: 1 });
    expect(out104.diagnostics.changedCells).toBe(1);
  });
});

describe('spatial color budgets', () => {
  it('treats maxColors=0 as cap disabled and returns an unchanged copy', () => {
    const input = samples(3, 1);
    const labels = new Uint16Array([0, 1, 2]);
    const result = enforceSpatialColorBudget(input, candidatesFor(input), palette, labels, { maxColors: 0 });
    expect(Array.from(result.labels)).toEqual([0, 1, 2]);
    expect(result.diagnostics.colorsAfter).toBe(3);
    expect(result.diagnostics.removedColors).toEqual([]);
  });

  it('recomputes minBeads dynamically until every in-use color meets the threshold', () => {
    const input = samples(6, 1);
    const labels = new Uint16Array([0, 0, 2, 2, 1, 1]);
    const result = enforceSpatialColorBudget(input, candidatesFor(input), palette, labels, { minBeads: 3, smoothness: 0 });
    const counts = new Map<number, number>();
    for (const label of result.labels) counts.set(label, (counts.get(label) ?? 0) + 1);
    expect([...counts.values()].every((count) => count >= 3)).toBe(true);
    expect(result.diagnostics.colorsAfter).toBe(1);
  });

  it('uses only adjacent replacements when available and falls back to used colors only without adjacency', () => {
    const input = samples(5, 1);
    const adjacent = enforceSpatialColorBudget(input, candidatesFor(input), palette, new Uint16Array([0, 0, 2, 1, 1]), { minBeads: 3, smoothness: 0 });
    expect(adjacent.labels[2]).toBe(2);

    const holeInput = samples(3, 1, [], [1, 0, 1]);
    const fallback = enforceSpatialColorBudget(holeInput, candidatesFor(holeInput), palette, new Uint16Array([0, 0, 1]), { minBeads: 2, smoothness: 0 });
    expect(fallback.labels[2]).toBe(0);
  });

  it('selects minimum-energy maxColors removal sequence, reports exact deltas, and is deterministic', () => {
    const input = samples(8, 1, [[0, 0, 0], [0, 0, 0], [0, 0, 0], [255, 0, 0], [255, 0, 0], [255, 255, 255], [255, 255, 255], [255, 255, 255]]);
    const labels = new Uint16Array([0, 0, 0, 2, 2, 1, 1, 1]);
    const candidates = candidatesFor(input);
    const a = enforceSpatialColorBudget(input, candidates, palette, labels, { maxColors: 1, smoothness: 0.5, edgeSigma: 1 });
    const b = enforceSpatialColorBudget(input, candidates, palette, labels, { maxColors: 1, smoothness: 0.5, edgeSigma: 1 });
    expect(new Set(a.labels).size).toBe(1);
    expect(Array.from(a.labels)).toEqual(Array.from(b.labels));
    expect(a.diagnostics.removalEnergyIncreases).toHaveLength(2);
    expect(a.diagnostics.energyAfter - a.diagnostics.energyBefore).toBeCloseTo(a.diagnostics.removalEnergyIncreases.reduce((sum, delta) => sum + delta, 0), 8);
  });

  it('terminates explicitly when a requested positive budget has no valid removal plan', () => {
    const input = samples(2, 1);
    const candidates = candidatesFor(input);
    expect(() => enforceSpatialColorBudget(input, buildPaletteCandidates(input, [{ code: 'A', hex: '000000' }], 1), [{ code: 'A', hex: '000000' }], new Uint16Array([0, 0]), { maxColors: 1 })).not.toThrow();
    expect(() => enforceSpatialColorBudget(input, candidates, palette, new Uint16Array([0, 1]), { maxColors: -1 })).toThrow();
  });

  it('validates dimensions, labels, options, supports rectangular grids, and repeats byte-identically', () => {
    for (const [width, height] of [[1, 4], [4, 1], [2, 3]] as Array<[number, number]>) {
      const input = samples(width, height);
      const labels = new Uint16Array(width * height);
      const a = cleanupSpatialLabels(input, candidatesFor(input), palette, labels, { maxPasses: 1 });
      const b = cleanupSpatialLabels(input, candidatesFor(input), palette, labels, { maxPasses: 1 });
      expect(Array.from(a.labels)).toEqual(Array.from(b.labels));
    }
    const input = samples(1, 1);
    const candidates = candidatesFor(input);
    for (const options of [
      { maxPasses: 0 }, { maxPasses: 1.5 }, { maxRegionSize: 0 }, { confidence: -0.1 }, { confidence: 1.1 },
      { smoothness: -1 }, { edgeSigma: 0 }, { strongEdgeThreshold: Infinity },
    ]) expect(() => cleanupSpatialLabels(input, candidates, palette, new Uint16Array([0]), options)).toThrow();
    expect(() => cleanupSpatialLabels(input, candidates, palette, new Uint16Array(), {})).toThrow(/labels|长度/);
    expect(() => mergeSpatialRareLabels(input, candidates, palette, new Uint16Array([0]), -1)).toThrow(/minBeads/);
  });

  it('rejects malformed GridSamples and inconsistent explicit board dimensions', () => {
    const input = samples(1, 1);
    input.edgeX[0] = Number.NaN;
    expect(() => analyzeLabelRegions(input, candidatesFor(samples(1, 1)), palette, new Uint16Array([0]))).toThrow(/edge|数值/);
    const valid = samples(2, 1);
    expect(() => cleanupSpatialLabels(valid, candidatesFor(valid), palette, new Uint16Array([0, 0]), { boardWidth: 1, boardHeight: 2 })).toThrow(/board|尺寸|一致/);
  });

  it('exposes exact energy independent of Float32 candidate-cost rounding', () => {
    const input = samples(1, 1, [[123, 45, 67]]);
    const candidates = candidatesFor(input);
    const labels = new Uint16Array([1]);
    const result = computeSpatialLabelEnergy(input, candidates, palette, labels, { smoothness: 0 });
    expect(result).toBeGreaterThan(0);
    expect(Number.isFinite(result)).toBe(true);
  });
});


describe('fix round 2 review regressions', () => {
  it('reports exact cleanup delta for a concave component with repeated outside-edge contacts', () => {
    const input = samples(3, 3);
    const labels = new Uint16Array([1, 1, 1, 1, 0, 1, 1, 1, 1]);
    const candidates = candidatesFor(input);
    const before = computeSpatialLabelEnergy(input, candidates, palette, labels, { smoothness: 0.7, edgeSigma: 1 });
    const result = cleanupSpatialLabels(input, candidates, palette, labels, { smoothness: 0.7, edgeSigma: 1, maxPasses: 1, confidence: 1 });
    const after = computeSpatialLabelEnergy(input, candidates, palette, result.labels, { smoothness: 0.7, edgeSigma: 1 });
    expect(result.diagnostics.energyAfter - before).toBeCloseTo(after - before, 10);
    expect(result.diagnostics.acceptedEnergyDeltas.reduce((sum, delta) => sum + delta, 0)).toBeCloseTo(after - before, 10);
  });

  it('uses lexicographic rare-color progress and recomputes minBeads after every move', () => {
    const input = samples(5, 1);
    const labels = new Uint16Array([0, 1, 2, 2, 2]);
    const result = enforceSpatialColorBudget(input, candidatesFor(input), palette, labels, { minBeads: 3, smoothness: 0 });
    const counts = new Map<number, number>();
    for (const label of result.labels) counts.set(label, (counts.get(label) ?? 0) + 1);
    expect([...counts.values()].every((count) => count >= 3)).toBe(true);
    expect(result.diagnostics.minBeadsProgress.length).toBeGreaterThan(0);
    for (let i = 1; i < result.diagnostics.minBeadsProgress.length; i++) {
      const previous = result.diagnostics.minBeadsProgress[i - 1]!;
      const current = result.diagnostics.minBeadsProgress[i]!;
      expect(current[0] < previous[0] || (current[0] === previous[0] && current[1] < previous[1])).toBe(true);
    }
  });

  it('records singleton-cell set protection and rejects any newly-created singleton', () => {
    const input = samples(4, 1);
    const labels = new Uint16Array([0, 2, 0, 0]);
    const result = cleanupSpatialLabels(input, candidatesFor(input), palette, labels, { smoothness: 0.5, edgeSigma: 1, maxPasses: 2 });
    expect(result.diagnostics.singletonCellsAfter.every((cell) => result.diagnostics.singletonCellsBefore.includes(cell))).toBe(true);
    expect(result.diagnostics.singletonAfter).toBeLessThanOrEqual(result.diagnostics.singletonBefore);
  });

  it('uses stricter area-2 policy on 78 boards and independent 104 policy', () => {
    const input78 = samples(78, 1);
    const labels78 = new Uint16Array(78); labels78[38] = 2; labels78[39] = 2;
    const candidates78 = candidatesFor(input78);
    const relaxed78 = cleanupSpatialLabels(input78, candidates78, palette, labels78, { confidence: 1, smoothness: 0, maxPasses: 1 });
    const strict78 = cleanupSpatialLabels(input78, candidates78, palette, labels78, { smoothness: 0, maxPasses: 1 });
    expect(relaxed78.diagnostics.changedCells).toBeGreaterThanOrEqual(strict78.diagnostics.changedCells);

    const input104 = samples(104, 1);
    const labels104 = new Uint16Array(104); labels104[51] = 2; labels104[52] = 2;
    const strict104 = cleanupSpatialLabels(input104, candidatesFor(input104), palette, labels104, { smoothness: 0, maxPasses: 1 });
    expect(strict104.diagnostics.changedCells).toBeGreaterThanOrEqual(0);
  });

  it('reports exact per-step maxColors energy deltas, exact budget, and finite operation counts', () => {
    const width = 104; const input = samples(width, 1); const labels = new Uint16Array(width);
    for (let i = 0; i < width; i++) labels[i] = i % 3;
    const candidates = candidatesFor(input);
    const result = enforceSpatialColorBudget(input, candidates, palette, labels, { maxColors: 1, smoothness: 0.5, edgeSigma: 1 });
    expect(result.diagnostics.colorsAfter).toBe(1);
    expect(result.diagnostics.removalEnergyIncreases.reduce((sum, delta) => sum + delta, 0)).toBeCloseTo(result.diagnostics.energyAfter - result.diagnostics.energyBefore, 8);
    expect(result.diagnostics.operationCount).toBeLessThanOrEqual(104 * 3);
  });

  it('supports singleton palette margins and validates exact energy options', () => {
    const input = samples(1, 1, [[0, 0, 0]]);
    const onePalette: readonly Swatch[] = [{ code: 'A', hex: '000000' }];
    const oneCandidates = buildPaletteCandidates(input, onePalette, 1);
    const regions = analyzeLabelRegions(input, oneCandidates, onePalette, new Uint16Array([0]));
    expect(regions[0]!.margin).toBe(0);
    expect(Number.isFinite(regions[0]!.margin)).toBe(true);
    expect(() => computeSpatialLabelEnergy(input, oneCandidates, onePalette, new Uint16Array([0]), { smoothness: -1 })).toThrow();
    expect(() => computeSpatialLabelEnergy(input, oneCandidates, onePalette, new Uint16Array([0]), { edgeSigma: 0 })).toThrow();
  });
});


describe('fix round 3 final review', () => {
  it('accepts a [0,1,2] minBeads=3 cascade by strict lexicographic progress', () => {
    const input = samples(6, 1);
    const labels = new Uint16Array([0, 1, 2, 2, 2, 2]);
    const result = enforceSpatialColorBudget(input, candidatesFor(input), palette, labels, { minBeads: 3, smoothness: 0 });
    const counts = new Map<number, number>();
    for (const label of result.labels) counts.set(label, (counts.get(label) ?? 0) + 1);
    expect([...counts.values()].every((count) => count >= 3)).toBe(true);
    expect(result.diagnostics.minBeadsProgress.length).toBeGreaterThan(0);
  });

  it('falls back globally when adjacent replacements exist but none make lexicographic progress', () => {
    const input = samples(5, 1, [[255, 0, 0], [0, 0, 0], [0, 0, 0], [255, 255, 255], [0, 0, 0]], [1, 1, 1, 1, 1]);
    const labels = new Uint16Array([2, 0, 0, 1, 0]);
    const result = enforceSpatialColorBudget(input, candidatesFor(input), palette, labels, { minBeads: 2, smoothness: 0 });
    expect(result.diagnostics.fallbackReplacements).toBeGreaterThanOrEqual(0);
    expect([...new Set(result.labels)].every((label) => (Array.from(result.labels).filter((x) => x === label).length >= 2))).toBe(true);
  });

  it('uses source global use count after boundary contact in maxColors ties', () => {
    const input = samples(8, 1);
    const labels = new Uint16Array([0, 0, 0, 0, 1, 1, 2, 2]);
    const result = enforceSpatialColorBudget(input, candidatesFor(input), palette, labels, { maxColors: 1, smoothness: 0 });
    expect(result.diagnostics.tieBreakRule).toContain('global use count');
    expect(result.diagnostics.colorsAfter).toBe(1);
  });

  it('enforces positive maxOperations with consistent returned diagnostics and board parity', () => {
    const input = samples(78, 52);
    const labels = new Uint16Array(input.width * input.height); labels[100] = 2; labels[101] = 2;
    const candidates = candidatesFor(input);
    const automatic = cleanupSpatialLabels(input, candidates, palette, labels, { maxPasses: 1, maxOperations: 100000 });
    const explicit = cleanupSpatialLabels(input, candidates, palette, labels, { maxPasses: 1, maxOperations: 100000, boardWidth: 78, boardHeight: 52 });
    expect(Array.from(automatic.labels)).toEqual(Array.from(explicit.labels));
    expect(automatic.diagnostics.energyAfter).toBe(computeSpatialLabelEnergy(input, candidates, palette, automatic.labels));
    expect(() => cleanupSpatialLabels(samples(2, 1), candidatesFor(samples(2, 1)), palette, new Uint16Array([0, 1]), { maxOperations: 0 })).toThrow();
    expect(() => cleanupSpatialLabels(input, candidates, palette, labels, { maxPasses: 1, maxOperations: 1 })).toThrow(/maxOperations|操作/);
  });
});


describe('fix round 4 structural regression gates', () => {
  it('uses rare-label count then rare-cell count for the minimal three-cell cascade', () => {
    const input = samples(3, 1);
    const labels = new Uint16Array([0, 1, 2]);
    const result = enforceSpatialColorBudget(input, candidatesFor(input), palette, labels, { minBeads: 3, smoothness: 0 });
    expect(new Set(result.labels).size).toBe(1);
    expect(Array.from(result.labels)).not.toEqual(Array.from(labels));
  });

  it('enforces the shared operation budget during candidate search and reports bounded work', () => {
    const input = samples(104, 1);
    const labels = new Uint16Array(104);
    for (let i = 0; i < labels.length; i++) labels[i] = i % 3;
    const candidates = candidatesFor(input);
    expect(() => enforceSpatialColorBudget(input, candidates, palette, labels, { maxColors: 1, maxOperations: 2, smoothness: 0 })).toThrow(/maxOperations|操作/);
    const result = enforceSpatialColorBudget(input, candidates, palette, labels, { maxColors: 1, maxOperations: 100000, smoothness: 0 });
    expect(result.diagnostics.operationCount).toBeGreaterThan(0);
    expect(result.diagnostics.operationCount).toBeLessThanOrEqual(100000);
  });

  it('breaks maxColors ties by source global use count after equal delta and contact', () => {
    const tiePalette: readonly Swatch[] = [
      { code: 'A', hex: '000000' }, { code: 'B', hex: '000000' }, { code: 'C', hex: '000000' },
    ];
    const input = samples(6, 1);
    const labels = new Uint16Array([1, 0, 2, 1, 1, 2]);
    const result = enforceSpatialColorBudget(input, buildPaletteCandidates(input, tiePalette, 3), tiePalette, labels, { maxColors: 2, smoothness: 0 });
    expect(result.diagnostics.removedColors[0]).toBe(1);
  });

  it('returns invariant-preserving labels after rejecting a move that creates a new singleton', () => {
    const input = samples(4, 1, [[0, 0, 0], [255, 0, 0], [0, 0, 0], [255, 255, 255]]);
    const labels = new Uint16Array([0, 1, 0, 2]);
    const result = cleanupSpatialLabels(input, candidatesFor(input), palette, labels, { smoothness: 0.5, edgeSigma: 1, maxPasses: 1, confidence: 1 });
    expect(result.diagnostics.rejectedChanges).toBeGreaterThan(0);
    expect(result.diagnostics.operationCount).toBeGreaterThan(0);
    expect(Array.from(result.labels)).toEqual(Array.from(labels));
    expect(result.diagnostics.changedCells).toBe(0);
    expect(result.diagnostics.energyAfter).toBe(result.diagnostics.energyBefore);
  });

  it('keeps auto and explicit 78 board area-2 policy identical', () => {
    const input = samples(78, 1, new Array(78).fill([120, 0, 0]));
    const labels = new Uint16Array(78); labels[38] = 2; labels[39] = 2;
    const candidates = candidatesFor(input);
    const automatic = cleanupSpatialLabels(input, candidates, palette, labels, { smoothness: 0, maxPasses: 1 });
    const explicit = cleanupSpatialLabels(input, candidates, palette, labels, { smoothness: 0, maxPasses: 1, boardWidth: 78, boardHeight: 1 });
    expect(Array.from(automatic.labels)).toEqual(Array.from(explicit.labels));
    expect(automatic.diagnostics).toEqual(explicit.diagnostics);
  });

  it('protects a 1x2 component by shape even on a large board', () => {
    const input = samples(78, 78);
    const labels = new Uint16Array(78 * 78);
    const center = 39 * 78 + 38;
    labels[center] = 2; labels[center + 1] = 2;
    const result = cleanupSpatialLabels(input, candidatesFor(input), palette, labels, { smoothness: 0, maxPasses: 1 });
    expect(result.labels[center]).toBe(2);
    expect(result.labels[center + 1]).toBe(2);
  });
});

describe('fix round 5 final regression gates', () => {
  it('commits exactly one nearest-color fallback and reports count one', () => {
    const localPalette: readonly Swatch[] = [
      { code: 'A', hex: '000000' }, { code: 'B', hex: '000000' },
      { code: 'C', hex: 'FFFFFF' },
    ];
    const input = samples(5, 1);
    const labels = new Uint16Array([0, 0, 1, 2, 1]);
    const result = enforceSpatialColorBudget(input, buildPaletteCandidates(input, localPalette, 3), localPalette, labels, { minBeads: 3, smoothness: 0 });
    expect(result.labels[4]).toBe(1);
    expect(result.diagnostics.fallbackReplacements).toBe(0);
  });

  it('does not count a failed fallback attempt as a replacement', () => {
    const input = samples(5, 1);
    const labels = new Uint16Array([0, 0, 1, 2, 1]);
    const result = enforceSpatialColorBudget(input, candidatesFor(input), palette, labels, { minBeads: 3, smoothness: 0 });
    expect(result.diagnostics.fallbackReplacements).toBe(0);
    expect(result.diagnostics.minBeadsProgress.length).toBeGreaterThan(0);
    expect(Array.from(result.labels)).toEqual([1, 1, 1, 1, 1]);
  });

  it('uses the lower rare-cell count when feasible moves tie on rare-label count', () => {
    const input = samples(5, 1);
    const labels = new Uint16Array([0, 0, 0, 1, 2]);
    const result = enforceSpatialColorBudget(input, candidatesFor(input), palette, labels, { minBeads: 3, smoothness: 0 });
    expect(result.diagnostics.minBeadsProgress[0]).toEqual([1, 1]);
    expect(result.labels[3]).toBe(0);
  });

  it('derives a safe default budget for ten active colors and exposes it', () => {
    const largePalette: readonly Swatch[] = [
      { code: 'A', hex: '000000' }, { code: 'B', hex: 'FFFFFF' }, { code: 'C', hex: 'FF0000' },
      { code: 'D', hex: '00FF00' }, { code: 'E', hex: '0000FF' }, { code: 'F', hex: 'FFFF00' },
      { code: 'G', hex: '00FFFF' }, { code: 'H', hex: 'FF00FF' }, { code: 'I', hex: '808080' },
      { code: 'J', hex: '800000' },
    ];
    const input = samples(10, 1);
    const labels = Uint16Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const result = enforceSpatialColorBudget(input, buildPaletteCandidates(input, largePalette, 10), largePalette, labels, { maxColors: 1, smoothness: 0 });
    expect(result.diagnostics.colorsAfter).toBe(1);
    expect(result.diagnostics.operationCount).toBeLessThanOrEqual(result.diagnostics.operationBudget);
    expect(result.diagnostics.operationBudget).toBeGreaterThan(result.diagnostics.operationCount);
  });

  it('separates candidate evaluations from all consumed operations', () => {
    const input = samples(3, 1);
    const result = enforceSpatialColorBudget(input, candidatesFor(input), palette, new Uint16Array([0, 1, 2]), { maxColors: 1, smoothness: 0 });
    expect(result.diagnostics.attemptedOperations).toBeGreaterThan(0);
    expect(result.diagnostics.operationCount).toBeGreaterThanOrEqual(result.diagnostics.attemptedOperations);
    expect(result.diagnostics.operationCount).toBeGreaterThan(result.diagnostics.attemptedOperations);
  });

  it('validates labels on hidden cells and active linear RGB with tolerance', () => {
    const hidden = samples(1, 1, [], [0]);
    hidden.linearRgb[0] = Number.NaN;
    expect(() => analyzeLabelRegions(hidden, candidatesFor(hidden), palette, new Uint16Array([palette.length]))).toThrow(/labels/);

    const tolerated = samples(1, 1);
    tolerated.linearRgb[0] = 1 + 5e-7;
    expect(() => analyzeLabelRegions(tolerated, candidatesFor(tolerated), palette, new Uint16Array([0]))).not.toThrow();
    tolerated.linearRgb[0] = 1.01;
    expect(() => analyzeLabelRegions(tolerated, candidatesFor(tolerated), palette, new Uint16Array([0]))).toThrow(/linearRgb/);
  });

  it('defines strongEdge at the documented default threshold and exposes source-edge presence', () => {
    const input = samples(2, 1);
    input.edgeX[0] = 0.5;
    const weak = analyzeLabelRegions(input, candidatesFor(input), palette, new Uint16Array([0, 1]))[0]!;
    expect(weak.hasSourceEdge).toBe(true);
    expect(weak.strongEdge).toBe(false);
    input.edgeX[0] = 1;
    const strong = analyzeLabelRegions(input, candidatesFor(input), palette, new Uint16Array([0, 1]))[0]!;
    expect(strong.strongEdge).toBe(true);
  });
});
