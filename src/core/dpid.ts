// DPID：Rapid, Detail-Preserving Image Downscaling（保细节降采样）。
// 公共兼容包装；核心实现位于 resample.ts，使用 linear RGB、精确面积 coverage 和前景权重。

import type { RgbaImage } from './types';
import { dpidResampleToGrid, gridSamplesToRgba } from './resample';

/**
 * DPID 降采样到 gw×gh。保留旧公共签名；lambda=0 与 areaResampleToGrid 精确等价。
 */
export function dpidDownscale(
  img: RgbaImage,
  gw: number,
  gh: number,
  opts: { lambda?: number } = {},
): RgbaImage {
  return gridSamplesToRgba(dpidResampleToGrid(img, gw, gh, opts));
}
