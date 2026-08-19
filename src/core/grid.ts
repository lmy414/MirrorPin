// 网格采样：把位图按目标行列切格，每格提取代表色。

import type { RGB, RgbaImage } from './types';
import { kmeansPalette } from './quantize';

export type SampleMode = 'dominant' | 'average' | 'kmeans';

/**
 * 按 cols×rows 切分图像，返回每格的代表色矩阵。
 * - dominant：取格内出现频率最高的颜色（更贴合拼豆，避免均值池化的灰边）
 * - average：取格内加权平均色（仅统计 alpha >= 128 的不透明像素）
 * - kmeans：格内做 K-Means(k=3) 聚类，取最大簇中心（抗混色，细节保留更好）
 * 坐标：result[y][x] 对应图像 (x,y) 所在格。
 */
export function sampleGrid(
  img: RgbaImage,
  cols: number,
  rows: number,
  mode: SampleMode = 'dominant',
): RGB[][] {
  if (!(cols > 0) || !(rows > 0)) {
    throw new Error('cols/rows 必须为正整数');
  }
  const { width, height, data } = img;
  const cellW = width / cols;
  const cellH = height / rows;

  const result: RGB[][] = [];
  for (let gy = 0; gy < rows; gy++) {
    const y0 = Math.floor(gy * cellH);
    const y1 = Math.max(y0 + 1, Math.min(height, Math.floor((gy + 1) * cellH)));
    const row: RGB[] = [];
    for (let gx = 0; gx < cols; gx++) {
      const x0 = Math.floor(gx * cellW);
      const x1 = Math.max(x0 + 1, Math.min(width, Math.floor((gx + 1) * cellW)));
      row.push(mode === 'kmeans' ? sampleCellKMeans(data, width, x0, x1, y0, y1) : sampleCell(data, width, x0, x1, y0, y1, mode));
    }
    result.push(row);
  }
  return result;
}

function sampleCell(
  data: Uint8ClampedArray,
  width: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  mode: Exclude<SampleMode, 'kmeans'>,
): RGB {
  const map = new Map<number, { count: number; r: number; g: number; b: number }>();
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let n = 0;

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      const a = data[i + 3] as number;
      if (a < 128) continue; // 忽略透明像素
      const r = data[i] as number;
      const g = data[i + 1] as number;
      const b = data[i + 2] as number;
      rSum += r;
      gSum += g;
      bSum += b;
      n++;
      if (mode === 'dominant') {
        const key = (r << 16) | (g << 8) | b;
        const cur = map.get(key);
        if (cur) cur.count++;
        else map.set(key, { count: 1, r, g, b });
      }
    }
  }

  if (n === 0) return { r: 255, g: 255, b: 255 }; // 全透明格 -> 白
  if (mode === 'average') {
    return { r: rSum / n, g: gSum / n, b: bSum / n };
  }
  // dominant：返回最频繁颜色
  let best: RGB = { r: 255, g: 255, b: 255 };
  let bestCount = -1;
  for (const entry of map.values()) {
    if (entry.count > bestCount) {
      bestCount = entry.count;
      best = { r: entry.r, g: entry.g, b: entry.b };
    }
  }
  return best;
}

/** 每格最大抽样像素数，控制 k-means 开销 */
const KMEANS_SAMPLE_MAX = 200;

function sampleCellKMeans(
  data: Uint8ClampedArray,
  width: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): RGB {
  const px: RGB[] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      if ((data[i + 3] as number) < 128) continue;
      px.push({ r: data[i] as number, g: data[i + 1] as number, b: data[i + 2] as number });
      if (px.length >= KMEANS_SAMPLE_MAX) break;
    }
    if (px.length >= KMEANS_SAMPLE_MAX) break;
  }
  if (px.length === 0) return { r: 255, g: 255, b: 255 };

  // k=3 聚类，取样本数最多的簇中心作为该格代表
  const centers = kmeansPalette(px, 3);
  if (centers.length === 1) return centers[0] as RGB;
  const votes = new Array(centers.length).fill(0);
  for (const p of px) {
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < centers.length; i++) {
      const c = centers[i] as RGB;
      const d = (p.r - c.r) ** 2 + (p.g - c.g) ** 2 + (p.b - c.b) ** 2;
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    votes[bi]++;
  }
  let mi = 0;
  for (let i = 0; i < votes.length; i++) if ((votes[i] as number) > (votes[mi] as number)) mi = i;
  return centers[mi] as RGB;
}