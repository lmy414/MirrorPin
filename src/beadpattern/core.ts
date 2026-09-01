// 转像素核心：source ForegroundMask → mask-aware crop/extension/smooth →
// 一次 area/DPID resample → top-K CIEDE2000 → spatial optimize/cleanup。
// clean 默认统一为 guided+area+spatial；smooth 只影响 RGB，alpha/final mask 不变。
// 组件与生成器一一对应：crop_to_subject / crop_to_aspect / to_grid(Image.BOX)
//   / flood_remove_bg / match_direct / match_dither / despeckle / limit_colors。

import type { ColorQuantizeOptions, RgbaImage, Grid, Swatch } from '../core/types';
import { ciede2000, srgbToLab, type Lab } from './ciede2000';
import { MARD291 } from '../palettes/mard291';
import { l0Smooth } from '../core/l0';
import { guidedSmooth } from '../core/guided';
import { gaussianBlur } from '../core/preprocess';
import { applyMaskForSmoothing } from '../core/smoothing';
import { extendMaskedRgb } from '../core/background';
import {
  buildForegroundMask,
  cropImageAndMaskToAspect,
  cropImageAndMaskToSubject,
  type ForegroundMask,
} from '../core/background';
import {
  areaResampleToGrid,
  dpidResampleToGrid,
  fitResampleToGrid,
  gridSamplesToRgba,
  type GridSamples,
} from '../core/resample';
import { quantizeImage } from '../core/color-quantize';
import { normalizeSwatches } from '../core/palette';
import { buildPaletteCandidates } from '../core/palette-candidates';
import { optimizeSpatialLabels } from '../core/spatial-quantize';
import { cleanupSpatialLabels, enforceSpatialColorBudget, computeSpatialLabelEnergy, createOperationBudget } from '../core/label-regions';
import { DEFAULT_GENERATION_OPTIONS, GENERATION_PROFILES, resolveSpatialQuantizeOptions } from '../core/options';
import { measureSpatialFragmentation } from '../core/quantize';
import type { PipelineDiagnostics } from '../core/types';

/** 保边平滑算法（转像素前应用） */
export type SmoothKind = 'none' | 'gauss' | 'guided' | 'l0';
/** 降采样算法 */
export type ScaleKind = 'box' | 'area' | 'dpid';

// ---------------------------------------------------------------------------
// 内部表示：网格 = 扁平 RGBA(gw*gh*4)；色卡 = codes/hexes/rgb(0..255)/lab
// ---------------------------------------------------------------------------

interface BeadPalette {
  codes: string[];
  hexes: string[];
  rgb: number[][]; // N×3
  lab: Lab[];
}

export function buildBeadPalette(swatches: readonly Swatch[]): BeadPalette {
  const canonical = normalizeSwatches(swatches);
  const codes: string[] = [];
  const hexes: string[] = [];
  const rgb: number[][] = [];
  const lab: Lab[] = [];
  for (const s of canonical) {
    const r = parseInt(s.hex.slice(0, 2), 16);
    const g = parseInt(s.hex.slice(2, 4), 16);
    const b = parseInt(s.hex.slice(4, 6), 16);
    codes.push(s.code);
    hexes.push(s.hex);
    rgb.push([r, g, b]);
    lab.push(srgbToLab({ r, g, b }));
  }
  return { codes, hexes, rgb, lab };
}

// ---------------------------------------------------------------------------
// 裁剪：crop_to_subject + crop_to_aspect
// ---------------------------------------------------------------------------

/** 裁到不透明主体(alpha>128)的外接框，丢掉四周留白 */
export function cropToSubject(img: RgbaImage, pad = 0): RgbaImage {
  const { width, height, data } = img;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let i = 0; i < width * height; i++) {
    if ((data[i * 4 + 3] as number) < 128) continue;
    const x = i % width;
    const y = (i - x) / width;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (x1 < 0) return img;
  x0 = Math.max(x0 - pad, 0);
  y0 = Math.max(y0 - pad, 0);
  x1 = Math.min(x1 + 1 + pad, width);
  y1 = Math.min(y1 + 1 + pad, height);
  return cropRect(img, x0, y0, x1, y1);
}

