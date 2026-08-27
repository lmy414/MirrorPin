// 引导滤波（保边平滑）。
// 依据论文公式移植：Kaiming He et al., "Guided Image Filtering", ECCV 2010
//   （对应参考实现 guidedfilter_color.m：彩色引导 I、逐通道输出 q）。
// 论文页: https://people.csail.mit.edu/kaiming/eccv10/index.html

import type { RgbaImage } from './types';

/** box 均值滤波（行/列累积和，O(N)，等价 MATLAB boxfilter） */
function boxFilter(src: Float64Array, W: number, H: number, r: number): Float64Array {
  const tmp = new Float64Array(W * H);
  const out = new Float64Array(W * H);
  const win = 2 * r + 1;
  for (let y = 0; y < H; y++) {
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[y * W + Math.min(W - 1, Math.max(0, x))]!;
    for (let x = 0; x < W; x++) {
      tmp[y * W + x] = sum / win;
      const xa = Math.min(W - 1, Math.max(0, x + r + 1));
      const xr = Math.min(W - 1, Math.max(0, x - r));
      sum += src[y * W + xa]! - src[y * W + xr]!;
    }
  }
  for (let x = 0; x < W; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[Math.min(H - 1, Math.max(0, y)) * W + x]!;
    for (let y = 0; y < H; y++) {
      out[y * W + x] = sum / win;
      const ya = Math.min(H - 1, Math.max(0, y + r + 1));
      const yr = Math.min(H - 1, Math.max(0, y - r));
      sum += tmp[ya * W + x]! - tmp[yr * W + x]!;
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
  opts: { r?: number; eps?: number } = {},
): RgbaImage {
  const r = opts.r ?? 8;
  const eps = opts.eps ?? 100;
  const { width: W, height: H, data } = img;
  const N = W * H;

  const Ir = new Float64Array(N);
  const Ig = new Float64Array(N);
  const Ib = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    Ir[i] = data[i * 4]!;
    Ig[i] = data[i * 4 + 1]!;
    Ib[i] = data[i * 4 + 2]!;
  }
  const I = [Ir, Ig, Ib];

  const meanI = I.map((c) => boxFilter(c, W, H, r));
  // var/cov 矩阵（对称，6 个独立量）
  const prod = (a: Float64Array, b: Float64Array, minusMean: boolean, k1: number, k2: number) => {
    const p = new Float64Array(N);
    for (let i = 0; i < N; i++) p[i] = a[i]! * b[i]!;
    const m = boxFilter(p, W, H, r);
    if (minusMean) for (let i = 0; i < N; i++) m[i]! -= meanI[k1]![i]! * meanI[k2]![i]!;
    return m;
  };
  const vrr = prod(Ir, Ir, true, 0, 0);
  const vrg = prod(Ir, Ig, true, 0, 1);
  const vrb = prod(Ir, Ib, true, 0, 2);
  const vgg = prod(Ig, Ig, true, 1, 1);
  const vgb = prod(Ig, Ib, true, 1, 2);
  const vbb = prod(Ib, Ib, true, 2, 2);
  for (let i = 0; i < N; i++) {
    vrr[i]! += eps;
    vgg[i]! += eps;
    vbb[i]! += eps;
  }

  // 3×3 对称阵伴随求逆（Σ⁻¹·cov，参考 guidedfilter_color.m）
  const invSigma = (s00: number, s01: number, s02: number, s11: number, s12: number, s22: number) => {
    const c00 = s11 * s22 - s12 * s12;
    const c01 = s02 * s12 - s01 * s22;
    const c02 = s01 * s12 - s02 * s11;
    const det = s00 * c00 + s01 * c01 + s02 * c02;
    return [
      [c00 / det, c01 / det, c02 / det],
      [c01 / det, (s00 * s22 - s02 * s02) / det, (s01 * s02 - s00 * s12) / det],
      [c02 / det, (s01 * s02 - s00 * s12) / det, (s00 * s11 - s01 * s01) / det],
    ];
  };

  const out = new Uint8ClampedArray(img.data);
  for (let c = 0; c < 3; c++) {
    const p = I[c]!;
    const mean_p = boxFilter(p, W, H, r);
    const cov = [0, 1, 2].map((k) => {
      const pr = new Float64Array(N);
      for (let i = 0; i < N; i++) pr[i] = I[k]![i]! * p[i]!;
      const m = boxFilter(pr, W, H, r);
      for (let i = 0; i < N; i++) m[i]! -= meanI[k]![i]! * mean_p[i]!;
      return m;
    });
    const a0 = new Float64Array(N);
    const a1 = new Float64Array(N);
    const a2 = new Float64Array(N);
    const b = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const inv = invSigma(vrr[i]!, vrg[i]!, vrb[i]!, vgg[i]!, vgb[i]!, vbb[i]!);
      const c0 = cov[0]![i]!;
      const c1 = cov[1]![i]!;
      const c2 = cov[2]![i]!;
      const a_0 = inv[0]![0]! * c0 + inv[0]![1]! * c1 + inv[0]![2]! * c2;
      const a_1 = inv[1]![0]! * c0 + inv[1]![1]! * c1 + inv[1]![2]! * c2;
      const a_2 = inv[2]![0]! * c0 + inv[2]![1]! * c1 + inv[2]![2]! * c2;
      a0[i] = a_0;
      a1[i] = a_1;
      a2[i] = a_2;
      b[i] = mean_p[i]! - a_0 * meanI[0]![i]! - a_1 * meanI[1]![i]! - a_2 * meanI[2]![i]!;
    }
    const ma0 = boxFilter(a0, W, H, r);
    const ma1 = boxFilter(a1, W, H, r);
    const ma2 = boxFilter(a2, W, H, r);
    const mb = boxFilter(b, W, H, r);
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
