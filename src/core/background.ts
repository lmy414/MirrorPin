import type { AlphaPolicy, RgbaImage } from './types';
import { resolveAlphaPolicy } from './options';
import { ciede2000, srgbToLab, type Lab } from '../beadpattern/ciede2000';

export interface ForegroundMask {
  width: number;
  height: number;
  coverage: Float32Array;
}

export interface BuildForegroundMaskOptions {
  mode?: 'none' | 'flood';
  tolerance?: number;
  alpha?: AlphaPolicy;
}

export interface ImageMaskPair {
  image: RgbaImage;
  mask: ForegroundMask;
}

export function validateForegroundMask(mask: ForegroundMask): void {
  if (!Number.isInteger(mask.width) || mask.width < 1 || !Number.isInteger(mask.height) || mask.height < 1) {
    throw new Error('mask width/height 必须为正整数');
  }
  if (mask.coverage.length !== mask.width * mask.height) throw new Error('mask coverage 长度不匹配');
  for (let pixel = 0; pixel < mask.coverage.length; pixel++) {
    const coverage = mask.coverage[pixel]!;
    if (!Number.isFinite(coverage) || coverage < 0 || coverage > 1) {
      throw new Error(`mask coverage[${pixel}] 必须为 0..1 的有限数`);
    }
  }
}

export function buildForegroundMask(
  img: RgbaImage,
  options: BuildForegroundMaskOptions = {},
): ForegroundMask {
  validateImage(img);
  const mode = options.mode ?? 'none';
  if (mode !== 'none' && mode !== 'flood') throw new Error(`mode 非法: ${String(mode)}`);
  const tolerance = options.tolerance ?? 12;
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new Error('tolerance 必须为有限非负数');
  const { threshold } = resolveAlphaPolicy(options.alpha);
  const coverage = alphaCoverage(img);
  validateForegroundMask({ width: img.width, height: img.height, coverage });
  if (mode === 'none' || img.width === 0 || img.height === 0) {
    return { width: img.width, height: img.height, coverage };
  }

  const border = collectOpaqueBorder(img, threshold);
  if (border.length === 0) return { width: img.width, height: img.height, coverage };
  const background = robustBorderBackground(img, border, tolerance);
  if (!background) return { width: img.width, height: img.height, coverage };
  const backgroundLab = srgbToLab(background.rgb);
  if (!hasInteriorSeparation(img, backgroundLab, tolerance, threshold)) {
    return { width: img.width, height: img.height, coverage };
  }
  const acceptedSeed = new Uint8Array(img.width * img.height);
  for (const sample of border) {
    if (ciede2000(backgroundLab, sample.lab) <= tolerance) acceptedSeed[sample.pixel] = 1;
  }

  const visited = new Uint8Array(img.width * img.height);
  const queue = new Int32Array(img.width * img.height);
  let head = 0;
  let tail = 0;
  for (const sample of border) {
    const pixel = sample.pixel;
    if (!acceptedSeed[pixel] || visited[pixel]) continue;
    visited[pixel] = 1;
    queue[tail++] = pixel;
  }

  while (head < tail) {
    const pixel = queue[head++]!;
    const x = pixel % img.width;
    const y = (pixel - x) / img.width;
    visit(pixel - 1, x > 0);
    visit(pixel + 1, x + 1 < img.width);
    visit(pixel - img.width, y > 0);
    visit(pixel + img.width, y + 1 < img.height);
  }
  for (let i = 0; i < tail; i++) coverage[queue[i]!] = 0;
  return { width: img.width, height: img.height, coverage };

  function visit(next: number, inBounds: boolean): void {
    if (!inBounds || visited[next] || coverage[next]! <= 0) return;
    const offset = next * 4;
    const lab = srgbToLab({ r: img.data[offset]!, g: img.data[offset + 1]!, b: img.data[offset + 2]! });
    if (ciede2000(backgroundLab, lab) > tolerance) return;
    visited[next] = 1;
    queue[tail++] = next;
  }
}