/** 按目标 gw:gh 比例中心裁剪（中心取主体外接框中心），用于 fit 铺满整板 */
export function cropToAspectAligned(img: RgbaImage, gw: number, gh: number): RgbaImage {
  const { width, height, data } = img;
  const target = gw / gh;
  const cur = width / height;
  if (Math.abs(target - cur) < 1e-6) return img;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let i = 0; i < width * height; i++) {
    if ((data[i * 4 + 3] as number) < 128) continue;
    const x = i % width;
    const y = (i - x) / width;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const cx = maxX >= 0 ? (minX + maxX) / 2 : width / 2;
  const cy = maxY >= 0 ? (minY + maxY) / 2 : height / 2;
  let nw: number, nh: number;
  if (target > cur) {
    // 目标更宽 -> 裁高度
    nw = width;
    nh = Math.round(width / target);
  } else {
    nw = Math.round(height * target);
    nh = height;
  }
  const x0 = Math.round(Math.min(Math.max(cx - nw / 2, 0), width - nw));
  const y0 = Math.round(Math.min(Math.max(cy - nh / 2, 0), height - nh));
  return cropRect(img, x0, y0, x0 + nw, y0 + nh);
}

function cropRect(img: RgbaImage, x0: number, y0: number, x1: number, y1: number): RgbaImage {
  const { width, height, data } = img;
  x0 = Math.max(0, x0);
  y0 = Math.max(0, y0);
  x1 = Math.min(width, x1);
  y1 = Math.min(height, y1);
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = ((y + y0) * width + (x + x0)) * 4;
      const di = (y * w + x) * 4;
      out[di] = data[si]!;
      out[di + 1] = data[si + 1]!;
      out[di + 2] = data[si + 2]!;
      out[di + 3] = data[si + 3]!;
    }
  }
  return { width: w, height: h, data: out };
}

// ---------------------------------------------------------------------------
// to_grid：Image.BOX（区域平均）降采样
// ---------------------------------------------------------------------------

export interface GridRgba {
  gw: number;
  gh: number;
  data: Uint8ClampedArray; // gw*gh*4，RGBA 每格
}

/** fit=true 保持比例居中补透明；false 直接按精确 footprint 缩到 gw×gh。 */
export function toGrid(img: RgbaImage, gw: number, gh: number, fit: boolean): GridRgba {
  const mask = buildForegroundMask(img, { mode: 'none' });
  const samples = fit
    ? fitResampleToGrid(img, gw, gh, 'area', { mask })
    : areaResampleToGrid(img, gw, gh, { mask });
  return { gw, gh, data: gridSamplesToRgba(samples).data };
}

// ---------------------------------------------------------------------------
// 历史兼容：网格级 CIEDE2000 去背景（主管线已改为源图 ForegroundMask，不再调用）
// ---------------------------------------------------------------------------

