// 算法管线编排：位图 → 图纸网格（采样 → 匹配 → 合并 → 去背景）。

import type { Cell, Grid, RgbaImage, Swatch } from './types';
import { sampleGrid, type SampleMode } from './grid';
import { buildPalette, nearestSwatch } from './palette';
import { mergeRegions, removeBackground } from './post';
import { boxBlur } from './preprocess';
import { MARD291 } from '../palettes/mard291';
import { computeBBox, cropSquare, estimateBackground } from './subject';

export interface GenerateOptions {
  /** 拼豆色板，默认 MARD291 */
  palette?: readonly Swatch[];
  /** 图纸列数（与行数一致即方形底板；默认 rows = cols） */
  cols: number;
  rows?: number;
  /** 每格代表色采样方式，默认 dominant */
  sample?: SampleMode;
  /** 区域合并阈值（Oklab 距离 0..1），默认 0.08；越小越少合并 */
  mergeThreshold?: number;
  /** 是否移除边界连通近白背景，默认 true */
  removeBackground?: boolean;
  /** 背景判定 tolerance（到纯白的 Oklab 距离），默认 0.1 */
  backgroundTolerance?: number;
}

const DEFAULTS = {
  mergeThreshold: 0.08,
  backgroundTolerance: 0.1,
  removeBackground: true,
  sample: 'dominant' as SampleMode,
};

/** 由位图生成拼豆图纸网格（内存模型，不含文件导出） */
export function generatePattern(img: RgbaImage, options: GenerateOptions): Grid {
  const palette = options.palette ?? (MARD291 as readonly Swatch[]);
  const rows = options.rows ?? options.cols;
  const sample = options.sample ?? DEFAULTS.sample;
  const mergeT = options.mergeThreshold ?? DEFAULTS.mergeThreshold;
  const removeBg = options.removeBackground ?? DEFAULTS.removeBackground;
  const bgTol = options.backgroundTolerance ?? DEFAULTS.backgroundTolerance;

  // 1. 采样每格代表色
  const sampled = sampleGrid(img, options.cols, rows, sample);

  // 2. 构建色板并逐格最近邻匹配
  const entries = buildPalette(palette);
  const cells: Cell[][] = sampled.map((row) =>
    row.map((rgb) => {
      const swatch = nearestSwatch(rgb, entries);
      return { code: swatch.code, hex: swatch.hex, external: false };
    }),
  );

  // 3. 区域合并除杂色
  let result = mergeRegions(cells, mergeT);

  // 4. 移除边界连通背景
  if (removeBg) {
    result = removeBackground(result, bgTol);
  }

  const colorSet = new Set<string>();
  for (const row of result) {
    for (const cell of row) {
      if (!cell.external) colorSet.add(cell.code);
    }
  }

  return { rows, cols: options.cols, cells: result, colorCount: colorSet.size };
}

export interface MapFirstOptions {
  /** 拼豆色板，默认 MARD291 */
  palette?: readonly Swatch[];
  cols: number;
  rows?: number;
}

/**
 * 思路一：先做色调映射（全分辨率逐像素映射到最近色号），再做像素化
 * （每格取格内众数色号）。与 generatePattern（先采样后匹配）对比顺序差异。
 * 为隔离顺序本身，本函数不做区域合并，也不做背景移除。
 */
export function generatePatternMapFirst(img: RgbaImage, options: MapFirstOptions): Grid {
  const palette = options.palette ?? (MARD291 as readonly Swatch[]);
  const rows = options.rows ?? options.cols;
  if (!(options.cols > 0) || !(rows > 0)) {
    throw new Error('cols/rows 必须为正整数');
  }
  const { width, height, data } = img;
  const entries = buildPalette(palette);
  const hexByCode = new Map(palette.map((s) => [s.code, s.hex]));
  const cellW = width / options.cols;
  const cellH = height / rows;

  // 每个格子维护 色号→计数 的频次表
  const cellMaps: Array<Array<Map<string, number>>> = Array.from({ length: rows }, () =>
    Array.from({ length: options.cols }, () => new Map<string, number>()),
  );

  // 像素颜色(降位采样) → 已算好的色号，避免对每个像素重复做 O(M×色板) 匹配
  const swatchCache = new Map<number, string>();

  for (let py = 0; py < height; py++) {
    let idx = py * width * 4;
    const gy = Math.min(rows - 1, Math.floor((py + 0.5) / cellH));
    for (let px = 0; px < width; px++, idx += 4) {
      if ((data[idx + 3] as number) < 128) continue;
      const key = ((data[idx] as number) >> 3) << 10 | (((data[idx + 1] as number) >> 3) << 5) | ((data[idx + 2] as number) >> 3);
      let code = swatchCache.get(key);
      if (code === undefined) {
        const swatch = nearestSwatch(
          { r: data[idx] as number, g: data[idx + 1] as number, b: data[idx + 2] as number },
          entries,
        );
        code = swatch.code;
        swatchCache.set(key, code);
      }
      const gx = Math.min(options.cols - 1, Math.floor((px + 0.5) / cellW));
      const m = cellMaps[gy]![gx]!;
      m.set(code, (m.get(code) ?? 0) + 1);
    }
  }

  const cells: Cell[][] = cellMaps.map((row) =>
    row.map((freq) => {
      let top: string | undefined;
      let topCount = -1;
      for (const [code, n] of freq) {
        if (n > topCount) {
          topCount = n;
          top = code;
        }
      }
      const code = top ?? palette[0]!.code;
      return { code, hex: hexByCode.get(code) ?? palette[0]!.hex, external: false };
    }),
  );

  const colorSet = new Set<string>();
  for (const row of cells) for (const cell of row) if (!cell.external) colorSet.add(cell.code);

  return { rows, cols: options.cols, cells, colorCount: colorSet.size };
}

