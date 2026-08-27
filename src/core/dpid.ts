// DPID：Rapid, Detail-Preserving Image Downscaling（保细节降采样）。
// 移植自论文作者官方 MATLAB 实现（BSD-3-Clause）：
//   https://github.com/mergian/dpid  (matab/dpid.m)
// 论文: Weber et al., "Rapid, Detail-Preserving Image Downscaling", SIGGRAPH Asia 2016。
// 权重 f = (‖局部均值 − 像素色‖ / (255·√3))^λ × 面积覆盖；λ=0 严格退化为面积平均(BOX)。

import type { RgbaImage } from './types';

/**
 * DPID 降采样到 gw×gh。
 * norm 只算 RGB（alpha 不参与偏差），alpha 与 RGB 用同一套权重累计。
 */
export function dpidDownscale(
  img: RgbaImage,
  gw: number,
  gh: number,
  opts: { lambda?: number } = {},
): RgbaImage {
  const lambda = opts.lambda ?? 1.0;
  const { width: W, height: H, data } = img;

  // ---- Pass 1: 面积平均图（部分像素覆盖加权） ----
  const avg = new Float64Array(gw * gh * 4);
  const pw = W / gw;
  const ph = H / gh;
  for (let py = 0; py < gh; py++) {
    const sy = Math.max(py * ph, 0);
    const ey = Math.min((py + 1) * ph, H);
    for (let px = 0; px < gw; px++) {
      const sx = Math.max(px * pw, 0);
      const ex = Math.min((px + 1) * pw, W);
      let fSum = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let iy = Math.floor(sy); iy < Math.ceil(ey); iy++) {
        for (let ix = Math.floor(sx); ix < Math.ceil(ex); ix++) {
          let f = coverage(ix, iy, sx, ex, sy, ey);
          const o = (iy * W + ix) * 4;
          r += data[o]! * f;
          g += data[o + 1]! * f;
          b += data[o + 2]! * f;
          a += data[o + 3]! * f;
          fSum += f;
        }
      }
      const o = (py * gw + px) * 4;
      if (fSum > 0) {
        avg[o] = r / fSum;
        avg[o + 1] = g / fSum;
        avg[o + 2] = b / fSum;
        avg[o + 3] = a / fSum;
      }
    }
  }

  // ---- Pass 2: 细节加权输出 ----
  const out = new Uint8ClampedArray(gw * gh * 4);
  const normMax = Math.sqrt(255 * 255 * 3);
  for (let py = 0; py < gh; py++) {
    for (let px = 0; px < gw; px++) {
      // 3×3 邻域底色（权重 [[1,2,1],[2,4,2],[1,2,1]]，跳过越界，按权重归一）
      let wr = 0;
      let ar = 0;
      let ag = 0;
      let ab = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          const ny = py + dy;
          if (nx < 0 || nx >= gw || ny < 0 || ny >= gh) continue;
          const w = dx === 0 ? (dy === 0 ? 4 : 2) : dy === 0 ? 2 : 1;
          const o = (ny * gw + nx) * 4;
          ar += avg[o]! * w;
          ag += avg[o + 1]! * w;
          ab += avg[o + 2]! * w;
          wr += w;
        }
      }
      const localR = ar / wr;
      const localG = ag / wr;
      const localB = ab / wr;

      const sy = Math.max(py * ph, 0);
      const ey = Math.min((py + 1) * ph, H);
      const sx = Math.max(px * pw, 0);
      const ex = Math.min((px + 1) * pw, W);
      let fSum = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let iy = Math.floor(sy); iy < Math.ceil(ey); iy++) {
        for (let ix = Math.floor(sx); ix < Math.ceil(ex); ix++) {
          let f = 1;
          if (lambda !== 0) {
            const o = (iy * W + ix) * 4;
            const dr = localR - data[o]!;
            const dg = localG - data[o + 1]!;
            const db = localB - data[o + 2]!;
            f = Math.pow(Math.sqrt(dr * dr + dg * dg + db * db) / normMax, lambda);
          }
          f *= coverage(ix, iy, sx, ex, sy, ey);
          const o = (iy * W + ix) * 4;
          r += data[o]! * f;
          g += data[o + 1]! * f;
          b += data[o + 2]! * f;
          a += data[o + 3]! * f;
          fSum += f;
        }
      }
      const o = (py * gw + px) * 4;
      if (fSum > 0) {
        out[o] = r / fSum;
        out[o + 1] = g / fSum;
        out[o + 2] = b / fSum;
        out[o + 3] = a / fSum;
      } else {
        out[o] = avg[o]!;
        out[o + 1] = avg[o + 1]!;
        out[o + 2] = avg[o + 2]!;
        out[o + 3] = avg[o + 3]!;
      }
    }
  }
  return { width: gw, height: gh, data: out };
}

/** 像素 (ix,iy) 对目标格 [sx,ex)×[sy,ey) 的部分覆盖权重（与参考实现一致） */
function coverage(
  ix: number,
  iy: number,
  sx: number,
  ex: number,
  sy: number,
  ey: number,
): number {
  let f = 1;
  if (ix < sx) f *= 1 - (sx - ix);
  if (ix + 1 > ex) f *= 1 - (ix + 1 - ex);
  if (iy < sy) f *= 1 - (sy - iy);
  if (iy + 1 > ey) f *= 1 - (iy + 1 - ey);
  return f;
}
