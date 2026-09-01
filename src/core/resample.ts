import type { RgbaImage } from './types';
import type { ForegroundMask } from './background';
import { requirePositiveInteger } from './options';

export interface GridSamples {
  width: number;
  height: number;
  /** Interleaved linear-light RGB, length width*height*3. */
  linearRgb: Float32Array;
  /** Foreground area fraction per cell, 0..1. */
  coverage: Float32Array;
  /** Coverage-weighted linear RGB variance magnitude per cell. */
  variance: Float32Array;
  /** Linear RGB edge magnitude toward the right neighbor. */
  edgeX: Float32Array;
  /** Linear RGB edge magnitude toward the lower neighbor. */
  edgeY: Float32Array;
  /** Number of internal source-integration passes used to produce these samples. */
  integrationPasses?: number;
}

export interface ResampleOptions {
  mask?: ForegroundMask;
}

export interface DpidResampleOptions extends ResampleOptions {
  lambda?: number;
}

export function srgbToLinear(value: number): number {
  if (!Number.isFinite(value)) throw new Error('sRGB value 必须为有限数');
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(value: number): number {
  if (!Number.isFinite(value)) throw new Error('linear value 必须为有限数');
  const normalized = value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
  return normalized * 255;
}

export function areaResampleToGrid(
  img: RgbaImage,
  width: number,
  height: number,
  options: ResampleOptions = {},
): GridSamples {
  validateInputs(img, width, height, options.mask);
  const result = allocateGrid(width, height);
  result.integrationPasses = 1;
  integrateArea(img, result, options.mask);
  computeEdges(result);
  return result;
}

/**
 * Official DPID weighting semantics: the detail weight is
 * (sRGB Euclidean distance / sqrt(3*255^2))^lambda, multiplied by exact
 * footprint area and foreground coverage. Accumulation is performed in sRGB,
 * then the final color is decoded into GridSamples.linearRgb.
 */
export function dpidResampleToGrid(
  img: RgbaImage,
  width: number,
  height: number,
  options: DpidResampleOptions = {},
): GridSamples {
  validateInputs(img, width, height, options.mask);
  const lambda = options.lambda ?? 1;
  if (!Number.isFinite(lambda) || lambda < 0) throw new Error('lambda 必须为有限非负数');
  const area = areaResampleToGrid(img, width, height, options);
  if (lambda === 0) return area;

  const result = allocateGrid(width, height);
  result.integrationPasses = (area.integrationPasses ?? 1) + 1;
  result.coverage.set(area.coverage);
  const localSrgb = localBaseSrgb(area);
  const cellWidth = img.width / width;
  const cellHeight = img.height / height;
  const maskCoverage = options.mask?.coverage;
  const norm = Math.sqrt(3 * 255 * 255);

  for (let gy = 0; gy < height; gy++) {
    const sy = gy * cellHeight;
    const ey = (gy + 1) * cellHeight;
    for (let gx = 0; gx < width; gx++) {
      const sx = gx * cellWidth;
      const ex = (gx + 1) * cellWidth;
      const gridPixel = gy * width + gx;
      const rgb = gridPixel * 3;
      let weightSum = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      let secondMoment = 0;
      // No per-footprint candidate arrays: one direct pass over overlapping pixels.
      for (let y = Math.floor(sy); y < Math.ceil(ey); y++) {
        const overlapY = rectangleOverlap(y, y + 1, sy, ey);
        for (let x = Math.floor(sx); x < Math.ceil(ex); x++) {
          const footprint = rectangleOverlap(x, x + 1, sx, ex) * overlapY;
          if (footprint <= 0) continue;
          const sourcePixel = y * img.width + x;
          const foreground = maskCoverage?.[sourcePixel] ?? (img.data[sourcePixel * 4 + 3]! / 255);
          if (foreground <= 0) continue;
          const offset = sourcePixel * 4;
          const sr = img.data[offset]!;
          const sg = img.data[offset + 1]!;
          const sb = img.data[offset + 2]!;
          const distance = Math.hypot(localSrgb[rgb]! - sr, localSrgb[rgb + 1]! - sg, localSrgb[rgb + 2]! - sb) / norm;
          const weight = footprint * foreground * Math.pow(distance, lambda);
          weightSum += weight;
          r += sr * weight;
          g += sg * weight;
          b += sb * weight;
          secondMoment += (sr * sr + sg * sg + sb * sb) * weight;
        }
      }
      if (weightSum <= 0) {
        result.linearRgb[rgb] = area.linearRgb[rgb]!;
        result.linearRgb[rgb + 1] = area.linearRgb[rgb + 1]!;
        result.linearRgb[rgb + 2] = area.linearRgb[rgb + 2]!;
        result.variance[gridPixel] = area.variance[gridPixel]!;
        continue;
      }
      const sr = r / weightSum;
      const sg = g / weightSum;
      const sb = b / weightSum;
      result.linearRgb[rgb] = srgbToLinear(sr);
      result.linearRgb[rgb + 1] = srgbToLinear(sg);
      result.linearRgb[rgb + 2] = srgbToLinear(sb);
      result.variance[gridPixel] = Math.max(0, (secondMoment / weightSum - (sr * sr + sg * sg + sb * sb)) / (255 * 255));
    }
  }
  computeEdges(result);
  return result;
}

export function gridSamplesToRgba(samples: GridSamples): RgbaImage {
  validateGridSamples(samples);
  const data = new Uint8ClampedArray(samples.width * samples.height * 4);
  for (let pixel = 0; pixel < samples.coverage.length; pixel++) {
    const rgb = pixel * 3;
    const rgba = pixel * 4;
    data[rgba] = Math.round(clampByte(linearToSrgb(samples.linearRgb[rgb]!)));
    data[rgba + 1] = Math.round(clampByte(linearToSrgb(samples.linearRgb[rgb + 1]!)));
    data[rgba + 2] = Math.round(clampByte(linearToSrgb(samples.linearRgb[rgb + 2]!)));
    data[rgba + 3] = Math.round(Math.min(1, Math.max(0, samples.coverage[pixel]!)) * 255);
  }
  return { width: samples.width, height: samples.height, data };
}

export function fitResampleToGrid(
  img: RgbaImage,
  width: number,
  height: number,
  method: 'area' | 'dpid',
  options: DpidResampleOptions = {},
): GridSamples {
  validateInputs(img, width, height, options.mask);
  const ratio = Math.min(width / img.width, height / img.height);
  const scaledWidth = Math.max(1, Math.round(img.width * ratio));
  const scaledHeight = Math.max(1, Math.round(img.height * ratio));
  const small = method === 'dpid'
    ? dpidResampleToGrid(img, scaledWidth, scaledHeight, options)
    : areaResampleToGrid(img, scaledWidth, scaledHeight, options);
  if (scaledWidth === width && scaledHeight === height) return small;
  const result = allocateGrid(width, height);
  const offsetX = Math.floor((width - scaledWidth) / 2);
  const offsetY = Math.floor((height - scaledHeight) / 2);
  for (let y = 0; y < scaledHeight; y++) {
    for (let x = 0; x < scaledWidth; x++) {
      const source = y * scaledWidth + x;
      const target = (y + offsetY) * width + x + offsetX;
      result.coverage[target] = small.coverage[source]!;
      result.variance[target] = small.variance[source]!;
      result.linearRgb.set(small.linearRgb.subarray(source * 3, source * 3 + 3), target * 3);
    }
  }
  computeEdges(result);
  return result;
}

function integrateArea(img: RgbaImage, result: GridSamples, mask?: ForegroundMask): void {
  const cellWidth = img.width / result.width;
  const cellHeight = img.height / result.height;
  const cellArea = cellWidth * cellHeight;
  for (let gy = 0; gy < result.height; gy++) {
    const sy = gy * cellHeight;
    const ey = (gy + 1) * cellHeight;
    for (let gx = 0; gx < result.width; gx++) {
      const sx = gx * cellWidth;
      const ex = (gx + 1) * cellWidth;
      const gridPixel = gy * result.width + gx;
      let foregroundArea = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      let secondMoment = 0;
      for (let y = Math.floor(sy); y < Math.ceil(ey); y++) {
        const overlapY = rectangleOverlap(y, y + 1, sy, ey);
        for (let x = Math.floor(sx); x < Math.ceil(ex); x++) {
          const footprint = rectangleOverlap(x, x + 1, sx, ex) * overlapY;
          if (footprint <= 0) continue;
          const sourcePixel = y * img.width + x;
          const foreground = mask?.coverage[sourcePixel] ?? (img.data[sourcePixel * 4 + 3]! / 255);
          const weight = footprint * foreground;
          if (weight <= 0) continue;
          const offset = sourcePixel * 4;
          const lr = srgbToLinear(img.data[offset]!);
          const lg = srgbToLinear(img.data[offset + 1]!);
          const lb = srgbToLinear(img.data[offset + 2]!);
          foregroundArea += weight;
          r += lr * weight;
          g += lg * weight;
          b += lb * weight;
          secondMoment += (lr * lr + lg * lg + lb * lb) * weight;
        }
      }
      result.coverage[gridPixel] = foregroundArea / cellArea;
      if (foregroundArea <= 0) continue;
      const rgb = gridPixel * 3;
      const rr = r / foregroundArea;
      const gg = g / foregroundArea;
      const bb = b / foregroundArea;
      result.linearRgb[rgb] = rr;
      result.linearRgb[rgb + 1] = gg;
      result.linearRgb[rgb + 2] = bb;
      result.variance[gridPixel] = Math.max(0, secondMoment / foregroundArea - (rr * rr + gg * gg + bb * bb));
    }
  }
}

function localBaseSrgb(area: GridSamples): Float32Array {
  const result = new Float32Array(area.linearRgb.length);
  for (let y = 0; y < area.height; y++) {
    for (let x = 0; x < area.width; x++) {
      let weight = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= area.width || ny < 0 || ny >= area.height) continue;
          const kernel = dx === 0 ? (dy === 0 ? 4 : 2) : (dy === 0 ? 2 : 1);
          const pixel = ny * area.width + nx;
          const w = kernel * area.coverage[pixel]!;
          const rgb = pixel * 3;
          weight += w;
          r += linearToSrgb(area.linearRgb[rgb]!) * w;
          g += linearToSrgb(area.linearRgb[rgb + 1]!) * w;
          b += linearToSrgb(area.linearRgb[rgb + 2]!) * w;
        }
      }
      const target = (y * area.width + x) * 3;
      if (weight > 0) {
        result[target] = r / weight;
        result[target + 1] = g / weight;
        result[target + 2] = b / weight;
      }
    }
  }
  return result;
}

