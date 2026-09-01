import type { Grid, Swatch } from './types';
import type { GridSamples } from './resample';
import { linearToSrgb } from './resample';
import { measureSpatialFragmentation } from './quantize';
import { hexToRgb } from './color';
import { ciede2000, srgbToLab } from '../beadpattern/ciede2000';

export interface AcceptanceTruth {
  flatRegion?: Int32Array;
  edgeX?: Uint8Array;
  edgeY?: Uint8Array;
  /** Expected palette label for protected one-cell strokes; -1 means not a thin-line cell. */
  thinLineLabels?: Int32Array;
}

export interface AcceptanceMetrics {
  meanDeltaE00: number;
  p95DeltaE00: number;
  componentCount: number;
  singletonRatio: number;
  smallComponentRatio: number;
  componentDensity: number;
  flatTransitionRate: number | null;
  edgePrecision: number | null;
  edgeRecall: number | null;
  edgeF1: number | null;
  thinLineRecall: number | null;
  colorCount: number;
  lowUseColorCount: number;
}

export function canonicalGridString(grid: Grid): string {
  let output = `${grid.rows}\n${grid.cols}\n`;
  for (const row of grid.cells) for (const cell of row) output += `${cell.external ? 1 : 0}|${cell.code}|${cell.hex}\n`;
  return output;
}

export function computeAcceptanceMetrics(
  samples: GridSamples,
  labels: Int32Array,
  palette: readonly Swatch[],
  truth: AcceptanceTruth = {},
  lowUseThreshold = 5,
): AcceptanceMetrics {
  const count = samples.width * samples.height;
  if (labels.length !== count) throw new Error('labels 长度与 samples 不匹配');
  const paletteLabs = palette.map((swatch) => srgbToLab(hexToRgb(swatch.hex)));
  const distances: number[] = [];
  const uses = new Map<number, number>();
  for (let pixel = 0; pixel < count; pixel++) {
    const label = labels[pixel]!;
    if (label < 0 || samples.coverage[pixel]! < 0.5) continue;
    if (!paletteLabs[label]) throw new Error(`label ${label} 超出色板`);
    const rgb = pixel * 3;
    const target = srgbToLab({
      r: linearToSrgb(samples.linearRgb[rgb]!),
      g: linearToSrgb(samples.linearRgb[rgb + 1]!),
      b: linearToSrgb(samples.linearRgb[rgb + 2]!),
    });
    distances.push(ciede2000(target, paletteLabs[label]!));
    uses.set(label, (uses.get(label) ?? 0) + 1);
  }
  distances.sort((a, b) => a - b);
  const fragmentation = measureSpatialFragmentation(labels, samples.width, samples.height);
  let flatPairs = 0; let flatTransitions = 0;
  let tp = 0; let fp = 0; let fn = 0; let truthEdges = 0;
  const visitEdge = (a: number, b: number, annotated: boolean | undefined): void => {
    if (labels[a]! < 0 || labels[b]! < 0) return;
    const predicted = labels[a] !== labels[b];
    if (annotated !== undefined) {
      if (annotated) { truthEdges++; if (predicted) tp++; else fn++; }
      else if (predicted) fp++;
    }
    if (truth.flatRegion && truth.flatRegion[a]! >= 0 && truth.flatRegion[a] === truth.flatRegion[b]) {
      flatPairs++; if (predicted) flatTransitions++;
    }
  };
  for (let y = 0; y < samples.height; y++) for (let x = 0; x < samples.width; x++) {
    const pixel = y * samples.width + x;
    if (x + 1 < samples.width) visitEdge(pixel, pixel + 1, truth.edgeX ? truth.edgeX[pixel] === 1 : undefined);
    if (y + 1 < samples.height) visitEdge(pixel, pixel + samples.width, truth.edgeY ? truth.edgeY[pixel] === 1 : undefined);
  }
  let lineTotal = 0; let lineFound = 0;
  if (truth.thinLineLabels) for (let pixel = 0; pixel < count; pixel++) {
    const expected = truth.thinLineLabels[pixel]!;
    if (expected < 0) continue;
    lineTotal++;
    if (labels[pixel] === expected) lineFound++;
  }
  const precision = tp + fp ? tp / (tp + fp) : truth.edgeX || truth.edgeY ? 1 : null;
  const recall = truthEdges ? tp / truthEdges : truth.edgeX || truth.edgeY ? 1 : null;
  const f1 = precision === null || recall === null ? null : precision + recall ? 2 * precision * recall / (precision + recall) : 0;
  return {
    meanDeltaE00: distances.length ? distances.reduce((sum, value) => sum + value, 0) / distances.length : 0,
    p95DeltaE00: distances.length ? distances[Math.max(0, Math.ceil(distances.length * 0.95) - 1)]! : 0,
    componentCount: fragmentation.componentCount,
    singletonRatio: fragmentation.singletonRatio,
    smallComponentRatio: fragmentation.smallComponentRatio,
    componentDensity: fragmentation.validCellCount ? fragmentation.componentCount / fragmentation.validCellCount : 0,
    flatTransitionRate: flatPairs ? flatTransitions / flatPairs : truth.flatRegion ? 0 : null,
    edgePrecision: precision, edgeRecall: recall, edgeF1: f1,
    thinLineRecall: truth.thinLineLabels ? (lineTotal ? lineFound / lineTotal : 1) : null,
    colorCount: uses.size,
    lowUseColorCount: [...uses.values()].filter((value) => value < lowUseThreshold).length,
  };
}
