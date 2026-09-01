// K-Means++ 减色量化：把一组像素颜色聚成 k 个代表色。
// 用于评审文档 4.1 管线第一步的降色；K 值由调用方按色域/色号上限给出。

import type { PipelineDiagnostics, RGB } from './types';
import { requireInteger, requirePositiveInteger } from './options';

/** @internal 压缩后的颜色样本及其原始出现频率。 */
export interface WeightedRgbSample {
  color: RGB;
  weight: number;
}

/** 确定性伪随机（mulberry32），保证量化结果可复现、可测试 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rgbKey(color: RGB): number {
  return (color.r << 16) | (color.g << 8) | color.b;
}

function compareRgb(a: RGB, b: RGB): number {
  return a.r - b.r || a.g - b.g || a.b - b.b;
}

function sqDist(a: RGB, b: RGB): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr + dg * dg + db * db;
}

function compressWeightedSamples(pixels: readonly RGB[]): WeightedRgbSample[] {
  const countByKey = new Map<number, number>();
  for (const pixel of pixels) {
    const key = rgbKey(pixel);
    countByKey.set(key, (countByKey.get(key) ?? 0) + 1);
  }
  return [...countByKey.entries()]
    .sort(([a], [b]) => a - b)
    .map(([key, weight]) => ({
      color: { r: (key >> 16) & 255, g: (key >> 8) & 255, b: key & 255 },
      weight,
    }));
}

function assignSamples(
  samples: readonly WeightedRgbSample[],
  centers: readonly RGB[],
): { assignment: Int32Array; weightedError: Float64Array; changedFrom?: Int32Array } {
  const assignment = new Int32Array(samples.length);
  const weightedError = new Float64Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i]!;
    let best = 0;
    let bestDistance = sqDist(sample.color, centers[0]!);
    for (let c = 1; c < centers.length; c++) {
      const distance = sqDist(sample.color, centers[c]!);
      if (distance < bestDistance) {
        best = c;
        bestDistance = distance;
      }
    }
    assignment[i] = best;
    weightedError[i] = bestDistance * sample.weight;
  }
  return { assignment, weightedError };
}

/**
 * @internal 在同一次完整分配状态上为空簇选择互不重复的高 weighted-error 样本。
 * 不修改 assignment；调用方在下一轮用恢复后的中心自然重分配。
 */
export function recoverEmptyCenters(
  samples: readonly WeightedRgbSample[],
  centers: readonly RGB[],
  assignment: Int32Array,
  emptyClusters: readonly number[],
): RGB[] {
  if (assignment.length !== samples.length) throw new Error('assignment 长度必须等于 samples 长度');
  const ranked = samples.map((sample, index) => {
    const owner = assignment[index]!;
    if (owner < 0 || owner >= centers.length) throw new Error('assignment 包含非法簇索引');
    return {
      index,
      score: sqDist(sample.color, centers[owner]!) * sample.weight,
      key: rgbKey(sample.color),
    };
  }).sort((a, b) => b.score - a.score || a.key - b.key || a.index - b.index);

  const used = new Set<number>();
  return emptyClusters.map(() => {
    const candidate = ranked.find((entry) => !used.has(entry.index));
    if (!candidate) throw new Error('没有足够样本恢复空簇');
    used.add(candidate.index);
    return { ...samples[candidate.index]!.color };
  });
}

/**
 * 将像素颜色聚成 k 个代表色（RGB 空间）。
 * 完整 RGB key 排序压缩保证输入排列无关；最终中心也按 RGB 稳定规范排序。
 */
