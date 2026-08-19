// 色彩空间：sRGB → Oklab 转换与感知色差
// Oklab 比 RGB 欧氏距离更贴近人眼，用于拼豆色号匹配可显著减少可见色差。

import type { RGB } from './types';

export interface Oklab {
  l: number;
  a: number;
  b: number;
}

/** sRGB 分量（0..255）非线性解码为线性值 */
function linearize(v: number): number {
  const n = v / 255;
  return n <= 0.04045 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
}

/** sRGB → Oklab（Björn Ottosson 经典系数） */
export function srgbToOklab(c: RGB): Oklab {
  const r = linearize(c.r);
  const g = linearize(c.g);
  const b = linearize(c.b);

  // 线性 sRGB → LMS
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const lr = Math.cbrt(l);
  const mr = Math.cbrt(m);
  const sr = Math.cbrt(s);

  return {
    l: 0.2104542553 * lr + 0.793617785 * mr - 0.0040720468 * sr,
    a: 1.9779984951 * lr - 2.428592205 * mr + 0.4505937099 * sr,
    b: 0.0259040371 * lr + 0.7827717662 * mr - 0.808675766 * sr,
  };
}

/** Oklab 感知色差（欧氏距离，量级约 0..1）；纯白与纯黑约 1.0 */
export function oklabDistance(x: Oklab, y: Oklab): number {
  return Math.hypot(x.l - y.l, x.a - y.a, x.b - y.b);
}

/** 十六进制（可为 "F9F0CD" 或 "#F9F0CD"，大小写均可）→ RGB，非法输入抛错 */
export function hexToRgb(hex: string): RGB {
  const h = hex.replace(/^#/, '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(h)) {
    throw new Error(`非法 HEX 色值: ${hex}`);
  }
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** RGB → 十六进制（不含 #，全大写） */
export function rgbToHex({ r, g, b }: RGB): string {
  const to = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `${to(r)}${to(g)}${to(b)}`.toUpperCase();
}