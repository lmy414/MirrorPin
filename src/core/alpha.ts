import type { AlphaPolicy, RgbaImage } from './types';
import { resolveAlphaPolicy } from './options';

export function isAlphaIncluded(alpha: number, policy: AlphaPolicy = {}): boolean {
  return alpha >= resolveAlphaPolicy(policy).threshold;
}

export function cleanTransparentRgb(
  img: RgbaImage,
  policy: AlphaPolicy = {},
): RgbaImage {
  const { threshold } = resolveAlphaPolicy(policy);
  const out = new Uint8ClampedArray(img.data);
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3]! >= threshold) continue;
    out[i] = 0;
    out[i + 1] = 0;
    out[i + 2] = 0;
  }
  return { width: img.width, height: img.height, data: out };
}

export function extendTransparentRgb(
  img: RgbaImage,
  policy: AlphaPolicy = {},
): RgbaImage {
  const { threshold } = resolveAlphaPolicy(policy);
  const { width, height, data } = img;
  const pixelCount = width * height;
  const out = new Uint8ClampedArray(data);
  const owner = new Int32Array(pixelCount).fill(-1);
  const queue = new Int32Array(pixelCount);
  let head = 0;
  let tail = 0;

  for (let pixel = 0; pixel < pixelCount; pixel++) {
    if (data[pixel * 4 + 3]! < threshold) continue;
    owner[pixel] = pixel;
    queue[tail++] = pixel;
  }

  if (tail === 0) return cleanTransparentRgb(img, policy);

  while (head < tail) {
    const pixel = queue[head++]!;
    const x = pixel % width;
    const y = (pixel - x) / width;
    if (x > 0) visit(pixel - 1, pixel);
    if (x + 1 < width) visit(pixel + 1, pixel);
    if (y > 0) visit(pixel - width, pixel);
    if (y + 1 < height) visit(pixel + width, pixel);
  }

  for (let pixel = 0; pixel < pixelCount; pixel++) {
    const offset = pixel * 4;
    if (data[offset + 3]! >= threshold) continue;
    const source = owner[pixel]! * 4;
    out[offset] = data[source]!;
    out[offset + 1] = data[source + 1]!;
    out[offset + 2] = data[source + 2]!;
  }
  return { width, height, data: out };

  function visit(next: number, from: number): void {
    if (owner[next] !== -1) return;
    owner[next] = owner[from]!;
    queue[tail++] = next;
  }
}