export interface AdvancedOptions {
  /** 拼豆色板，默认 MARD291 */
  palette?: readonly Swatch[];
  cols: number;
  rows?: number;
  /** 每格代表色采样方式，默认 kmeans（算法6） */
  sample?: SampleMode;
  /** 是否先把主体裁剪为方形窗口放大占满网格，默认 true */
  cropToSubject?: boolean;
  /** 区域合并阈值（Oklab 距离 0..1），默认 0.08 */
  mergeThreshold?: number;
  /** 是否移除动态估计的连通背景，默认 true */
  removeBackground?: boolean;
  /** 背景判定 tolerance（到估计背景色的 Oklab 距离），默认 0.12 */
  backgroundTolerance?: number;
}

/**
 * 进阶管线（算法6 落地 + 主体占满 + 智能背景）：
 * 1. 估计背景色 -> 求主体包围盒 -> 裁成方形窗口占满网格（若开启）
 * 2. 用 kmeans 采样取每格主簇色 -> 匹配色板
 * 3. 区域合并除杂
 * 4. 用估计的真实背景色做边界连通移除（而非固定的近白）
 */
export function generatePatternAdvanced(img: RgbaImage, options: AdvancedOptions): Grid {
  const palette = options.palette ?? (MARD291 as readonly Swatch[]);
  const rows = options.rows ?? options.cols;
  const sample = options.sample ?? 'kmeans';
  const crop = options.cropToSubject ?? true;
  const mergeT = options.mergeThreshold ?? 0.08;
  const removeBg = options.removeBackground ?? true;
  const bgTol = options.backgroundTolerance ?? 0.12;

  const bgEstimate = estimateBackground(img);

  // 1. 主体裁剪占满（动态定位包围盒；透明背景仍按不透明主体求框）
  let source = img;
  if (crop) {
    const bbox = computeBBox(img, bgEstimate);
    if (bbox) source = cropSquare(img, bbox);
  }

  // 2. 采样 + 匹配
  const sampled = sampleGrid(source, options.cols, rows, sample);
  const entries = buildPalette(palette);
  const cells: Cell[][] = sampled.map((row) =>
    row.map((rgb) => {
      const swatch = nearestSwatch(rgb, entries);
      return { code: swatch.code, hex: swatch.hex, external: false };
    }),
  );

  // 3. 背景处理：透明背景按不透明占比剔除空格；有色背景按动态背景色 flood fill
  let result = cells;
  if (removeBg) {
    if (bgEstimate) {
      result = removeBackground(cells, bgTol, bgEstimate.rgb);
    } else {
      result = maskTransparent(source, cells, options.cols, rows, 0.5);
    }
  }

  // 4. 区域合并除杂（跳过已标 external 的格）
  result = mergeRegions(result, mergeT);

  const colorSet = new Set<string>();
  for (const row of result) {
    for (const cell of row) {
      if (!cell.external) colorSet.add(cell.code);
    }
  }

  return { rows, cols: options.cols, cells: result, colorCount: colorSet.size };
}

/**
 * 透明背景剔除：按每个网格格内的不透明像素占比判定空格，
 * 占比低于 minOpaqueRatio 的格子标为 external（透明背景无法用颜色 flood fill 处理）。
 */
