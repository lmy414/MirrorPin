// K-Means++ 减色量化：把一组像素颜色聚成 k 个代表色。
// 用于评审文档 4.1 管线第一步的降色；K 值由调用方按色域/色号上限给出。

import type { RGB } from './types';

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

function sqDist(a: RGB, b: RGB): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr + dg * dg + db * db;
}

/**
 * 将像素颜色聚成 k 个代表色（RGB 空间）。
 * 返回的中心数为 min(k, 去重像素数)。样本不足时退回去重集合。
 * @param pixels 颜色样本（可重复）
 * @param k 目标聚数（>= 1）
 * @param seed 随机种子（可选，默认固定，便于测试）
 */
export function kmeansPalette(pixels: RGB[], k: number, seed = 42): RGB[] {
  if (k < 1) throw new Error('k 必须 >= 1');
  if (pixels.length === 0) return [];

  // 去重，得到唯一色集合（聚类的第一次数据缩减，也避免空簇兜底时取到重复样本）
  const uniq: RGB[] = [];
  const seen = new Set<number>();
  for (const p of pixels) {
    const key = (p.r << 16) | (p.g << 8) | p.b;
    if (!seen.has(key)) {
      seen.add(key);
      uniq.push(p);
    }
  }
  if (uniq.length <= k) return uniq;

  const rnd = mulberry32(seed);
  const data = uniq;
  const n = data.length;

  // ---- K-Means++ 初始化 ----
  const centers: RGB[] = [];
  centers.push(data[Math.floor(rnd() * n)] as RGB);
  const closestDist = new Float64Array(n);
  while (centers.length < k) {
    let sum = 0;
    let farthest = -1;
    let farthestDist = 0;
    for (let i = 0; i < n; i++) {
      let d = Infinity;
      for (let c = 0; c < centers.length; c++) {
        d = Math.min(d, sqDist(data[i] as RGB, centers[c] as RGB));
      }
      closestDist[i] = d;
      sum += d;
      if (d > farthestDist) {
        farthestDist = d;
        farthest = i;
      }
    }
    // 全 0 距离时退化，直接取最远像素作为新中心
    if (sum === 0) {
      centers.push(data[farthest] as RGB);
      continue;
    }
    // 按 D² 权重抽样
    let target = rnd() * sum;
    let chosen = n - 1;
    for (let i = 0; i < n; i++) {
      target -= closestDist[i] as number;
      if (target <= 0) {
        chosen = i;
        break;
      }
    }
    centers.push(data[chosen] as RGB);
  }

  // ---- Lloyd 迭代 ----
  const assign = new Int32Array(n);
  const sums = new Float64Array(k * 3);
  const counts = new Int32Array(k);
  const maxIter = 25;
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      const p = data[i] as RGB;
      let bestC = 0;
      let bestD = sqDist(p, centers[0] as RGB);
      for (let c = 1; c < k; c++) {
        const d = sqDist(p, centers[c] as RGB);
        if (d < bestD) {
          bestD = d;
          bestC = c;
        }
      }
      if (assign[i] !== bestC) {
        assign[i] = bestC;
        changed = true;
      }
    }
    if (!changed) break;

    sums.fill(0);
    counts.fill(0);
    for (let i = 0; i < n; i++) {
      const c = assign[i] as number;
      const p = data[i] as RGB;
      const ci = c * 3;
      sums[ci] = sums[ci]! + p.r;
      sums[ci + 1] = sums[ci + 1]! + p.g;
      sums[ci + 2] = sums[ci + 2]! + p.b;
      counts[c] = counts[c]! + 1;
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] === 0) {
        // 空簇：暴力替换为距其最远的已有点，保证 k 个非空中心
        let farI = 0;
        let farD = -1;
        const center = centers[c] as RGB;
        for (let i = 0; i < n; i++) {
          const d = sqDist(data[i] as RGB, center);
          if (d > farD) {
            farD = d;
            farI = i;
          }
        }
        centers[c] = { ...(data[farI] as RGB) };
      } else {
        centers[c] = {
          r: sums[c * 3]! / counts[c]!,
          g: sums[c * 3 + 1]! / counts[c]!,
          b: sums[c * 3 + 2]! / counts[c]!,
        };
      }
    }
  }

  return centers.map((c) => ({
    r: Math.round(c.r),
    g: Math.round(c.g),
    b: Math.round(c.b),
  }));
}