/** 返回更新后的 alpha：与边界连通且 CIEDE2000 <= tol 的格子置 0 */
export function floodRemoveBg(grid: GridRgba, tol = 12): Uint8ClampedArray {
  const { gw, gh, data } = grid;
  const out = new Uint8ClampedArray(data);
  // 边界种子平均色
  const border: number[] = [];
  for (let x = 0; x < gw; x++) {
    border.push(out[x * 4]!, out[x * 4 + 1]!, out[x * 4 + 2]!);
    const i = (gh - 1) * gw + x;
    border.push(out[i * 4]!, out[i * 4 + 1]!, out[i * 4 + 2]!);
  }
  for (let y = 0; y < gh; y++) {
    const i = y * gw;
    border.push(out[i * 4]!, out[i * 4 + 1]!, out[i * 4 + 2]!);
    const j = y * gw + (gw - 1);
    border.push(out[j * 4]!, out[j * 4 + 1]!, out[j * 4 + 2]!);
  }
  let sr = 0, sg = 0, sb = 0;
  for (let i = 0; i < border.length; i += 3) {
    sr += border[i]!;
    sg += border[i + 1]!;
    sb += border[i + 2]!;
  }
  const n = border.length / 3 || 1;
  const seed = srgbToLab({ r: sr / n, g: sg / n, b: sb / n });

  const similar = new Uint8Array(gw * gh);
  const visited = new Uint8Array(gw * gh);
  for (let i = 0; i < gw * gh; i++) {
    const lab = srgbToLab({ r: data[i * 4]!, g: data[i * 4 + 1]!, b: data[i * 4 + 2]! });
    similar[i] = ciede2000(seed, lab) <= tol ? 1 : 0;
  }
  const q: number[] = [];
  for (let x = 0; x < gw; x++) {
    for (const y of [0, gh - 1]) {
      const i = y * gw + x;
      if (similar[i] && !visited[i]) {
        visited[i] = 1;
        q.push(i);
      }
    }
  }
  for (let y = 0; y < gh; y++) {
    for (const x of [0, gw - 1]) {
      const i = y * gw + x;
      if (similar[i] && !visited[i]) {
        visited[i] = 1;
        q.push(i);
      }
    }
  }
  const dx = [1, -1, 0, 0];
  const dy = [0, 0, 1, -1];
  for (let head = 0; head < q.length; head++) {
    const cur = q[head]!;
    const cx = cur % gw;
    const cy = (cur - cx) / gw;
    for (let k = 0; k < 4; k++) {
      const nx = cx + dx[k]!;
      const ny = cy + dy[k]!;
      if (nx < 0 || nx >= gw || ny < 0 || ny >= gh) continue;
      const ni = ny * gw + nx;
      if (visited[ni] || !similar[ni]) continue;
      visited[ni] = 1;
      q.push(ni);
    }
  }
  for (let i = 0; i < q.length; i++) {
    const f = q[i]! * 4;
    out[f] = 0;
    out[f + 1] = 0;
    out[f + 2] = 0;
    out[f + 3] = 0;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 色卡匹配：match_direct / match_dither
// ---------------------------------------------------------------------------

/** 直接 CIEDE2000 最近色号。返回 idx 网格(-1=空) */
export function matchDirectData(grid: GridRgba, alpha: Uint8ClampedArray, palette: BeadPalette): Int32Array {
  const { gw, gh, data } = grid;
  const idx = new Int32Array(gw * gh).fill(-1);
  for (let i = 0; i < gw * gh; i++) {
    if ((alpha[i * 4 + 3] as number) < 128) continue;
    idx[i] = nearestIndex({ r: data[i * 4]!, g: data[i * 4 + 1]!, b: data[i * 4 + 2]! }, palette);
  }
  return idx;
}

/** Floyd–Steinberg 抖动 + CIEDE2000（默认关闭，照片渐变用） */
export function matchDitherData(grid: GridRgba, alpha: Uint8ClampedArray, palette: BeadPalette): Int32Array {
  const { gw, gh, data } = grid;
  const work = new Float64Array(data); // 复制 RGB(A)
  const idx = new Int32Array(gw * gh).fill(-1);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = (y * gw + x) * 4;
      if ((alpha[i + 3] as number) < 128) continue;
      const old = { r: work[i]!, g: work[i + 1]!, b: work[i + 2]! };
      const k = nearestIndex(old, palette);
      idx[y * gw + x] = k;
      const err = [old.r - palette.rgb[k]![0]!, old.g - palette.rgb[k]![1]!, old.b - palette.rgb[k]![2]!];
      const spreads: Array<[number, number, number]> = [
        [x + 1, y, 7 / 16],
        [x - 1, y + 1, 3 / 16],
        [x, y + 1, 5 / 16],
        [x + 1, y + 1, 1 / 16],
      ];
      for (const [nx, ny, w] of spreads) {
        if (nx < 0 || nx >= gw || ny < 0 || ny >= gh) continue;
        const ni = (ny * gw + nx) * 4;
        if ((alpha[ni + 3] as number) < 128) continue;
        work[ni] = Math.min(255, Math.max(0, work[ni]! + err[0]! * w));
        work[ni + 1] = Math.min(255, Math.max(0, work[ni + 1]! + err[1]! * w));
        work[ni + 2] = Math.min(255, Math.max(0, work[ni + 2]! + err[2]! * w));
      }
    }
  }
  return idx;
}

