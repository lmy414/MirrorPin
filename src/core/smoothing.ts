import type { ForegroundMask } from './background';
import type { RgbaImage } from './types';

/**
 * Apply one smoothing implementation to the foreground support only.
 *
 * The mask is cropped to its positive-coverage bounding box. RGB outside the
 * support is replaced by the nearest foreground colour; only RGB at
 * positive-coverage pixels is copied back. Positive-coverage RGB remains
 * straight RGB (never premultiplied); coverage is passed separately so local
 * algorithms can use it as a neighbourhood weight. The input alpha (and hence
 * the final mask) is unchanged. For global L0, callers use the same
 * bbox/extension isolation but this is not a mathematically weighted L0
 * objective.
 */
export function applyMaskForSmoothing(
  image: RgbaImage,
  mask: ForegroundMask,
  smooth: (image: RgbaImage, coverage: Float32Array) => RgbaImage,
): RgbaImage {
  validatePair(image, mask);
  const { width, height } = image;
  const pixels = width * height;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let pixel = 0; pixel < pixels; pixel++) {
    if (mask.coverage[pixel]! <= 0) continue;
    const x = pixel % width;
    const y = (pixel - x) / width;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  if (x1 < 0) return { width, height, data: new Uint8ClampedArray(image.data) };

  const cropWidth = x1 - x0 + 1;
  const cropHeight = y1 - y0 + 1;
  const cropPixels = cropWidth * cropHeight;
  const owner = nearestForegroundOwners(image, mask, x0, y0, x1, y1);
  const tile = new Uint8ClampedArray(cropPixels * 4);
  const tileCoverage = new Float32Array(cropPixels);
  for (let y = 0; y < cropHeight; y++) {
    for (let x = 0; x < cropWidth; x++) {
      const local = y * cropWidth + x;
      const sourcePixel = (y + y0) * width + x + x0;
      const source = sourcePixel * 4;
      const ownerPixel = owner[local]!;
      const ownerRgb = ownerPixel >= 0 ? ownerPixel * 4 : source;
      const coverage = mask.coverage[sourcePixel]!;
      tileCoverage[local] = coverage;
      // Preserve straight RGB at every positive-coverage source pixel. Only
      // zero-coverage isolation pixels receive nearest-foreground extension.
      const rgb = coverage > 0 ? source : ownerRgb;
      tile[local * 4] = image.data[rgb]!;
      tile[local * 4 + 1] = image.data[rgb + 1]!;
      tile[local * 4 + 2] = image.data[rgb + 2]!;
      tile[local * 4 + 3] = 255;
    }
  }

  const smoothed = smooth({ width: cropWidth, height: cropHeight, data: tile }, tileCoverage);
  if (smoothed.width !== cropWidth || smoothed.height !== cropHeight || smoothed.data.length !== cropPixels * 4) {
    throw new Error('smoothing callback 必须返回相同尺寸 image');
  }
  const out = new Uint8ClampedArray(image.data);
  for (let y = 0; y < cropHeight; y++) {
    for (let x = 0; x < cropWidth; x++) {
      const sourcePixel = (y + y0) * width + x + x0;
      if (mask.coverage[sourcePixel]! <= 0) continue;
      const source = sourcePixel * 4;
      const result = (y * cropWidth + x) * 4;
      out[source] = smoothed.data[result]!;
      out[source + 1] = smoothed.data[result + 1]!;
      out[source + 2] = smoothed.data[result + 2]!;
    }
  }
  return { width, height, data: out };
}

function nearestForegroundOwners(
  image: RgbaImage,
  mask: ForegroundMask,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Int32Array {
  const width = x1 - x0 + 1;
  const height = y1 - y0 + 1;
  const owners = new Int32Array(width * height).fill(-1);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const local = y * width + x;
      const source = (y + y0) * image.width + x + x0;
      if (mask.coverage[source]! <= 0) continue;
      owners[local] = local;
      queue[tail++] = local;
    }
  }
  while (head < tail) {
    const current = queue[head++]!;
    const x = current % width;
    const y = (current - x) / width;
    visit(current - 1, x > 0, current);
    visit(current + 1, x + 1 < width, current);
    visit(current - width, y > 0, current);
    visit(current + width, y + 1 < height, current);
  }
  return owners;

  function visit(next: number, inBounds: boolean, from: number): void {
    if (!inBounds || owners[next] !== -1) return;
    owners[next] = owners[from]!;
    queue[tail++] = next;
  }
}

function validatePair(image: RgbaImage, mask: ForegroundMask): void {
  if (!Number.isInteger(image.width) || image.width < 1 || !Number.isInteger(image.height) || image.height < 1) {
    throw new Error('image width/height 必须为正整数');
  }
  if (image.data.length !== image.width * image.height * 4) throw new Error('image data 长度不匹配');
  if (mask.width !== image.width || mask.height !== image.height || mask.coverage.length !== image.width * image.height) {
    throw new Error('mask 尺寸必须与 image 匹配');
  }
  for (let pixel = 0; pixel < mask.coverage.length; pixel++) {
    const coverage = mask.coverage[pixel]!;
    if (!Number.isFinite(coverage) || coverage < 0 || coverage > 1) throw new Error('mask coverage 必须为 0..1 的有限数');
  }
}