export function extendMaskedRgb(image: RgbaImage, mask: ForegroundMask): RgbaImage {
  validatePair(image, mask);
  const pixels = image.width * image.height;
  const owner = new Int32Array(pixels).fill(-1);
  const queue = new Int32Array(pixels);
  let head = 0;
  let tail = 0;
  for (let pixel = 0; pixel < pixels; pixel++) {
    if (mask.coverage[pixel]! < 128 / 255) continue;
    owner[pixel] = pixel;
    queue[tail++] = pixel;
  }
  if (tail === 0) return image;
  while (head < tail) {
    const pixel = queue[head++]!;
    const x = pixel % image.width;
    const y = (pixel - x) / image.width;
    visit(pixel - 1, x > 0, pixel);
    visit(pixel + 1, x + 1 < image.width, pixel);
    visit(pixel - image.width, y > 0, pixel);
    visit(pixel + image.width, y + 1 < image.height, pixel);
  }
  const data = new Uint8ClampedArray(image.data);
  for (let pixel = 0; pixel < pixels; pixel++) {
    if (mask.coverage[pixel]! >= 128 / 255) continue;
    const source = owner[pixel]! * 4;
    const target = pixel * 4;
    data[target] = image.data[source]!;
    data[target + 1] = image.data[source + 1]!;
    data[target + 2] = image.data[source + 2]!;
  }
  return { width: image.width, height: image.height, data };

  function visit(next: number, inBounds: boolean, from: number): void {
    if (!inBounds || owner[next] !== -1) return;
    owner[next] = owner[from]!;
    queue[tail++] = next;
  }
}

export function cropImageAndMaskToSubject(
  image: RgbaImage,
  mask: ForegroundMask,
  pad = 0,
): ImageMaskPair {
  validatePair(image, mask);
  if (!Number.isInteger(pad) || pad < 0) throw new Error('pad 必须为非负整数');
  let x0 = image.width;
  let y0 = image.height;
  let x1 = -1;
  let y1 = -1;
  for (let pixel = 0; pixel < mask.coverage.length; pixel++) {
    if (mask.coverage[pixel]! < 128 / 255) continue;
    const x = pixel % image.width;
    const y = (pixel - x) / image.width;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (x1 < 0) return { image, mask };
  return cropImageAndMaskRect(
    image,
    mask,
    Math.max(0, x0 - pad),
    Math.max(0, y0 - pad),
    Math.min(image.width, x1 + 1 + pad),
    Math.min(image.height, y1 + 1 + pad),
  );
}

export function cropImageAndMaskToAspect(
  image: RgbaImage,
  mask: ForegroundMask,
  targetWidth: number,
  targetHeight: number,
): ImageMaskPair {
  validatePair(image, mask);
  requirePositiveFinite('targetWidth', targetWidth);
  requirePositiveFinite('targetHeight', targetHeight);
  const target = targetWidth / targetHeight;
  const current = image.width / image.height;
  if (Math.abs(target - current) < 1e-12) return { image, mask };

  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  for (let pixel = 0; pixel < mask.coverage.length; pixel++) {
    if (mask.coverage[pixel]! < 128 / 255) continue;
    const x = pixel % image.width;
    const y = (pixel - x) / image.width;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const cx = maxX >= 0 ? (minX + maxX) / 2 : (image.width - 1) / 2;
  const cy = maxY >= 0 ? (minY + maxY) / 2 : (image.height - 1) / 2;
  let width: number;
  let height: number;
  if (target > current) {
    width = image.width;
    height = Math.max(1, Math.round(width / target));
  } else {
    height = image.height;
    width = Math.max(1, Math.round(height * target));
  }
  const x0 = Math.round(Math.min(Math.max(cx - (width - 1) / 2, 0), image.width - width));
  const y0 = Math.round(Math.min(Math.max(cy - (height - 1) / 2, 0), image.height - height));
  return cropImageAndMaskRect(image, mask, x0, y0, x0 + width, y0 + height);
}

export function cropImageAndMaskRect(
  image: RgbaImage,
  mask: ForegroundMask,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): ImageMaskPair {
  validatePair(image, mask);
  for (const [name, value] of [['x0', x0], ['y0', y0], ['x1', x1], ['y1', y1]] as const) {
    if (!Number.isInteger(value)) throw new Error(`${name} 必须为整数`);
  }
  x0 = Math.max(0, Math.min(image.width - 1, x0));
  y0 = Math.max(0, Math.min(image.height - 1, y0));
  x1 = Math.max(x0 + 1, Math.min(image.width, x1));
  y1 = Math.max(y0 + 1, Math.min(image.height, y1));
  const width = x1 - x0;
  const height = y1 - y0;
  const data = new Uint8ClampedArray(width * height * 4);
  const coverage = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sourcePixel = (y + y0) * image.width + x + x0;
      const targetPixel = y * width + x;
      data.set(image.data.subarray(sourcePixel * 4, sourcePixel * 4 + 4), targetPixel * 4);
      coverage[targetPixel] = mask.coverage[sourcePixel]!;
    }
  }
  return {
    image: { width, height, data },
    mask: { width, height, coverage },
  };
}

