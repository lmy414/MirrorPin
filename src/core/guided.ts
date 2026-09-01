// 引导滤波（保边平滑）。
// 依据论文公式移植：Kaiming He et al., "Guided Image Filtering", ECCV 2010
//   （对应参考实现 guidedfilter_color.m：彩色引导 I、逐通道输出 q）。
// 论文页: https://people.csail.mit.edu/kaiming/eccv10/index.html

import type { RgbaImage } from './types';

/** box 均值滤波（行/列累积和，O(N)，等价 MATLAB boxfilter） */
function boxFilter(src: Float64Array, W: number, H: number, r: number, weights?: ArrayLike<number>): Float64Array {
  const tmp = new Float64Array(W * H);
  const tmpWeight = new Float64Array(W * H);
  const out = new Float64Array(W * H);
  const win = 2 * r + 1;
  for (let y = 0; y < H; y++) {
    let sum = 0;
    let weightSum = 0;
    for (let x = -r; x <= r; x++) {
      const sx = Math.min(W - 1, Math.max(0, x));
      const w = weights?.[y * W + sx] ?? 1;
      sum += src[y * W + sx]! * w;
      weightSum += w;
    }
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      tmp[i] = sum;
      tmpWeight[i] = weightSum;
      const xa = Math.min(W - 1, Math.max(0, x + r + 1));
      const xr = Math.min(W - 1, Math.max(0, x - r));
      const wa = weights?.[y * W + xa] ?? 1;
      const wr = weights?.[y * W + xr] ?? 1;
      sum += src[y * W + xa]! * wa - src[y * W + xr]! * wr;
      weightSum += wa - wr;
    }
  }
  for (let x = 0; x < W; x++) {
    let sum = 0;
    let weightSum = 0;
    for (let y = -r; y <= r; y++) {
      const sy = Math.min(H - 1, Math.max(0, y));
      const i = sy * W + x;
      sum += tmp[i]!;
      weightSum += tmpWeight[i]!;
    }
    for (let y = 0; y < H; y++) {
      out[y * W + x] = weightSum > 0 ? sum / weightSum : src[y * W + x]!;
      const ya = Math.min(H - 1, Math.max(0, y + r + 1));
      const yr = Math.min(H - 1, Math.max(0, y - r));
      sum += tmp[ya * W + x]! - tmp[yr * W + x]!;
      weightSum += tmpWeight[ya * W + x]! - tmpWeight[yr * W + x]!;
    }
  }
  return out;
}

/**
 * 自引导平滑：guide = 原图 RGB，逐通道 q = mean_a·I + mean_b。
 * r 引导窗口半径（默认 8）；eps 正则项（0..255 尺度方差下限，默认 100；
 * 小=强保边，大=更平）。只处理 RGB，alpha 原样保留。
 */
