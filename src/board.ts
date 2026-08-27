// 前端顶层 API：一次设置一次导出，高级设置默认折叠。
// - 用户选：图片、板规、色卡、稀有色阈值、是否抠白底（其余底层参数内部固化）
// - 高级（折叠）：平滑/降采样/限色/抖动/阈值/渲染像素值

import type { RgbaImage, Grid } from './core/types';
import { generatePatternBead, type SmoothKind, type ScaleKind } from './beadpattern/core';
import { MARD291, MARD221 } from './palettes/mard291';

export type BoardSpec = '52x52' | '78x78' | '104x104' | '78x52';
export type PaletteId = 'mard291' | 'mard221';

export const BOARD_PRESETS: Record<BoardSpec, { w: number; h: number; label: string }> = {
  '52x52': { w: 52, h: 52, label: '52×52' },
  '78x78': { w: 78, h: 78, label: '78×78（单板）' },
  '104x104': { w: 104, h: 104, label: '104×104（双板）' },
  '78x52': { w: 78, h: 52, label: '78×52（非标）' },
};

export interface AdvancedOptions {
  /** 保边平滑，默认 'l0' */
  smooth?: SmoothKind;
  /** L0 的 λ，默认 0.02（l0soft=0.005） */
  smoothLambda?: number;
  /** gauss 的 σ，默认 1 */
  smoothSigma?: number;
  /** 引导滤波窗口半径，默认 8 */
  smoothRadius?: number;
  /** 引导滤波正则，默认 100 */
  smoothEps?: number;
  /** 降采样，默认 'dpid' */
  scale?: ScaleKind;
  /** DPID 的 λ，默认 1.0（0 退化为 box） */
  dpidLambda?: number;
  /** 限色上限（不暴露限色时为 undefined），仅在同时有明确 UI 时使用 */
  maxColors?: number;
  /** 是否抖动，默认 false */
  dither?: boolean;
  /** 是否去杂点（despeckle, 阈值<2格），默认 false */
  despeckle?: boolean;
  /** flood 去背景 CIEDE2000 阈值，默认 12 */
  backgroundTolerance?: number;
  /** 渲染：每格像素，默认 40 */
  renderCell?: number;
  /** 渲染：板界周期，默认 29 */
  renderBoard?: number;
}

export interface TopLevelOptions {
  /** 板子规格，必填 */
  board: BoardSpec;
  /** 色卡，默认 mard221（标准色） */
  palette?: PaletteId;
  /** 稀有色合并阈值（用量 < minBeads 的色号并入邻近色），默认 0=不合并，前端可暴露为“无/5/10”三档 */
  minBeads?: number;
  /** 是否网格级抠白底（flood），默认 false */
  removeBg?: boolean;
  /** 主体透明裁剪，默认 true（前端不暴露） */
  cropToSubject?: boolean;
  /** 高级设置（默认折叠，置空则取内部最优默认） */
  advanced?: AdvancedOptions;
}

export interface GenerateResult {
  /** 内存网格（渲染与清单均由此派生） */
  grid: Grid;
  mode: 'cropped-and-filled' | 'auto-fit';
}

/** 顶层生成：一次设置一次导出，高级设置默认折叠。 */
export function generateForBoard(img: RgbaImage, opts: TopLevelOptions): GenerateResult {
  const spec = BOARD_PRESETS[opts.board];
  if (!spec) throw new Error(`未知板规: ${opts.board}`);
  const palette = opts.palette === 'mard291' ? MARD291 : MARD221;
  const a = opts.advanced;
  const grid = generatePatternBead(img, {
    fixed: { w: spec.w, h: spec.h },
    fill: true,
    cropToSubject: opts.cropToSubject ?? true,
    palette,
    minBeads: opts.minBeads ?? 0,
    smooth: a?.smooth ?? 'l0',
    smoothLambda: a?.smoothLambda ?? 0.02,
    smoothSigma: a?.smoothSigma ?? 1,
    smoothRadius: a?.smoothRadius ?? 8,
    smoothEps: a?.smoothEps ?? 100,
    scale: a?.scale ?? 'dpid',
    dpidLambda: a?.dpidLambda ?? 1.0,
    maxColors: a?.maxColors,
    dither: a?.dither ?? false,
    despeckle: a?.despeckle ?? false,
    backgroundTolerance: a?.backgroundTolerance ?? 12,
    removeBg: opts.removeBg ? 'flood' : 'none',
  });

  const ok = grid.cols === spec.w && grid.rows === spec.h;
  return { grid, mode: ok ? 'cropped-and-filled' : 'auto-fit' };
}