function nearestIndex(rgb: { r: number; g: number; b: number }, palette: BeadPalette): number {
  const t = srgbToLab(rgb);
  let best = 0;
  let bestD = Infinity;
  for (let k = 0; k < palette.lab.length; k++) {
    const d = ciede2000(t, palette.lab[k]!);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// 后处理：despeckle + limit_colors
// ---------------------------------------------------------------------------

/** 把面积 < min_region 的同色连通块并入相邻多数色，清理杂点 */
export function despeckle(idx: Int32Array, gw: number, gh: number, minRegion = 2): Int32Array {
  const out = new Int32Array(idx);
  const seen = new Uint8Array(gw * gh);
  const dx = [1, -1, 0, 0];
  const dy = [0, 0, 1, -1];
  for (let y0 = 0; y0 < gh; y0++) {
    for (let x0 = 0; x0 < gw; x0++) {
      const seed = y0 * gw + x0;
      if (seen[seed] || out[seed]! < 0) continue;
      const color = out[seed]!;
      const comp: number[] = [];
      const q = [seed];
      seen[seed] = 1;
      while (q.length) {
        const cur = q.pop()!;
        comp.push(cur);
        const cx = cur % gw;
        const cy = (cur - cx) / gw;
        for (let k = 0; k < 4; k++) {
          const nx = cx + dx[k]!;
          const ny = cy + dy[k]!;
          if (nx < 0 || nx >= gw || ny < 0 || ny >= gh) continue;
          const ni = ny * gw + nx;
          if (seen[ni] || out[ni] !== color) continue;
          seen[ni] = 1;
          q.push(ni);
        }
      }
      if (comp.length >= minRegion) continue;
      const neigh = new Map<number, number>();
      for (const c0 of comp) {
        const cx = c0 % gw;
        const cy = (c0 - cx) / gw;
        for (let k = 0; k < 4; k++) {
          const nx = cx + dx[k]!;
          const ny = cy + dy[k]!;
          if (nx < 0 || nx >= gw || ny < 0 || ny >= gh) continue;
          const ni = ny * gw + nx;
          const val = out[ni]!;
          if (val >= 0 && val !== color) {
            neigh.set(val, (neigh.get(val) ?? 0) + 1);
          }
        }
      }
      let repl = -1;
      let max = 0;
      for (const [v, c] of neigh) {
        if (c > max) {
          max = c;
          repl = v;
        }
      }
      if (repl >= 0) {
        for (const c0 of comp) out[c0] = repl;
      }
    }
  }
  return out;
}

/** 迭代把用量最少的色号并入色卡中最接近的保留色，直到色数 <= maxColors */
export function limitColorsIdx(idx: Int32Array, palette: BeadPalette, maxColors: number): Int32Array {
  const out = new Int32Array(idx);
  const counts = new Map<number, number>();
  for (let v of out) {
    if (v < 0) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  while (counts.size > maxColors) {
    let victim = -1;
    let vCount = Infinity;
    for (const [v, c] of counts) {
      if (c < vCount) {
        vCount = c;
        victim = v;
      }
    }
    if (victim < 0) break;
    const others = [...counts.keys()].filter((c) => c !== victim);
    let repl = others[0]!;
    let bestD = Infinity;
    const vlab = palette.lab[victim]!;
    for (const o of others) {
      const d = ciede2000(vlab, palette.lab[o]!);
      if (d < bestD) {
        bestD = d;
        repl = o;
      }
    }
    for (let i = 0; i < out.length; i++) {
      if (out[i] === victim) out[i] = repl;
    }
    counts.set(repl, (counts.get(repl) ?? 0) + (counts.get(victim) ?? 0));
    counts.delete(victim);
  }
  return out;
}

/**
 * 稀有色合并：把用量 < minBeads 的色号并入 CIEDE2000 最近的在用色。
 * 每轮取当前用量最少的色合并（目标吸收用量后可能脱离稀有区间），
 * 级联直到所有在用色达标或只剩一色。minBeads<=1 时原样返回。
 */
export function mergeRareIdx(idx: Int32Array, palette: BeadPalette, minBeads: number): Int32Array {
  if (minBeads <= 1) return idx;
  const out = new Int32Array(idx);
  const counts = new Map<number, number>();
  for (const v of out) {
    if (v < 0) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  for (;;) {
    let victim = -1;
    let vCount = Infinity;
    for (const [v, c] of counts) {
      if (c < vCount) {
        vCount = c;
        victim = v;
      }
    }
    if (victim < 0 || vCount >= minBeads || counts.size <= 1) break;
    const others = [...counts.keys()].filter((c) => c !== victim);
    let repl = others[0]!;
    let bestD = Infinity;
    const vlab = palette.lab[victim]!;
    for (const o of others) {
      const d = ciede2000(vlab, palette.lab[o]!);
      if (d < bestD) {
        bestD = d;
        repl = o;
      }
    }
    for (let i = 0; i < out.length; i++) {
      if (out[i] === victim) out[i] = repl;
    }
    counts.set(repl, (counts.get(repl) ?? 0) + vCount);
    counts.delete(victim);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 编排：generatePatternBead
// ---------------------------------------------------------------------------

export interface BeadDiagnostics extends Partial<PipelineDiagnostics> {
  resamplePasses?: number;
  resampleMethod?: 'area' | 'dpid';
  sourceFloodApplied?: boolean;
}

export interface ResampleEvent {
  phase: 'fit' | 'direct';
  method: 'area' | 'dpid';
}

export type ResampleHook = (event: ResampleEvent) => void;
export interface GenerationDetails {
  samples: GridSamples;
  initialLabels: Int32Array;
  finalLabels: Int32Array;
  palette: readonly Swatch[];
}
export type DetailedResultHook = (details: GenerationDetails) => void;
export type GenerationStage = 'prepare' | 'resample' | 'candidates' | 'optimize' | 'cleanup' | 'done';
export interface ProgressEvent { stage: GenerationStage; progress: number }
export type ProgressHook = (event: ProgressEvent) => void;

export interface BeadOptions {
  palette?: readonly Swatch[];
  /** 网格最大边长（auto 模式，按原图比例取另一边） */
  maxSide?: number;
  /** 固定尺寸（如 58x58），此时按比例居中补透明 */
  fixed?: { w: number; h: number };
  removeBg?: 'none' | 'flood';
  cropToSubject?: boolean;
  /** 配合 fixed 尺寸裁比例铺满整板 */
  fill?: boolean;
  dither?: boolean;
  despeckle?: boolean;
  maxColors?: number;
  /** Shared cleanup/color operation budget. */
  maxOperations?: number;
  /** 稀有色合并阈值：用量低于该值的色号就近并入邻近色（0/1=关） */
  minBeads?: number;
  /** flood 去背景 CIEDE2000 阈值 */
  backgroundTolerance?: number;
  /** 转像素前的 mask-aware 保边平滑；l0 使用 bbox 隔离延拓。 */
  smooth?: SmoothKind;
  /** gauss 平滑 σ（smooth='gauss' 时生效），默认 1 */
  smoothSigma?: number;
  /** L0 梯度稀疏权重（smooth='l0' 时生效），默认 0.02；0.005 为弱档 */
  smoothLambda?: number;
  /** 引导滤波窗口半径（smooth='guided' 时生效），默认 8 */
  smoothRadius?: number;
  /** 引导滤波正则（smooth='guided' 时生效，0..255 尺度），默认 100 */
  smoothEps?: number;
  /** 降采样算法；auto/fixed/fill 均由统一重采样器直接输出目标网格 */
  scale?: ScaleKind;
  /** DPID 细节权重指数（scale='dpid' 时生效），默认 1.0；0 精确退化为 area */
  dpidLambda?: number;
  /** 主管线统一颜色量化，默认关闭；数字兼容应由 quantizeImage 单独调用。 */
  colorQuantize?: ColorQuantizeOptions;
  /** @internal 测试/诊断输出，不参与图像行为。 */
  diagnostics?: BeadDiagnostics;
  /** Spatial quantization; defaults to the clean product profile. */
  spatial?: Partial<import('../core/types').SpatialQuantizeOptions>;
  /** Explicit profile; legacy keeps direct matching and no spatial optimization. */
  profile?: 'clean' | 'legacy';
  /** Progress callback; never serialized into worker payloads. */
  onProgress?: ProgressHook;
  /** Optional cancellation hook checked at stage boundaries. */
  shouldCancel?: () => boolean;
  /** @internal library-only hook; functions are not intended for worker serialization. */
  onResample?: ResampleHook;
  /** @internal acceptance hook exposing target samples and label states. */
  onDetailedResult?: DetailedResultHook;
}

const DEFAULTS_BEAD = {
  maxSide: 50,
  /** 默认 none：只按透明通道裁主体，有色背景保留；'flood' 用 CIEDE2000 按颜色清纯背景 */
  removeBg: 'none' as 'none',
  despeckle: false,
  dither: false,
  backgroundTolerance: 12,
};

function chooseGrid(img: RgbaImage, opts: BeadOptions): { gw: number; gh: number; fit: boolean } {
  if (opts.fixed) {
    if (!Number.isInteger(opts.fixed.w) || opts.fixed.w < 1 || !Number.isInteger(opts.fixed.h) || opts.fixed.h < 1) {
      throw new Error('fixed.w/fixed.h 必须为正整数');
    }
    return { gw: opts.fixed.w, gh: opts.fixed.h, fit: true };
  }
  const maxSide = opts.maxSide ?? DEFAULTS_BEAD.maxSide;
  if (!Number.isInteger(maxSide) || maxSide < 1) throw new Error('maxSide 必须为正整数');
  if (img.width >= img.height) {
    const gw = maxSide;
    const gh = Math.max(1, Math.round((maxSide * img.height) / img.width));
    return { gw, gh, fit: false };
  }
  const gh = maxSide;
  const gw = Math.max(1, Math.round((maxSide * img.width) / img.height));
  return { gw, gh, fit: false };
}

/**
 * 转像素管线（bead 思路，TS 版）：
 * 源图 foreground mask/flood → mask-aware crop/fill → 可选颜色量化 → mask RGB 延拓隔离 → smooth
 * → area/DPID 一次输出目标网格 → CIEDE2000 匹配 → 后处理。
 * flood 置信度不足时安全退化为 alpha-only，宁可保留背景也不猜测删除主体。
 */
export function generatePatternBead(img: RgbaImage, options: BeadOptions): Grid {
  const started = Date.now();
  const diagnostics = options.diagnostics;
  const stages: GenerationStage[] = [];
  const timings: Record<string, number> = {};
  const emit = (stage: GenerationStage): void => {
    if (options.shouldCancel?.()) throw new Error('生成已取消');
    stages.push(stage);
    options.onProgress?.({ stage, progress: stage === 'prepare' ? 0 : stage === 'resample' ? 20 : stage === 'candidates' ? 40 : stage === 'optimize' ? 65 : stage === 'cleanup' ? 85 : 100 });
  };
  const timed = <T>(stage: GenerationStage, fn: () => T): T => {
    const at = Date.now();
    try {
      emit(stage);
      return fn();
    } finally {
      timings[stage] = Date.now() - at;
      if (diagnostics) diagnostics.timings = { ...timings };
    }
  };
  const profile = options.profile ?? 'clean';
  const spatial = resolveSpatialQuantizeOptions({ ...DEFAULT_GENERATION_OPTIONS.spatial, ...(options.spatial ?? {}), enabled: profile === 'legacy' ? false : options.spatial?.enabled ?? DEFAULT_GENERATION_OPTIONS.spatial.enabled });
  const rawSwatches = options.palette ?? MARD291;
  const canonicalSwatches = normalizeSwatches(rawSwatches);
  if (canonicalSwatches.length === 0) throw new Error('palette 不能为空');
  if (options.maxColors !== undefined && (!Number.isInteger(options.maxColors) || options.maxColors < 0)) throw new Error('maxColors 必须为非负整数');
  if (options.minBeads !== undefined && (!Number.isInteger(options.minBeads) || options.minBeads < 0)) throw new Error('minBeads 必须为非负整数');
  const useDither = options.dither ?? (profile === 'legacy' ? GENERATION_PROFILES.legacy.dither : DEFAULT_GENERATION_OPTIONS.dither);
  if (useDither && spatial.enabled) throw new Error('dither 与 spatial clean mode 不兼容；请显式 profile=legacy 或关闭 spatial');
  const palette = buildBeadPalette(canonicalSwatches);
  const removeBg = options.removeBg ?? DEFAULTS_BEAD.removeBg;
  const tol = options.backgroundTolerance ?? DEFAULTS_BEAD.backgroundTolerance;
  if (!Number.isFinite(tol) || tol < 0) throw new Error('backgroundTolerance 必须为有限非负数');

  let work = img;
  let mask!: ForegroundMask;
  let chosen!: { gw: number; gh: number; fit: boolean };
  const smooth = options.smooth ?? (profile === 'legacy' ? GENERATION_PROFILES.legacy.smooth : DEFAULT_GENERATION_OPTIONS.smooth);
  timed('prepare', () => {
    mask = buildForegroundMask(work, { mode: removeBg, tolerance: tol, alpha: { threshold: 128 } });
    if (options.cropToSubject) ({ image: work, mask } = cropImageAndMaskToSubject(work, mask));
    chosen = chooseGrid(work, options);
    if (options.fill && chosen.fit) ({ image: work, mask } = cropImageAndMaskToAspect(work, mask, chosen.gw, chosen.gh));
    if (smooth === 'gauss') {
      const sigma = options.smoothSigma ?? 1;
      if (!Number.isFinite(sigma) || sigma <= 0 || sigma > 64) throw new Error('smoothSigma 必须为 finite、正数且不超过 64');
      work = applyMaskForSmoothing(work, mask, (tile, coverage) => gaussianBlur(tile, sigma, coverage));
    } else if (smooth === 'guided') {
      work = applyMaskForSmoothing(work, mask, (tile, coverage) => guidedSmooth(tile, { r: options.smoothRadius ?? 8, eps: options.smoothEps ?? 100, coverage }));
    } else if (smooth === 'l0') {
      work = applyMaskForSmoothing(extendMaskedRgb(work, mask), mask, (tile) => l0Smooth(tile, { lam: options.smoothLambda ?? 0.02 }));
    } else if (smooth !== 'none') throw new Error(`smooth 非法: ${String(smooth)}`);
    if (options.colorQuantize) work = quantizeImage(work, options.colorQuantize);
  });

  const { gw, gh } = chosen;
  const scale = options.scale ?? (profile === 'legacy' ? GENERATION_PROFILES.legacy.scale : DEFAULT_GENERATION_OPTIONS.scale);
  if (scale !== 'box' && scale !== 'dpid' && scale !== 'area') throw new Error(`scale 非法: ${String(scale)}`);
  const method = scale === 'dpid' ? 'dpid' as const : 'area' as const;
  const samples = timed('resample', () => method === 'dpid'
    ? dpidResampleToGrid(work, gw, gh, { mask, lambda: options.dpidLambda ?? 1 })
    : areaResampleToGrid(work, gw, gh, { mask }));
  options.onResample?.({ phase: 'direct', method });
  const sampled = gridSamplesToRgba(samples);
  const grid: GridRgba = { gw, gh, data: sampled.data };
  if (diagnostics) { diagnostics.resamplePasses = 1; diagnostics.actualResamplePasses = 1; diagnostics.internalIntegrationPasses = samples.integrationPasses ?? 1; diagnostics.resampleMethod = method; diagnostics.sourceFloodApplied = removeBg === 'flood'; }

  const candidates = timed('candidates', () => buildPaletteCandidates(samples, canonicalSwatches, spatial.topK));
  const initial = useDither ? matchDitherData(grid, sampled.data, palette) : matchDirectData(grid, sampled.data, palette);
  const initialLabels = Uint16Array.from(initial, (value) => value < 0 ? 0 : value);
  const validLabels = (): Int32Array => Int32Array.from(initial, (value) => value < 0 ? -1 : value);
  let labels: Uint16Array;
  let optimizerIterations = 0;
  let energyBefore = 0;
  let energyAfter = 0;
  let optimizerEnergyBefore = 0;
  let optimizerEnergyAfter = 0;
  let cleanupEnergyBefore = 0;
  let cleanupEnergyAfter = 0;
  let colorBudgetEnergyBefore = 0;
  let colorBudgetEnergyAfter = 0;
  if (spatial.enabled && !useDither) {
    const optimized = timed('optimize', () => optimizeSpatialLabels(samples, candidates, canonicalSwatches, spatial));
    labels = optimized.labels; optimizerIterations = optimized.iterations; energyBefore = optimized.energyBefore; energyAfter = optimized.energyAfter;
    optimizerEnergyBefore = optimized.energyBefore; optimizerEnergyAfter = optimized.energyAfter;
  } else {
    emit('optimize');
    labels = initialLabels;
    energyBefore = computeSpatialLabelEnergy(samples, candidates, canonicalSwatches, labels, spatial);
    energyAfter = energyBefore;
    optimizerEnergyBefore = energyBefore; optimizerEnergyAfter = energyAfter;
  }
  const beforeMetrics = measureSpatialFragmentation(validLabels(), gw, gh);
  const sharedBudget = createOperationBudget(options.maxOperations ?? Math.max(1, gw * gh * 3));
  let cleanupOperationCount = 0;
  let colorBudgetOperationCount = 0;

  if (spatial.enabled && !useDither) {
    cleanupEnergyBefore = computeSpatialLabelEnergy(samples, candidates, canonicalSwatches, labels, { smoothness: spatial.smoothness, edgeSigma: spatial.edgeSigma });
    const cleaned = timed('cleanup', () => cleanupSpatialLabels(samples, candidates, canonicalSwatches, labels, { maxRegionSize: spatial.cleanupMaxSize, confidence: spatial.cleanupConfidence, smoothness: spatial.smoothness, edgeSigma: spatial.edgeSigma, operationBudget: sharedBudget }));
    labels = cleaned.labels;
    cleanupEnergyAfter = cleaned.diagnostics.energyAfter;
    cleanupOperationCount = sharedBudget.count;
    colorBudgetEnergyBefore = computeSpatialLabelEnergy(samples, candidates, canonicalSwatches, labels, { smoothness: spatial.smoothness, edgeSigma: spatial.edgeSigma });
    const budgeted = enforceSpatialColorBudget(samples, candidates, canonicalSwatches, labels, { minBeads: options.minBeads ?? 0, maxColors: options.maxColors, smoothness: spatial.smoothness, edgeSigma: spatial.edgeSigma, operationBudget: sharedBudget });
    labels = budgeted.labels; colorBudgetOperationCount = sharedBudget.count - cleanupOperationCount; colorBudgetEnergyAfter = budgeted.diagnostics.energyAfter; energyAfter = colorBudgetEnergyAfter;
  } else {
    emit('cleanup');
    cleanupEnergyBefore = energyAfter;
    cleanupEnergyAfter = energyAfter;
    colorBudgetEnergyBefore = energyAfter;
    colorBudgetEnergyAfter = energyAfter;
    if (options.despeckle) {
      const cleaned = despeckle(initial, gw, gh, 2);
      labels = Uint16Array.from(cleaned, (value) => value < 0 ? 0 : value);
    }
    if (options.maxColors && options.maxColors > 0) labels = Uint16Array.from(limitColorsIdx(Int32Array.from(labels), palette, options.maxColors));
    if ((options.minBeads ?? 0) > 1) labels = Uint16Array.from(mergeRareIdx(Int32Array.from(labels), palette, options.minBeads!));
  }

  const finalIdx = Int32Array.from(labels, (label, i) => samples.coverage[i]! < 0.5 ? -1 : label);
  const afterMetrics = measureSpatialFragmentation(finalIdx, gw, gh);
  const cells: Grid['cells'] = [];
  for (let y = 0; y < gh; y++) {
    const row: Grid['cells'][number] = [];
    for (let x = 0; x < gw; x++) {
      const k = finalIdx[y * gw + x]!;
      row.push(k < 0 ? { code: '', hex: '', external: true } : { code: palette.codes[k]!, hex: palette.hexes[k]!, external: false });
    }
    cells.push(row);
  }
  const colorSet = new Set<string>();
  for (const row of cells) for (const cell of row) if (!cell.external) colorSet.add(cell.code);
  emit('done');
  options.onDetailedResult?.({
    samples,
    initialLabels: Int32Array.from(initial),
    finalLabels: finalIdx.slice(),
    palette: canonicalSwatches,
  });
  if (diagnostics) {
    const small = (metrics: typeof beforeMetrics) => metrics.componentCount ? metrics.singletonComponentCount / metrics.componentCount : 0;
    const smallSnapshot = (metrics: typeof beforeMetrics) => metrics;
    Object.assign(diagnostics, { componentCount: afterMetrics.componentCount, singletonComponentCount: afterMetrics.singletonComponentCount, singletonRatio: afterMetrics.singletonRatio, smallComponentCount: afterMetrics.smallComponentCount, smallComponentRatio: afterMetrics.smallComponentRatio, smallComponentThreshold: 2 as const, validCellCount: afterMetrics.validCellCount, boundaryCount: afterMetrics.boundaryCount, adjacencyCount: afterMetrics.adjacencyCount, boundaryRatio: afterMetrics.boundaryRatio, colorCountBefore: new Set(initial.filter((v, i) => v >= 0 && samples.coverage[i]! >= 0.5)).size, colorCountAfter: colorSet.size, singletonRatioBefore: beforeMetrics.singletonRatio, singletonRatioAfter: afterMetrics.singletonRatio, smallComponentRatioBefore: beforeMetrics.smallComponentRatio, smallComponentRatioAfter: afterMetrics.smallComponentRatio, optimizerIterations, energyBefore, energyAfter, optimizerEnergyBefore, optimizerEnergyAfter, cleanupEnergyBefore, cleanupEnergyAfter, colorBudgetEnergyBefore, colorBudgetEnergyAfter, totalEnergyBefore: optimizerEnergyBefore, totalEnergyAfter: colorBudgetEnergyAfter, stageOrder: [...stages], stages: [...stages], timings: { ...timings }, actualResamplePasses: 1, internalIntegrationPasses: samples.integrationPasses ?? 1, operationBudget: sharedBudget.limit, cleanupOperationCount, colorBudgetOperationCount, fragmentationBefore: smallSnapshot(beforeMetrics), fragmentationAfter: smallSnapshot(afterMetrics), labelsBefore: Array.from(initial), totalTimeMs: Date.now() - started });
  }
  return { rows: gh, cols: gw, cells, colorCount: colorSet.size };
}