export function kmeansPalette(pixels: readonly RGB[], k: number, seed = 42): RGB[] {
  requirePositiveInteger('k', k);
  requireInteger('seed', seed);
  if (pixels.length === 0) return [];

  const samples = compressWeightedSamples(pixels);
  if (samples.length <= k) return samples.map((sample) => sample.color).sort(compareRgb);

  const rnd = mulberry32(seed);
  let firstTarget = rnd() * pixels.length;
  let first = samples.length - 1;
  for (let i = 0; i < samples.length; i++) {
    firstTarget -= samples[i]!.weight;
    if (firstTarget <= 0) {
      first = i;
      break;
    }
  }
  let centers: RGB[] = [{ ...samples[first]!.color }];

  const closestDistance = new Float64Array(samples.length);
  while (centers.length < k) {
    let total = 0;
    let fallback = 0;
    let fallbackScore = -1;
    for (let i = 0; i < samples.length; i++) {
      let distance = Infinity;
      for (const center of centers) distance = Math.min(distance, sqDist(samples[i]!.color, center));
      closestDistance[i] = distance;
      const score = distance * samples[i]!.weight;
      total += score;
      if (score > fallbackScore) {
        fallbackScore = score;
        fallback = i;
      }
    }
    if (total <= 0) {
      centers.push({ ...samples[fallback]!.color });
      continue;
    }
    let target = rnd() * total;
    let chosen = samples.length - 1;
    for (let i = 0; i < samples.length; i++) {
      target -= closestDistance[i]! * samples[i]!.weight;
      if (target <= 0) {
        chosen = i;
        break;
      }
    }
    centers.push({ ...samples[chosen]!.color });
  }

  let previousAssignment: Int32Array | undefined;
  for (let iter = 0; iter < 25; iter++) {
    const { assignment } = assignSamples(samples, centers);
    const sums = new Float64Array(k * 3);
    const counts = new Float64Array(k);
    for (let i = 0; i < samples.length; i++) {
      const cluster = assignment[i]!;
      const sample = samples[i]!;
      const offset = cluster * 3;
      sums[offset] = sums[offset]! + sample.color.r * sample.weight;
      sums[offset + 1] = sums[offset + 1]! + sample.color.g * sample.weight;
      sums[offset + 2] = sums[offset + 2]! + sample.color.b * sample.weight;
      counts[cluster] = counts[cluster]! + sample.weight;
    }

    const nextCenters = new Array<RGB>(k);
    const emptyClusters: number[] = [];
    for (let c = 0; c < k; c++) {
      if (counts[c]! === 0) {
        emptyClusters.push(c);
      } else {
        nextCenters[c] = {
          r: sums[c * 3]! / counts[c]!,
          g: sums[c * 3 + 1]! / counts[c]!,
          b: sums[c * 3 + 2]! / counts[c]!,
        };
      }
    }
    if (emptyClusters.length > 0) {
      const recovered = recoverEmptyCenters(samples, centers, assignment, emptyClusters);
      for (let i = 0; i < emptyClusters.length; i++) nextCenters[emptyClusters[i]!] = recovered[i]!;
    }

    let stable = previousAssignment !== undefined;
    if (stable) {
      for (let i = 0; i < assignment.length; i++) {
        if (assignment[i] !== previousAssignment![i]) {
          stable = false;
          break;
        }
      }
    }
    centers = nextCenters;
    previousAssignment = assignment;
    if (stable && emptyClusters.length === 0) break;
  }

  return centers.map((center) => ({
    r: Math.round(center.r),
    g: Math.round(center.g),
    b: Math.round(center.b),
  })).sort(compareRgb);
}

export function measureSpatialFragmentation(
  labels: ArrayLike<number>,
  width: number,
  height: number,
): PipelineDiagnostics {
  requirePositiveInteger('width', width);
  requirePositiveInteger('height', height);
  if (labels.length !== width * height) throw new Error('labels 长度必须等于 width * height');

  const visited = new Uint8Array(labels.length);
  const queue = new Int32Array(labels.length);
  let componentCount = 0;
  let singletonComponentCount = 0;
  let smallComponentCount = 0;
  let validCellCount = 0;
  let boundaryCount = 0;
  let adjacencyCount = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x;
      const label = labels[pixel]!;
      if (label < 0) continue;
      validCellCount++;
      if (x + 1 < width && labels[pixel + 1]! >= 0) {
        adjacencyCount++;
        if (label !== labels[pixel + 1]!) boundaryCount++;
      }
      if (y + 1 < height && labels[pixel + width]! >= 0) {
        adjacencyCount++;
        if (label !== labels[pixel + width]!) boundaryCount++;
      }
      if (visited[pixel]) continue;

      componentCount++;
      let head = 0;
      let tail = 0;
      let size = 0;
      visited[pixel] = 1;
      queue[tail++] = pixel;
      while (head < tail) {
        const current = queue[head++]!;
        size++;
        const currentX = current % width;
        const currentY = (current - currentX) / width;
        if (currentX > 0) visit(current - 1);
        if (currentX + 1 < width) visit(current + 1);
        if (currentY > 0) visit(current - width);
        if (currentY + 1 < height) visit(current + width);
      }
      if (size === 1) singletonComponentCount++;
      if (size <= 2) smallComponentCount++;

      function visit(next: number): void {
        if (visited[next] || labels[next] !== label) return;
        visited[next] = 1;
        queue[tail++] = next;
      }
    }
  }

  return {
    componentCount,
    singletonComponentCount,
    singletonRatio: componentCount > 0 ? singletonComponentCount / componentCount : 0,
    smallComponentCount,
    smallComponentRatio: componentCount > 0 ? smallComponentCount / componentCount : 0,
    smallComponentThreshold: 2,
    validCellCount,
    boundaryCount,
    adjacencyCount,
    boundaryRatio: adjacencyCount > 0 ? boundaryCount / adjacencyCount : 0,
  };
}
