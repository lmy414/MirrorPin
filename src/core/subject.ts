// 主体检测与裁剪：估计背景色、求主体包围盒、裁剪成方形窗口放大占满网格。

import type { RGB, RgbaImage } from './types';
import type { Oklab } from './color';
import { oklabDistance, srgbToOklab } from './color';

/** 主体包围盒（含端点） */
export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 背景估计结果：rgb 用于背景色移除，lab 用于主体判定 */
export interface BackgroundEstimate {
  rgb: RGB;
  lab: Oklab;
}

const OPAQUE = 128;
/** 四角背景采样区占边缘比例 */
const EDGE_FRAC = 0.06;
/** 像素与背景的 Oklab 距离超过此值视为主体 */
const FG_TOL = 0.12;

/**
 * 估计背景色：取四角区域像素的平均色。
 * - 四角几乎全透明 -> 判定为透明背景，返回 null
 * - 否则返回背景色（同时含 RGB 与 Oklab）
 */
export function estimateBackground(img: RgbaImage): BackgroundEstimate | null {
  const { width, height, data } = img;
  const ew = Math.max(1, Math.floor(width * EDGE_FRAC));
  const eh = Math.max(1, Math.floor(height * EDGE_FRAC));
  const corners: Array<[number, number, number, number]> = [
    [0, 0, ew, eh],
    [width - ew, 0, width, eh],
    [0, height - eh, ew, height],
    [width - ew, height - eh, width, height],
  ];
  let r = 0, g = 0, b = 0, opaque = 0, total = 0;
  for (const [x0, y0, x1, y1] of corners) {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * width + x) * 4;
        total++;
        if ((data[i + 3] as number) < OPAQUE) continue;
        r += data[i] as number;
        g += data[i + 1] as number;
        b += data[i + 2] as number;
        opaque++;
      }
    }
  }
  if (opaque === 0 || opaque / total < 0.2) return null; // 透明背景
  const rgb = { r: r / opaque, g: g / opaque, b: b / opaque };
  return { rgb, lab: srgbToOklab(rgb) };
}

/** 计算主体包围盒（稀疏扫描加速）。找不到主体返回 null */
export function computeBBox(img: RgbaImage, bg: BackgroundEstimate | null): BBox | null {
  const { width, height, data } = img;
  const step = Math.max(1, Math.floor(Math.min(width, height) / 256));
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const a = data[i + 3] as number;
      let isFg = false;
      if (bg === null) {
        isFg = a >= OPAQUE; // 透明背景：非透明即主体
      } else if (a >= OPAQUE) {
        const lab = srgbToOklab({ r: data[i] as number, g: data[i + 1] as number, b: data[i + 2] as number });
        isFg = oklabDistance(bg.lab, lab) > FG_TOL;
      }
      if (!isFg) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/**
 * 以包围盒为中心裁出方形窗口（保持原分辨率），用于占满网格。
 * @param pad 四周留边比例（0..1）：窗口边长在主体较长边的 (1+2*pad) 倍，越大主体越小、保留更多环境；默认 0 占满
 */
export function cropSquare(img: RgbaImage, bbox: BBox, pad = 0): RgbaImage {
  const { width, height, data } = img;
  const x0 = bbox.x0, y0 = bbox.y0, x1 = bbox.x1, y1 = bbox.y1;
  const bw = x1 - x0, bh = y1 - y0;
  const edge0 = Math.max(bw, bh);
  const edge = Math.round(edge0 * (1 + 2 * Math.max(0, pad)));
  const cx = Math.round((x0 + x1) / 2);
  const cy = Math.round((y0 + y1) / 2);
  let xl = cx - Math.floor(edge / 2);
  let yl = cy - Math.floor(edge / 2);
  xl = Math.max(0, Math.min(xl, width - edge));
  yl = Math.max(0, Math.min(yl, height - edge));
  const xe = Math.min(width, xl + edge);
  const ye = Math.min(height, yl + edge);
  const w = xe - xl;
  const h = ye - yl;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = ((y + yl) * width + (x + xl)) * 4;
      const di = (y * w + x) * 4;
      out[di] = data[si]!;
      out[di + 1] = data[si + 1]!;
      out[di + 2] = data[si + 2]!;
      out[di + 3] = data[si + 3]!;
    }
  }
  return { width: w, height: h, data: out };
}