function alphaCoverage(img: RgbaImage): Float32Array {
  const coverage = new Float32Array(img.width * img.height);
  for (let pixel = 0; pixel < coverage.length; pixel++) coverage[pixel] = img.data[pixel * 4 + 3]! / 255;
  return coverage;
}

interface BorderSample {
  pixel: number;
  rgb: { r: number; g: number; b: number };
  lab: Lab;
  sides: number;
}

function collectOpaqueBorder(img: RgbaImage, threshold: number): BorderSample[] {
  const unique = new Uint8Array(img.width * img.height);
  const result: BorderSample[] = [];
  const add = (pixel: number) => {
    if (unique[pixel]) return;
    unique[pixel] = 1;
    const offset = pixel * 4;
    if (img.data[offset + 3]! < threshold) return;
    const rgb = { r: img.data[offset]!, g: img.data[offset + 1]!, b: img.data[offset + 2]! };
    const x = pixel % img.width;
    const y = (pixel - x) / img.width;
    let sides = 0;
    if (y === 0) sides |= 1;
    if (x === img.width - 1) sides |= 2;
    if (y === img.height - 1) sides |= 4;
    if (x === 0) sides |= 8;
    result.push({ pixel, rgb, lab: srgbToLab(rgb), sides });
  };
  for (let x = 0; x < img.width; x++) {
    add(x);
    add((img.height - 1) * img.width + x);
  }
  for (let y = 0; y < img.height; y++) {
    add(y * img.width);
    add(y * img.width + img.width - 1);
  }
  return result;
}

function robustBorderBackground(
  img: RgbaImage,
  samples: BorderSample[],
  tolerance: number,
): BorderSample | null {
  if (tolerance === 0) return null;
  // Quantized RGB buckets bound candidate count independently of border length: O(P + P*K), K<=24.
  const buckets = new Map<number, { count: number; r: number; g: number; b: number; first: BorderSample }>();
  for (const sample of samples) {
    const key = ((sample.rgb.r >> 4) << 8) | ((sample.rgb.g >> 4) << 4) | (sample.rgb.b >> 4);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.count++;
      bucket.r += sample.rgb.r;
      bucket.g += sample.rgb.g;
      bucket.b += sample.rgb.b;
    } else {
      buckets.set(key, { count: 1, r: sample.rgb.r, g: sample.rgb.g, b: sample.rgb.b, first: sample });
    }
  }
  const anchors = [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)
    .map((bucket) => {
      const rgb = { r: bucket.r / bucket.count, g: bucket.g / bucket.count, b: bucket.b / bucket.count };
      return { ...bucket.first, rgb, lab: srgbToLab(rgb) };
    });
  // Corners and their immediate inward neighbors are high-confidence candidates, capped at four extra anchors.
  for (const pixel of cornerNeighborhoodPixels(img.width, img.height)) {
    const sample = samples.find((item) => item.pixel === pixel);
    if (sample && !anchors.some((anchor) => ciede2000(anchor.lab, sample.lab) <= tolerance)) anchors.push(sample);
    if (anchors.length >= 24) break;
  }

  let selected: BorderSample[] | null = null;
  let selectedSides = 0;
  let selectedCornerGroups = 0;
  let selectedSpread = Infinity;
  let selectedShare = 0;
  for (const anchor of anchors) {
    const cluster: BorderSample[] = [];
    let sides = 0;
    let spread = 0;
    for (const sample of samples) {
      const distance = ciede2000(anchor.lab, sample.lab);
      if (distance > tolerance) continue;
      cluster.push(sample);
      sides |= sample.sides;
      spread = Math.max(spread, distance);
    }
    const sideCount = bitCount4(sides);
    const cornerGroups = matchingCornerGroups(img, anchor.lab, tolerance);
    const share = cluster.length / samples.length;
    const shareIsSafe = share >= 0.88 || (share >= 0.3 && share <= 0.6);
    const cornerDominanceSafe = !(cornerGroups === 4 && share < 0.88);
    const confident = shareIsSafe
      && cornerDominanceSafe
      && spread <= tolerance
      && cornerGroups >= 3
      && sideCount >= 3;
    if (cornerGroups === 4 && share >= 0.3 && share < 0.88) return null;
    if (!confident) continue;
    if (cornerGroups > selectedCornerGroups
      || (cornerGroups === selectedCornerGroups && sideCount > selectedSides)
      || (cornerGroups === selectedCornerGroups && sideCount === selectedSides && spread < selectedSpread)) {
      selected = cluster;
      selectedSides = sideCount;
      selectedCornerGroups = cornerGroups;
      selectedSpread = spread;
      selectedShare = share;
    }
  }
  if (!selected || (selectedCornerGroups === 4 && selectedShare < 0.88)) return null;
  const rgb = {
    r: median(selected.map((sample) => sample.rgb.r)),
    g: median(selected.map((sample) => sample.rgb.g)),
    b: median(selected.map((sample) => sample.rgb.b)),
  };
  return { ...selected[0]!, rgb, lab: srgbToLab(rgb) };
}

