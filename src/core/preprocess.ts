// 图像预处理：box 模糊（可分离，跳过透明像素，用于像素化前降杂色）。

import type { RgbaImage } from './types';

/**
 * 可分离 box 模糊：水平+垂直各窗口半径为 radius 的均值。
 * 只对不透明像素求平均（避免透明边缘渗入 RGB），输出保留原 alpha。
 * @param img 原图
 * @param radius 单侧窗口半径（像素），<=0 时返回原图
 */
export function boxBlur(img: RgbaImage, radius: number): RgbaImage {
  if (!(radius > 0)) return img;
  const { width: W, height: H, data } = img;
  const n = W * H;
  const r = Math.floor(radius);

  // 不透明掩码（用源 alpha）
  const opaque = new Uint8Array(n);
  const buf = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    opaque[i] = (data[o + 3] as number) >= 128 ? 1 : 0;
    buf[i * 3] = data[o] as number;
    buf[i * 3 + 1] = data[o + 1] as number;
    buf[i * 3 + 2] = data[o + 2] as number;
  }

  // 水平
  const hpass = new Float32Array(n * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sr = 0, sg = 0, sb = 0, c = 0;
      for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= W) continue;
        const j = y * W + nx;
        if (!opaque[j]) continue;
        sr += buf[j * 3]!; sg += buf[j * 3 + 1]!; sb += buf[j * 3 + 2]!; c++;
      }
      const i = y * W + x;
      if (c) { hpass[i * 3] = sr / c; hpass[i * 3 + 1] = sg / c; hpass[i * 3 + 2] = sb / c; }
      else { hpass[i * 3] = buf[i * 3]!; hpass[i * 3 + 1] = buf[i * 3 + 1]!; hpass[i * 3 + 2] = buf[i * 3 + 2]!; }
    }
  }

  // 垂直 + 写回
  const out = new Uint8ClampedArray(n * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sr = 0, sg = 0, sb = 0, c = 0;
      for (let dy = -r; dy <= r; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= H) continue;
        const j = ny * W + x;
        if (!opaque[j]) continue;
        sr += hpass[j * 3]!; sg += hpass[j * 3 + 1]!; sb += hpass[j * 3 + 2]!; c++;
      }
      const i = (y * W + x) * 4;
      const o = i;
      if (c) { out[o] = sr / c; out[o + 1] = sg / c; out[o + 2] = sb / c; }
      else { out[o] = data[o]!; out[o + 1] = data[o + 1]!; out[o + 2] = data[o + 2]!;
      }
      out[o + 3] = data[o + 3]!; // 保留原 alpha
    }
  }
  return { width: W, height: H, data: out };
}

/** 一维高斯核（sigma 驱动，半径 = ceil(3σ)），已归一 */
function gaussianWeights(sigma: number): { weights: number[]; radius: number } {
  const radius = Math.max(1, Math.ceil(3 * sigma));
  const weights: number[] = [];
  let sum = 0;
  for (let k = -radius; k <= radius; k++) {
    const w = Math.exp(-(k * k) / (2 * sigma * sigma));
    weights.push(w);
    sum += w;
  }
  for (let i = 0; i < weights.length; i++) weights[i] = (weights[i] as number) / sum;
  return { weights, radius };
}

/**
 * 可分离高斯模糊（水平+垂直各一次一维高斯卷积）。
 * 只对不透明像素加权平均（避免透明边缘渗入 RGB），输出保留原 alpha。
 * @param sigma 高斯标准差（像素）；<=0 返回原图
 */
export function gaussianBlur(img: RgbaImage, sigma: number, coverage?: Float32Array): RgbaImage {
  if (!Number.isFinite(sigma) || sigma > 64) throw new Error('sigma 必须为 finite 且不超过 64');
  if (sigma <= 0) return img;
  const { width: W, height: H, data } = img;
  const { weights, radius } = gaussianWeights(sigma);
  const n = W * H;

  if (coverage && coverage.length !== n) throw new Error('coverage 长度不匹配');
  const opaque = new Uint8Array(n);
  const src = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const coverageValue = coverage?.[i] ?? 1;
    if (!Number.isFinite(coverageValue) || coverageValue < 0 || coverageValue > 1) throw new Error('coverage 必须为 0..1 的有限数');
    opaque[i] = coverageValue > 0 ? 1 : 0;
    src[i * 3] = data[i * 4] as number;
    src[i * 3 + 1] = data[i * 4 + 1] as number;
    src[i * 3 + 2] = data[i * 4 + 2] as number;
  }

  // Separable weighted convolution: keep numerator and local weight separate
  // through both passes, then normalize once. This preserves straight RGB.
  const hNumerator = new Float32Array(n * 3);
  const hWeight = new Float32Array(n);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      for (let k = -radius; k <= radius; k++) {
        const nx = x + k;
        if (nx < 0 || nx >= W) continue;
        const j = y * W + nx;
        if (!opaque[j]) continue;
        const w = (weights[k + radius] as number) * (coverage?.[j] ?? 1);
        hWeight[i]! += w;
        hNumerator[i * 3]! += src[j * 3]! * w;
        hNumerator[i * 3 + 1]! += src[j * 3 + 1]! * w;
        hNumerator[i * 3 + 2]! += src[j * 3 + 2]! * w;
      }
    }
  }

  // Vertical pass + one local normalization.
  const out = new Uint8ClampedArray(n * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sr = 0, sg = 0, sb = 0, c = 0;
      for (let k = -radius; k <= radius; k++) {
        const ny = y + k;
        if (ny < 0 || ny >= H) continue;
        const j = ny * W + x;
        const w = weights[k + radius] as number;
        c += hWeight[j]! * w;
        sr += hNumerator[j * 3]! * w;
        sg += hNumerator[j * 3 + 1]! * w;
        sb += hNumerator[j * 3 + 2]! * w;
      }
      const i = (y * W + x) * 4;
      if (c > 0) {
        out[i] = sr / c;
        out[i + 1] = sg / c;
        out[i + 2] = sb / c;
      } else {
        out[i] = data[i]!;
        out[i + 1] = data[i + 1]!;
        out[i + 2] = data[i + 2]!;
      }
      out[i + 3] = data[i + 3]!;
    }
  }
  return { width: W, height: H, data: out };
}