export function guidedSmooth(
  img: RgbaImage,
  opts: { r?: number; eps?: number; coverage?: Float32Array } = {},
): RgbaImage {
  const r = opts.r ?? 8;
  const eps = opts.eps ?? 100;
  if (!Number.isInteger(r)) throw new Error('r 必须为整数');
  if (r < 0) throw new Error('r 必须为非负整数');
  if (!Number.isFinite(eps) || eps < 0) throw new Error('eps 必须为有限非负数');
  const { width: W, height: H, data } = img;
  if (!Number.isInteger(W) || W < 1 || !Number.isInteger(H) || H < 1) throw new Error('image width/height 必须为正整数');
  if (data.length !== W * H * 4) throw new Error('image data 长度不匹配');
  const N = W * H;
  if (opts.coverage && opts.coverage.length !== N) throw new Error('coverage 长度不匹配');
  if (opts.coverage) {
    for (let i = 0; i < N; i++) {
      const coverage = opts.coverage[i]!;
      if (!Number.isFinite(coverage) || coverage < 0 || coverage > 1) throw new Error('coverage 必须为 0..1 的有限数');
    }
  }
  const weights = opts.coverage;

  const Ir = new Float64Array(N);
  const Ig = new Float64Array(N);
  const Ib = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    Ir[i] = data[i * 4]!;
    Ig[i] = data[i * 4 + 1]!;
    Ib[i] = data[i * 4 + 2]!;
  }
  const I = [Ir, Ig, Ib];

  const meanI = I.map((c) => boxFilter(c, W, H, r, weights));
  // var/cov 矩阵（对称，6 个独立量）
  const prod = (a: Float64Array, b: Float64Array, minusMean: boolean, k1: number, k2: number) => {
    const p = new Float64Array(N);
    for (let i = 0; i < N; i++) p[i] = a[i]! * b[i]!;
    const m = boxFilter(p, W, H, r, weights);
    if (minusMean) for (let i = 0; i < N; i++) m[i]! -= meanI[k1]![i]! * meanI[k2]![i]!;
    return m;
  };
  const vrr = prod(Ir, Ir, true, 0, 0);
  const vrg = prod(Ir, Ig, true, 0, 1);
  const vrb = prod(Ir, Ib, true, 0, 2);
  const vgg = prod(Ig, Ig, true, 1, 1);
  const vgb = prod(Ig, Ib, true, 1, 2);
  const vbb = prod(Ib, Ib, true, 2, 2);
  // Always add a real diagonal regularizer. eps=0 remains supported via a tiny
  // scale-aware ridge; we never replace a singular determinant after the fact.
  const ridge = Math.max(eps, 1e-8);
  for (let i = 0; i < N; i++) {
    vrr[i]! += ridge;
    vgg[i]! += ridge;
    vbb[i]! += ridge;
  }

  // Cholesky solve for symmetric positive-definite (covariance + ridge) matrix.
  const solveSigma = (
    s00: number, s01: number, s02: number, s11: number, s12: number, s22: number,
    c0: number, c1: number, c2: number,
  ): [number, number, number] => {
    const l00 = Math.sqrt(Math.max(s00, ridge));
    const l10 = s01 / l00;
    const l20 = s02 / l00;
    const l11 = Math.sqrt(Math.max(s11 - l10 * l10, ridge));
    const l21 = (s12 - l20 * l10) / l11;
    const l22 = Math.sqrt(Math.max(s22 - l20 * l20 - l21 * l21, ridge));
    const y0 = c0 / l00;
    const y1 = (c1 - l10 * y0) / l11;
    const y2 = (c2 - l20 * y0 - l21 * y1) / l22;
    const a2 = y2 / l22;
    const a1 = (y1 - l21 * a2) / l11;
    const a0 = (y0 - l10 * a1 - l20 * a2) / l00;
    return [a0, a1, a2];
  };

  const out = new Uint8ClampedArray(img.data);
  for (let c = 0; c < 3; c++) {
    const p = I[c]!;
    const mean_p = boxFilter(p, W, H, r, weights);
    const cov = [0, 1, 2].map((k) => {
      const pr = new Float64Array(N);
      for (let i = 0; i < N; i++) pr[i] = I[k]![i]! * p[i]!;
      const m = boxFilter(pr, W, H, r, weights);
      for (let i = 0; i < N; i++) m[i]! -= meanI[k]![i]! * mean_p[i]!;
      return m;
    });
    const a0 = new Float64Array(N);
    const a1 = new Float64Array(N);
    const a2 = new Float64Array(N);
    const b = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const c0 = cov[0]![i]!;
      const c1 = cov[1]![i]!;
      const c2 = cov[2]![i]!;
      const [a_0, a_1, a_2] = solveSigma(vrr[i]!, vrg[i]!, vrb[i]!, vgg[i]!, vgb[i]!, vbb[i]!, c0, c1, c2);
      a0[i] = a_0;
      a1[i] = a_1;
      a2[i] = a_2;
      b[i] = mean_p[i]! - a_0 * meanI[0]![i]! - a_1 * meanI[1]![i]! - a_2 * meanI[2]![i]!;
    }
    const ma0 = boxFilter(a0, W, H, r, weights);
    const ma1 = boxFilter(a1, W, H, r, weights);
    const ma2 = boxFilter(a2, W, H, r, weights);
    const mb = boxFilter(b, W, H, r, weights);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const q = ma0[i]! * Ir[i]! + ma1[i]! * Ig[i]! + ma2[i]! * Ib[i]! + mb[i]!;
        out[i * 4 + c] = Math.round(Math.min(255, Math.max(0, q)));
      }
    }
  }
  return { width: W, height: H, data: out };
}