function computeEdges(result: GridSamples): void {
  result.edgeX.fill(0);
  result.edgeY.fill(0);
  for (let y = 0; y < result.height; y++) {
    for (let x = 0; x < result.width; x++) {
      const pixel = y * result.width + x;
      if (x + 1 < result.width) result.edgeX[pixel] = colorDistance(result, pixel, pixel + 1);
      if (y + 1 < result.height) result.edgeY[pixel] = colorDistance(result, pixel, pixel + result.width);
    }
  }
}

function colorDistance(result: GridSamples, a: number, b: number): number {
  if (result.coverage[a]! <= 0 || result.coverage[b]! <= 0) return 0;
  const ar = a * 3;
  const br = b * 3;
  const dr = result.linearRgb[ar]! - result.linearRgb[br]!;
  const dg = result.linearRgb[ar + 1]! - result.linearRgb[br + 1]!;
  const db = result.linearRgb[ar + 2]! - result.linearRgb[br + 2]!;
  return Math.sqrt((dr * dr + dg * dg + db * db) / 3);
}

function allocateGrid(width: number, height: number): GridSamples {
  const pixels = width * height;
  return {
    width,
    height,
    linearRgb: new Float32Array(pixels * 3),
    coverage: new Float32Array(pixels),
    variance: new Float32Array(pixels),
    edgeX: new Float32Array(pixels),
    edgeY: new Float32Array(pixels),
  };
}

function rectangleOverlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function validateInputs(img: RgbaImage, width: number, height: number, mask?: ForegroundMask): void {
  requirePositiveInteger('width', width);
  requirePositiveInteger('height', height);
  if (!Number.isInteger(img.width) || img.width < 1 || !Number.isInteger(img.height) || img.height < 1) {
    throw new Error('image width/height 必须为正整数');
  }
  if (img.data.length !== img.width * img.height * 4) throw new Error('image data 长度不匹配');
  if (mask) {
    if (mask.width !== img.width || mask.height !== img.height || mask.coverage.length !== img.width * img.height) {
      throw new Error('mask 尺寸必须与 image 匹配');
    }
    for (let pixel = 0; pixel < mask.coverage.length; pixel++) {
      const coverage = mask.coverage[pixel]!;
      if (!Number.isFinite(coverage) || coverage < 0 || coverage > 1) {
        throw new Error(`mask coverage[${pixel}] 必须为 0..1 的有限数`);
      }
    }
  }
}

function validateGridSamples(samples: GridSamples): void {
  const pixels = samples.width * samples.height;
  if (samples.linearRgb.length !== pixels * 3 || samples.coverage.length !== pixels || samples.variance.length !== pixels
    || samples.edgeX.length !== pixels || samples.edgeY.length !== pixels) {
    throw new Error('GridSamples 数组长度不匹配');
  }
}

function clampByte(value: number): number {
  return Math.min(255, Math.max(0, value));
}
