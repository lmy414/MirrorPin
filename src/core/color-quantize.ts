// 图像预处理：按 CLI 口径做确定性的 k-means 降色。

import type { ColorQuantizeOptions, RGB, RgbaImage } from './types';
import { rgbToHex } from './color';
import { requirePositiveInteger, resolveColorQuantizeOptions } from './options';
import { buildPalette, nearestSwatch } from './palette';
import { kmeansPalette } from './quantize';

/**
 * 对 alpha 达标像素做 k-means 降色，并把每个像素映射回代表色。
 * 兼容历史 quantizeImage(img, number)；<=0 或 >=256 表示关闭。
 */
export function quantizeImage(
  img: RgbaImage,
  colorsOrOptions: number | ColorQuantizeOptions,
): RgbaImage {
  const rawOptions = typeof colorsOrOptions === 'number'
    ? { colors: colorsOrOptions }
    : colorsOrOptions;
  const options = resolveColorQuantizeOptions(rawOptions);
  if (options.colors <= 0 || options.colors >= 256) return img;

  const { width, height, data } = img;
  const eligible: number[] = [];
  for (let pixel = 0; pixel < width * height; pixel++) {
    if (data[pixel * 4 + 3]! >= options.alpha.threshold) eligible.push(pixel);
  }
  if (eligible.length === 0) return img;

  const sampled = deterministicSampleIndices(eligible, options.sampleLimit);
  const samples: RGB[] = sampled.map((pixel) => {
    const offset = pixel * 4;
    return { r: data[offset]!, g: data[offset + 1]!, b: data[offset + 2]! };
  });
  const centers = kmeansPalette(samples, Math.min(options.colors, samples.length), options.seed);

  const entries = buildPalette(
    centers.map((center, index) => ({ code: String(index), hex: rgbToHex(center) })),
  );
  const centerByCode = new Map(entries.map((entry) => [entry.swatch.code, entry.rgb]));
  const out = new Uint8ClampedArray(data);
  const cache = new Map<number, RGB>();
  for (const pixel of eligible) {
    const offset = pixel * 4;
    const key = (data[offset]! << 16) | (data[offset + 1]! << 8) | data[offset + 2]!;
    let center = cache.get(key);
    if (!center) {
      const swatch = nearestSwatch(
        { r: data[offset]!, g: data[offset + 1]!, b: data[offset + 2]! },
        entries,
      );
      center = centerByCode.get(swatch.code)!;
      cache.set(key, center);
    }
    out[offset] = center.r;
    out[offset + 1] = center.g;
    out[offset + 2] = center.b;
  }
  return { width, height, data: out };
}

/** @internal 确定性均匀抽取索引，结果数量严格不超过 limit。 */
export function deterministicSampleIndices(
  indices: readonly number[],
  limit: number,
): number[] {
  requirePositiveInteger('sampleLimit', limit);
  if (indices.length <= limit) return [...indices];
  if (limit === 1) return [indices[Math.floor((indices.length - 1) / 2)]!];
  const sampled = new Array<number>(limit);
  const scale = (indices.length - 1) / (limit - 1);
  for (let i = 0; i < limit; i++) sampled[i] = indices[Math.round(i * scale)]!;
  return sampled;
}