function hasInteriorSeparation(img: RgbaImage, background: Lab, tolerance: number, threshold: number): boolean {
  let samples = 0;
  let separated = 0;
  const x0 = Math.floor(img.width * 0.2);
  const x1 = Math.max(x0 + 1, Math.ceil(img.width * 0.8));
  const y0 = Math.floor(img.height * 0.2);
  const y1 = Math.max(y0 + 1, Math.ceil(img.height * 0.8));
  const stepX = Math.max(1, Math.floor((x1 - x0) / 8));
  const stepY = Math.max(1, Math.floor((y1 - y0) / 8));
  for (let y = y0; y < y1; y += stepY) {
    for (let x = x0; x < x1; x += stepX) {
      const offset = (y * img.width + x) * 4;
      if (img.data[offset + 3]! < threshold) continue;
      samples++;
      const lab = srgbToLab({ r: img.data[offset]!, g: img.data[offset + 1]!, b: img.data[offset + 2]! });
      if (ciede2000(background, lab) > tolerance * 1.5) separated++;
    }
  }
  return samples > 0 && separated / samples >= 0.08;
}

function cornerNeighborhoodPixels(width: number, height: number): number[] {
  const xs = [...new Set([0, Math.min(1, width - 1), Math.max(0, width - 2), width - 1])];
  const ys = [...new Set([0, Math.min(1, height - 1), Math.max(0, height - 2), height - 1])];
  const pixels: number[] = [];
  for (const y of ys) for (const x of xs) pixels.push(y * width + x);
  return pixels;
}

function matchingCornerGroups(img: RgbaImage, lab: Lab, tolerance: number): number {
  const corners: Array<[number, number]> = [[0, 0], [img.width - 1, 0], [0, img.height - 1], [img.width - 1, img.height - 1]];
  let groups = 0;
  for (const [cx, cy] of corners) {
    let matches = 0;
    let total = 0;
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        const x = cx === 0 ? dx : cx - dx;
        const y = cy === 0 ? dy : cy - dy;
        const offset = (y * img.width + x) * 4;
        if (img.data[offset + 3]! < 128) continue;
        total++;
        const sampleLab = srgbToLab({ r: img.data[offset]!, g: img.data[offset + 1]!, b: img.data[offset + 2]! });
        if (ciede2000(lab, sampleLab) <= tolerance) matches++;
      }
    }
    if (total > 0 && matches / total >= 0.75) groups++;
  }
  return groups;
}

function bitCount4(value: number): number {
  let count = 0;
  for (let bit = 1; bit <= 8; bit <<= 1) if (value & bit) count++;
  return count;
}

function median(values: number[]): number {
  values.sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  return values.length % 2 === 1 ? values[mid]! : (values[mid - 1]! + values[mid]!) / 2;
}

function validateImage(img: RgbaImage): void {
  if (!Number.isInteger(img.width) || img.width < 1 || !Number.isInteger(img.height) || img.height < 1) {
    throw new Error('image width/height 必须为正整数');
  }
  if (img.data.length !== img.width * img.height * 4) throw new Error('image data 长度不匹配');
}

function validatePair(image: RgbaImage, mask: ForegroundMask): void {
  validateImage(image);
  if (mask.width !== image.width || mask.height !== image.height || mask.coverage.length !== image.width * image.height) {
    throw new Error('mask 尺寸必须与 image 匹配');
  }
  validateForegroundMask(mask);
}

function requirePositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} 必须为有限正数`);
}
