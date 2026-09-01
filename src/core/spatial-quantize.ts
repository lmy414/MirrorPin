import type { GridSamples } from './resample';
import type { SpatialQuantizeOptions, Swatch } from './types';
import { hexToRgb } from './color';
import { srgbToLab, ciede2000, type Lab } from '../beadpattern/ciede2000';
import { type PaletteCandidates, validCell } from './palette-candidates';

export interface SpatialQuantizeResult {
  labels: Uint16Array;
  iterations: number;
  energyBefore: number;
  energyAfter: number;
}

export function optimizeSpatialLabels(
  samples: GridSamples,
  candidates: PaletteCandidates,
  palette: readonly Swatch[],
  options: Required<SpatialQuantizeOptions>,
): SpatialQuantizeResult {
  validateInputs(samples, candidates, palette, options);
  const count = samples.width * samples.height;
  const labels = new Uint16Array(count);
  const targetLabs = new Array<Lab | undefined>(count);
  const paletteLabs = palette.map((swatch) => srgbToLab(hexToRgb(swatch.hex)));
  const usage = new Uint32Array(palette.length);

  for (let pixel = 0; pixel < count; pixel++) {
    if (!validCell(samples, pixel)) continue;
    labels[pixel] = candidates.labels[pixel * candidates.topK]!;
    targetLabs[pixel] = targetLab(samples, pixel);
    usage[labels[pixel]!] = usage[labels[pixel]!]! + 1;
  }
  initializeTiedLabels(samples, candidates, labels, palette, usage);

  let energy = computeEnergy(samples, labels, targetLabs, paletteLabs, options);
  const energyBefore = energy;
  let iterations = 0;
  for (; iterations < options.maxIterations; iterations++) {
    let changed = false;
    for (const order of sweepOrders(samples.width, samples.height)) {
      for (const pixel of order) {
        if (!validCell(samples, pixel)) continue;
        const current = labels[pixel]!;
        const choices = collectChoices(samples, candidates, labels, pixel);
        let best = current;
        let bestLocal = localEnergy(samples, labels, targetLabs, paletteLabs, options, pixel, current);
        let bestUsage = usage[best]!;
        for (const candidate of choices) {
          if (candidate === current) continue;
          const local = localEnergy(samples, labels, targetLabs, paletteLabs, options, pixel, candidate);
          if (local < bestLocal || (local === bestLocal && (usage[candidate]! > bestUsage
            || (usage[candidate] === bestUsage && compareLabel(palette, candidate, best) < 0)))) {
            best = candidate;
            bestLocal = local;
            bestUsage = usage[candidate]!;
          }
        }
        const currentLocal = localEnergy(samples, labels, targetLabs, paletteLabs, options, pixel, current);
        if (best !== current && bestLocal < currentLocal) {
          usage[current]!--;
          usage[best]!++;
          labels[pixel] = best;
          changed = true;
        }
      }
    }
    const nextEnergy = computeEnergy(samples, labels, targetLabs, paletteLabs, options);
    if (!Number.isFinite(nextEnergy) || nextEnergy > energy) {
      throw new Error('空间量化能量必须有限且单调不增');
    }
    energy = nextEnergy;
    if (!changed) break;
  }

  return { labels, iterations, energyBefore, energyAfter: energy };
}

function initializeTiedLabels(
  samples: GridSamples,
  candidates: PaletteCandidates,
  labels: Uint16Array,
  palette: readonly Swatch[],
  usage: Uint32Array,
): void {
  for (let pixel = 0; pixel < labels.length; pixel++) {
    if (!validCell(samples, pixel) || candidates.topK < 2) continue;
    const start = pixel * candidates.topK;
    const current = labels[pixel]!;
    const currentCost = candidates.costs[start]!;
    let chosen = current;
    for (let rank = 1; rank < candidates.topK; rank++) {
      const candidate = candidates.labels[start + rank]!;
      const cost = candidates.costs[start + rank]!;
      if (cost !== currentCost) break;
      if (usage[candidate]! > usage[chosen]! || (usage[candidate] === usage[chosen] && compareLabel(palette, candidate, chosen) < 0)) {
        chosen = candidate;
      }
    }
    if (chosen !== current) {
      usage[current]!--;
      usage[chosen]!++;
      labels[pixel] = chosen;
    }
  }
}

function targetLab(samples: GridSamples, pixel: number): Lab {
  const rgb = pixel * 3;
  return srgbToLab({
    r: linearToSrgb(samples.linearRgb[rgb]!),
    g: linearToSrgb(samples.linearRgb[rgb + 1]!),
    b: linearToSrgb(samples.linearRgb[rgb + 2]!),
  });
}

function linearToSrgb(value: number): number {
  const n = value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, n * 255));
}

function localEnergy(
  samples: GridSamples,
  labels: Uint16Array,
  targets: readonly (Lab | undefined)[],
  paletteLabs: readonly Lab[],
  options: Required<SpatialQuantizeOptions>,
  pixel: number,
  label: number,
): number {
  const target = targets[pixel];
  if (!target) return 0;
  let energy = ciede2000(target, paletteLabs[label]!);
  const x = pixel % samples.width;
  const y = Math.floor(pixel / samples.width);
  if (x > 0) energy += pairwise(samples, pixel - 1, pixel, label, labels[pixel - 1]!, options);
  if (x + 1 < samples.width) energy += pairwise(samples, pixel, pixel + 1, label, labels[pixel + 1]!, options);
  if (y > 0) energy += pairwise(samples, pixel - samples.width, pixel, labels[pixel - samples.width]!, label, options);
  if (y + 1 < samples.height) energy += pairwise(samples, pixel, pixel + samples.width, label, labels[pixel + samples.width]!, options);
  return energy;
}

