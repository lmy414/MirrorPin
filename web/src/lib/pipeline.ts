import type { RgbaImage } from '@lib/core/types';
import {
  gaussianBlur,
  kmeansPalette,
  buildPalette,
  nearestSwatch,
  rgbToHex,
} from '@lib/index';

/**
 * 浏览器端预处理：高斯模糊（可选）+ kmeans 降色（可选）。
 * kColors>=256 或 blurOn=false/σ=0 时对应步骤跳过。
 */
export function preprocess(
  img: RgbaImage,
  opts: { blurOn: boolean; sigma: number; kColors: number },
): RgbaImage {
  const blurred = opts.blurOn && opts.sigma > 0 ? gaussianBlur(img, opts.sigma) : img;
  if (!(opts.kColors > 0) || opts.kColors >= 256) return blurred;

  const { width: W, height: H, data } = blurred;
  const samples: { r: number; g: number; b: number }[] = [];
  const step = 3;
  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      const i = (y * W + x) * 4;
      if (data[i + 3]! < 128) continue;
      samples.push({ r: data[i]!, g: data[i + 1]!, b: data[i + 2]! });
      if (samples.length >= 120000) break;
    }
  }
  if (samples.length === 0) return blurred;

  const centers = kmeansPalette(samples, Math.min(opts.kColors, samples.length));
  const swatches = centers.map((c, i) => ({ code: String(i), hex: rgbToHex(c) }));
  const entries = buildPalette(swatches);

  const out = new Uint8ClampedArray(data);
  const cache = new Map<number, string>();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (data[i + 3]! < 128) continue;
      const key = ((data[i]! >> 3) << 10) | ((data[i + 1]! >> 3) << 5) | (data[i + 2]! >> 3);
      let hx = cache.get(key);
      if (!hx) {
        hx = nearestSwatch({ r: data[i]!, g: data[i + 1]!, b: data[i + 2]! }, entries).hex;
        cache.set(key, hx);
      }
      out[i] = parseInt(hx.slice(0, 2), 16);
      out[i + 1] = parseInt(hx.slice(2, 4), 16);
      out[i + 2] = parseInt(hx.slice(4, 6), 16);
    }
  }
  return { width: W, height: H, data: out };
}