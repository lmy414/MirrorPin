// 色卡最近邻匹配：在 Oklab 空间找感知最接近的拼豆色号。

import type { RGB, Swatch } from './types';
import { hexToRgb, oklabDistance, srgbToOklab, type Oklab } from './color';

/** 预计算过的单个色板条目 */
export interface PaletteEntry {
  swatch: Swatch;
  rgb: RGB;
  lab: Oklab;
}

/** Validate and canonicalize swatches once before any index-bearing pipeline stage. */
export function normalizeSwatches(palette: readonly Swatch[]): Swatch[] {
  const result: Swatch[] = [];
  const codes = new Set<string>();
  for (const swatch of palette) {
    if (!swatch || typeof swatch.code !== 'string' || swatch.code.length === 0 || typeof swatch.hex !== 'string') continue;
    try {
      hexToRgb(swatch.hex);
    } catch {
      continue;
    }
    if (codes.has(swatch.code)) continue;
    codes.add(swatch.code);
    result.push({ code: swatch.code, hex: swatch.hex.replace(/^#/, '').trim().toUpperCase() });
  }
  return result;
}

/** 预先构建色板（缓存 Oklab，避免每次匹配重复转换） */
export function buildPalette(palette: readonly Swatch[]): PaletteEntry[] {
  return normalizeSwatches(palette).map((swatch) => {
    const rgb = hexToRgb(swatch.hex);
    return { swatch, rgb, lab: srgbToOklab(rgb) };
  });
}

/** 返回色板中与 target 感知最接近的色号 */
export function nearestSwatch(target: RGB, entries: readonly PaletteEntry[]): Swatch {
  const first = entries[0];
  if (!first) throw new Error('色板不能为空');
  const t = srgbToOklab(target);
  let best = first;
  let bestDist = Infinity;
  for (const e of entries) {
    const d = oklabDistance(t, e.lab);
    if (d < bestDist) {
      bestDist = d;
      best = e;
    }
    if (d === 0) break;
  }
  return best.swatch;
}