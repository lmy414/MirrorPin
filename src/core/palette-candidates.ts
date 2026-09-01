import type { GridSamples } from './resample';
import type { Swatch } from './types';
import { hexToRgb } from './color';
import { normalizeSwatches } from './palette';
import { srgbToLab, ciede2000, type Lab } from '../beadpattern/ciede2000';
import { requirePositiveInteger } from './options';

export interface PaletteCandidates {
  /** Pixel-major N*K palette indices. Invalid cells use 0 labels and Infinity costs. */
  labels: Uint16Array;
  /** Pixel-major N*K CIEDE2000 costs. */
  costs: Float32Array;
  /** Best minus second-best cost gap; K=1 is defined as zero. */
  bestMargin: Float32Array;
  topK: number;
}

export function buildPaletteCandidates(
  samples: GridSamples,
  palette: readonly Swatch[],
  requestedTopK: number,
): PaletteCandidates {
  validateSamples(samples);
  requirePositiveInteger('topK', requestedTopK);
  const canonicalPalette = normalizeSwatches(palette);
  if (canonicalPalette.length === 0) throw new Error('色板不能为空');
  const topK = Math.min(requestedTopK, canonicalPalette.length);
  const count = samples.width * samples.height;
  const labels = new Uint16Array(count * topK);
  const costs = new Float32Array(count * topK);
  costs.fill(Infinity);
  const bestMargin = new Float32Array(count);
  const paletteLabs = canonicalPalette.map((swatch) => srgbToLab(hexToRgb(swatch.hex)));
  if (canonicalPalette.length > 65535) throw new Error('色板长度不能超过 65535');

  for (let pixel = 0; pixel < count; pixel++) {
    validateSampleCell(samples, pixel);
    if (!validCell(samples, pixel)) continue;
    const rgb = pixel * 3;
    const target: Lab = srgbToLab({
      r: linearToSrgb(samples.linearRgb[rgb]!),
      g: linearToSrgb(samples.linearRgb[rgb + 1]!),
      b: linearToSrgb(samples.linearRgb[rgb + 2]!),
    });
    const ranked = paletteLabs.map((lab, index) => ({
      index,
      cost: ciede2000(target, lab),
    }));
    ranked.sort((a, b) => a.cost - b.cost || comparePalette(canonicalPalette, a.index, b.index));
    for (let rank = 0; rank < topK; rank++) {
      labels[pixel * topK + rank] = ranked[rank]!.index;
      costs[pixel * topK + rank] = Math.fround(ranked[rank]!.cost);
    }
    bestMargin[pixel] = topK > 1 ? Math.fround(ranked[1]!.cost - ranked[0]!.cost) : 0;
  }
  return { labels, costs, bestMargin, topK };
}

function comparePalette(palette: readonly Swatch[], a: number, b: number): number {
  const left = palette[a]!.code;
  const right = palette[b]!.code;
  if (left < right) return -1;
  if (left > right) return 1;
  return a - b;
}

function linearToSrgb(value: number): number {
  const n = value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, n * 255));
}

export function validCell(samples: GridSamples, pixel: number): boolean {
  if (!(samples.coverage[pixel]! >= 0.5)) return false;
  const rgb = pixel * 3;
  return Number.isFinite(samples.linearRgb[rgb]!)
    && Number.isFinite(samples.linearRgb[rgb + 1]!)
    && Number.isFinite(samples.linearRgb[rgb + 2]!);
}

function validateSamples(samples: GridSamples): void {
  if (!Number.isInteger(samples.width) || samples.width < 1 || !Number.isInteger(samples.height) || samples.height < 1) {
    throw new Error('GridSamples width/height 必须为正整数');
  }
  const count = samples.width * samples.height;
  if (samples.linearRgb.length !== count * 3 || samples.coverage.length !== count
    || samples.variance.length !== count || samples.edgeX.length !== count || samples.edgeY.length !== count) {
    throw new Error('GridSamples 数组长度不匹配');
  }
  for (let i = 0; i < count; i++) {
    const coverage = samples.coverage[i]!;
    if (!Number.isFinite(coverage) || coverage < 0 || coverage > 1) throw new Error(`coverage[${i}] 非法`);
  }
}

function validateSampleCell(samples: GridSamples, pixel: number): void {
  const variance = samples.variance[pixel]!;
  const edgeX = samples.edgeX[pixel]!;
  const edgeY = samples.edgeY[pixel]!;
  if (!Number.isFinite(variance) || variance < 0) throw new Error(`variance[${pixel}] 非法`);
  if (!Number.isFinite(edgeX) || edgeX < 0) throw new Error(`edgeX[${pixel}] 非法`);
  if (!Number.isFinite(edgeY) || edgeY < 0) throw new Error(`edgeY[${pixel}] 非法`);
  if (samples.coverage[pixel]! > 0) {
    const rgb = pixel * 3;
    for (let channel = 0; channel < 3; channel++) {
      const value = samples.linearRgb[rgb + channel]!;
      if (!Number.isFinite(value) || value < -1e-6 || value > 1 + 1e-6) {
        throw new Error(`linearRgb[${rgb + channel}] 非法`);
      }
    }
  }
}