function computeEnergy(
  samples: GridSamples,
  labels: Uint16Array,
  targets: readonly (Lab | undefined)[],
  paletteLabs: readonly Lab[],
  options: Required<SpatialQuantizeOptions>,
): number {
  let energy = 0;
  for (let pixel = 0; pixel < labels.length; pixel++) {
    const target = targets[pixel];
    if (target) energy += ciede2000(target, paletteLabs[labels[pixel]!]!);
    const x = pixel % samples.width;
    const y = Math.floor(pixel / samples.width);
    if (x + 1 < samples.width) energy += pairwise(samples, pixel, pixel + 1, labels[pixel]!, labels[pixel + 1]!, options);
    if (y + 1 < samples.height) energy += pairwise(samples, pixel, pixel + samples.width, labels[pixel]!, labels[pixel + samples.width]!, options);
  }
  return energy;
}

function pairwise(
  samples: GridSamples,
  a: number,
  b: number,
  labelA: number,
  labelB: number,
  options: Required<SpatialQuantizeOptions>,
): number {
  if (!validCell(samples, a) || !validCell(samples, b) || labelA === labelB) return 0;
  const ax = a % samples.width;
  const bx = b % samples.width;
  const sourceEdge = ax !== bx ? samples.edgeX[a]! : samples.edgeY[a]!;
  const weight = Math.exp(-0.5 * (sourceEdge / options.edgeSigma) ** 2);
  return options.smoothness * weight;
}

function collectChoices(
  samples: GridSamples,
  candidates: PaletteCandidates,
  labels: Uint16Array,
  pixel: number,
): number[] {
  const result: number[] = [];
  const seen = new Set<number>();
  const start = pixel * candidates.topK;
  for (let rank = 0; rank < candidates.topK; rank++) {
    const label = candidates.labels[start + rank]!;
    if (!seen.has(label)) {
      seen.add(label);
      result.push(label);
    }
  }
  const x = pixel % samples.width;
  const y = Math.floor(pixel / samples.width);
  const neighbors = [
    x > 0 ? pixel - 1 : -1,
    x + 1 < samples.width ? pixel + 1 : -1,
    y > 0 ? pixel - samples.width : -1,
    y + 1 < samples.height ? pixel + samples.width : -1,
  ];
  for (const neighbor of neighbors) {
    if (neighbor >= 0 && validCell(samples, neighbor) && !seen.has(labels[neighbor]!)) {
      seen.add(labels[neighbor]!);
      result.push(labels[neighbor]!);
    }
  }
  return result;
}

function compareLabel(palette: readonly Swatch[], a: number, b: number): number {
  const left = palette[a]!.code;
  const right = palette[b]!.code;
  if (left < right) return -1;
  if (left > right) return 1;
  return a - b;
}

function* sweepOrders(width: number, height: number): Generator<number[]> {
  const red: number[] = [];
  const black: number[] = [];
  const forward: number[] = [];
  const reverse: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x;
      ((x + y) % 2 === 0 ? red : black).push(pixel);
      forward.push(pixel);
    }
  }
  for (let pixel = width * height - 1; pixel >= 0; pixel--) reverse.push(pixel);
  yield red;
  yield black;
  yield forward;
  yield reverse;
}

function validateInputs(
  samples: GridSamples,
  candidates: PaletteCandidates,
  palette: readonly Swatch[],
  options: Required<SpatialQuantizeOptions>,
): void {
  if (!Number.isInteger(samples.width) || samples.width < 1 || !Number.isInteger(samples.height) || samples.height < 1) {
    throw new Error('GridSamples width/height 必须为正整数');
  }
  const count = samples.width * samples.height;
  if (samples.linearRgb.length !== count * 3 || samples.coverage.length !== count || samples.variance.length !== count
    || samples.edgeX.length !== count || samples.edgeY.length !== count) throw new Error('GridSamples 数组长度不匹配');
  if (!Number.isInteger(candidates.topK) || candidates.topK < 1 || candidates.topK > palette.length) throw new Error('candidates topK 非法');
  if (candidates.labels.length !== count * candidates.topK || candidates.costs.length !== count * candidates.topK
    || candidates.bestMargin.length !== count) throw new Error('候选数组长度不匹配');
  for (let pixel = 0; pixel < count; pixel++) {
    if (!validCell(samples, pixel)) continue;
    const start = pixel * candidates.topK;
    for (let rank = 0; rank < candidates.topK; rank++) {
      if (candidates.labels[start + rank]! >= palette.length || !Number.isFinite(candidates.costs[start + rank]!)) {
        throw new Error(`candidate[${start + rank}] 非法`);
      }
    }
    if (!Number.isFinite(candidates.bestMargin[pixel]!) || candidates.bestMargin[pixel]! < 0) {
      throw new Error(`bestMargin[${pixel}] 非法`);
    }
  }
  if (palette.length === 0 || palette.length > 65535) throw new Error('色板长度非法');
  for (let i = 0; i < count; i++) {
    const coverage = samples.coverage[i]!;
    if (!Number.isFinite(coverage) || coverage < 0 || coverage > 1) throw new Error(`coverage[${i}] 非法`);
    if (!Number.isFinite(samples.variance[i]!) || samples.variance[i]! < 0) throw new Error(`variance[${i}] 非法`);
    if (!Number.isFinite(samples.edgeX[i]!) || samples.edgeX[i]! < 0 || !Number.isFinite(samples.edgeY[i]!) || samples.edgeY[i]! < 0) {
      throw new Error(`edge[${i}] 非法`);
    }
  }
  if (!Number.isFinite(options.smoothness) || options.smoothness < 0 || !Number.isFinite(options.edgeSigma) || options.edgeSigma <= 0) {
    throw new Error('空间量化选项非法');
  }
}