function maskTransparent(
  source: RgbaImage,
  cells: Cell[][],
  cols: number,
  rows: number,
  minOpaqueRatio: number,
): Cell[][] {
  const { width, height, data } = source;
  const cellW = width / cols;
  const cellH = height / rows;
  const out = cells.map((r) => r.map((c) => ({ ...c })));
  for (let gy = 0; gy < rows; gy++) {
    const y0 = Math.floor(gy * cellH);
    const y1 = Math.max(y0 + 1, Math.min(height, Math.floor((gy + 1) * cellH)));
    for (let gx = 0; gx < cols; gx++) {
      const x0 = Math.floor(gx * cellW);
      const x1 = Math.max(x0 + 1, Math.min(width, Math.floor((gx + 1) * cellW)));
      let opaque = 0;
      let total = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4;
          total++;
          if ((data[i + 3] as number) >= 128) opaque++;
        }
      }
      const ratio = total > 0 ? opaque / total : 0;
      out[gy]![gx]!.external = ratio < minOpaqueRatio;
    }
  }
  return out;
}

export interface SoftOptions {
  palette?: readonly Swatch[];
  cols: number;
  rows?: number;
  /** 映射像素化前的全图模糊半径（像素），默认 6（实测降杂色/收敛主色较好） */
  blurRadius?: number;
  /** 是否先把主体裁剪占满网格，默认 true */
  cropToSubject?: boolean;
  /** 区域合并阈值（Oklab 距离 0..1），默认 0.08 */
  mergeThreshold?: number;
  removeBackground?: boolean;
  backgroundTolerance?: number;
}

/**
 * 用户确认的管线顺序：全图模糊(降杂色) -> 色卡映射 -> 像素化(格内众数)。
 * 组合了主体裁剪占满与智能背景（透明/有色）。
 */
export function generatePatternSoft(img: RgbaImage, options: SoftOptions): Grid {
  const palette = options.palette ?? (MARD291 as readonly Swatch[]);
  const rows = options.rows ?? options.cols;
  const blur = options.blurRadius ?? 6;
  const crop = options.cropToSubject ?? true;
  const mergeT = options.mergeThreshold ?? 0.08;
  const removeBg = options.removeBackground ?? true;
  const bgTol = options.backgroundTolerance ?? 0.12;

  const bgEstimate = estimateBackground(img);

  // 1. 主体裁剪占满
  let source = img;
  if (crop) {
    const bbox = computeBBox(img, bgEstimate);
    if (bbox) source = cropSquare(img, bbox);
  }

  // 2. 全图模糊降杂色
  if (blur > 0) source = boxBlur(source, blur);

  // 3. 色卡映射(全分辨率逐像素) -> 像素化(格内众数)
  let cells = mapPerPixelToMode(source, options.cols, rows, palette);

  // 4. 智能背景（透明/有色）
  if (removeBg) {
    if (bgEstimate) cells = removeBackground(cells, bgTol, bgEstimate.rgb);
    else cells = maskTransparent(source, cells, options.cols, rows, 0.5);
  }

  // 5. 区域合并除杂
  const result = mergeRegions(cells, mergeT);

  const colorSet = new Set<string>();
  for (const row of result) for (const cell of row) if (!cell.external) colorSet.add(cell.code);
  return { rows, cols: options.cols, cells: result, colorCount: colorSet.size };
}

/** 全分辨率逐像素映射色卡（按颜色降位桶缓存），再每格取众数色号 */
function mapPerPixelToMode(img: RgbaImage, cols: number, rows: number, palette: readonly Swatch[]): Cell[][] {
  const { width, height, data } = img;
  const entries = buildPalette(palette);
  const hexByCode = new Map(palette.map((s) => [s.code, s.hex]));
  const cellW = width / cols;
  const cellH = height / rows;
  const cellMaps: Array<Array<Map<string, number>>> = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => new Map<string, number>()),
  );
  const cache = new Map<number, string>();
  for (let py = 0; py < height; py++) {
    const gy = Math.min(rows - 1, Math.floor((py + 0.5) / cellH));
    for (let px = 0; px < width; px++) {
      const i = (py * width + px) * 4;
      if ((data[i + 3] as number) < 128) continue;
      const key = (((data[i] as number) >> 3) << 10) | (((data[i + 1] as number) >> 3) << 5) | ((data[i + 2] as number) >> 3);
      let code = cache.get(key);
      if (code === undefined) {
        const swatch = nearestSwatch({ r: data[i] as number, g: data[i + 1] as number, b: data[i + 2] as number }, entries);
        code = swatch.code;
        cache.set(key, code);
      }
      const gx = Math.min(cols - 1, Math.floor((px + 0.5) / cellW));
      const m = cellMaps[gy]![gx]!;
      m.set(code, (m.get(code) ?? 0) + 1);
    }
  }
  return cellMaps.map((row) =>
    row.map((freq) => {
      let top: string | undefined;
      let topN = -1;
      for (const [code, n] of freq) if (n > topN) { topN = n; top = code; }
      const code = top ?? palette[0]!.code;
      return { code, hex: hexByCode.get(code) ?? palette[0]!.hex, external: false };
    }),
  );
}