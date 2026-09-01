import { describe, expect, it } from 'vitest';
import { canonicalGridString, computeAcceptanceMetrics, type AcceptanceTruth } from '../src';
import type { GridSamples } from '../src';

function samples(): GridSamples {
  return {
    width: 3, height: 2,
    linearRgb: new Float32Array([
      0, 0, 0, 0, 0, 0, 1, 1, 1,
      0, 0, 0, 1, 1, 1, 1, 1, 1,
    ]),
    coverage: new Float32Array([1, 1, 1, 1, 0, 1]),
    variance: new Float32Array(6), edgeX: new Float32Array(6), edgeY: new Float32Array(6),
  };
}

const truth: AcceptanceTruth = {
  flatRegion: new Int32Array([1, 1, 2, 1, -1, 2]),
  edgeX: new Uint8Array([0, 1, 0, 0, 0, 0]),
  edgeY: new Uint8Array([0, 0, 0, 0, 0, 0]),
  thinLineLabels: new Int32Array([-1, -1, 1, -1, -1, 1]),
};

describe('acceptance metrics', () => {
  it('computes fragmentation, flat transitions, edge scores and thin-line recall from an oracle fixture', () => {
    const metrics = computeAcceptanceMetrics(samples(), new Int32Array([0, 0, 1, 0, -1, 1]), [
      { code: 'K', hex: '000000' }, { code: 'W', hex: 'FFFFFF' },
    ], truth, 3);
    expect(metrics.meanDeltaE00).toBeCloseTo(0, 5);
    expect(metrics.p95DeltaE00).toBeCloseTo(0, 5);
    expect(metrics.componentCount).toBe(2);
    expect(metrics.singletonRatio).toBe(0);
    expect(metrics.smallComponentRatio).toBe(0.5);
    expect(metrics.flatTransitionRate).toBe(0);
    expect(metrics.edgePrecision).toBe(1);
    expect(metrics.edgeRecall).toBe(1);
    expect(metrics.edgeF1).toBe(1);
    expect(metrics.thinLineRecall).toBe(1);
    const missedLine = computeAcceptanceMetrics(samples(), new Int32Array([0, 0, 0, 0, -1, 0]), [
      { code: 'K', hex: '000000' }, { code: 'W', hex: 'FFFFFF' },
    ], truth, 3);
    expect(missedLine.thinLineRecall).toBe(0);
    expect(metrics.colorCount).toBe(2);
    expect(metrics.lowUseColorCount).toBe(1);
  });

  it('serializes grids canonically without timing data', () => {
    const grid = { rows: 1, cols: 2, colorCount: 1, cells: [[{ code: 'A1', hex: 'FFFFFF', external: false }, { code: '', hex: '', external: true }]] };
    expect(canonicalGridString(grid)).toBe('1\n2\n0|A1|FFFFFF\n1||\n');
  });
});
