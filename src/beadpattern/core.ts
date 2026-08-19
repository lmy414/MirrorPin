// 转像素核心：以 TS 忠实重写 bead-pattern(scripts/generate.py) 的整套思路。
// 组件与生成器一一对应：crop_to_subject / crop_to_aspect / to_grid(Image.BOX)
//   / flood_remove_bg / match_direct / match_dither / despeckle / limit_colors。

import type { RgbaImage, Grid, Swatch } from '../core/types';
import { ciede2000, srgbToLab, type Lab } from './ciede2000';

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
  const codes: string[] = [];
  const hexes: string[] = [];
  const rgb: number[][] = [];
  const lab: Lab[] = [];
  for (const s of swatches) {
    const r = parseInt(s.hex.slice(0, 2), 16);
    const g = parseInt(s.hex.slice(2, 4), 16);
    const b = parseInt(s.hex.slice(4, 6), 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) continue;
    codes.push(s.code);
    hexes.push(s.hex.toUpperCase());
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
    if ((data[i * 4 + 3] as number) <= 128) continue;
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
    if ((data[i * 4 + 3] as number) <= 128) continue;
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

/** fit=true 保持比例居中补透明；false 直接缩到 gw×gh */
export function toGrid(img: RgbaImage, gw: number, gh: number, fit: boolean): GridRgba {
  if (!fit) {
    return { gw, gh, data: boxDownsample(img.data, img.width, img.height, gw, gh) };
  }
  // fit：等比缩放后居中贴到 gw×gh 透明画布
  const ratio = Math.min(gw / img.width, gh / img.height);
  const nw = Math.max(1, Math.round(img.width * ratio));
  const nh = Math.max(1, Math.round(img.height * ratio));
  const small = boxDownsample(img.data, img.width, img.height, nw, nh);
  const canvas = new Uint8ClampedArray(gw * gh * 4);
  const ox = Math.floor((gw - nw) / 2);
  const oy = Math.floor((gh - nh) / 2);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const si = (y * nw + x) * 4;
      const di = ((oy + y) * gw + (ox + x)) * 4;
      canvas[di] = small[si]!;
      canvas[di + 1] = small[si + 1]!;
      canvas[di + 2] = small[si + 2]!;
      canvas[di + 3] = small[si + 3]!;
    }
  }
  return { gw, gh, data: canvas };
}

/** Image.BOX：目标格 = 源区域平均（RGBA 全部计入） */
function boxDownsample(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  gw: number,
  gh: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(gw * gh * 4);
  for (let gy = 0; gy < gh; gy++) {
    const y0 = Math.floor((gy * sh) / gh);
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * sh) / gh));
    for (let gx = 0; gx < gw; gx++) {
      const x0 = Math.floor((gx * sw) / gw);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * sw) / gw));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * sw + x) * 4;
          r += src[i]!;
          g += src[i + 1]!;
          b += src[i + 2]!;
          a += src[i + 3]!;
          n++;
        }
      }
      const o = (gy * gw + gx) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 网格级 CIEDE2000 去背景（flood_remove_bg）
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
    if ((alpha[i * 4 + 3] as number) <= 128) continue;
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
      if ((alpha[i + 3] as number) <= 128) continue;
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
        if ((alpha[ni + 3] as number) <= 128) continue;
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

// ---------------------------------------------------------------------------
// 编排：generatePatternBead
// ---------------------------------------------------------------------------

const BOARD = 29;

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
  /** flood 去背景 CIEDE2000 阈值 */
  backgroundTolerance?: number;
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
    return { gw: opts.fixed.w, gh: opts.fixed.h, fit: true };
  }
  const maxSide = opts.maxSide ?? DEFAULTS_BEAD.maxSide;
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
 * (可选透明通道裁剪) → BOX 面积平均缩到网格 → (可选 flood 按颜色清纯背景)
 * → CIEDE2000 最近色匹配 → (despeckle / limit_colors / 可选抖动)。
 * 默认不做颜色抠背景：只按透明通道裁主体，有色背景原样带上。
 */
export function generatePatternBead(img: RgbaImage, options: BeadOptions): Grid {
  const palette = buildBeadPalette(options.palette ?? MARD291);
  const removeBg = options.removeBg ?? DEFAULTS_BEAD.removeBg;
  const tol = options.backgroundTolerance ?? DEFAULTS_BEAD.backgroundTolerance;

  // 1. 仅按透明通道裁主体（无 alpha 的图不裁，背景一并保留）
  let work = img;
  if (options.cropToSubject) {
    work = cropToSubject(work);
  }

  // 2. 决定网格 + 可选按比例裁铺满
  const { gw, gh, fit } = chooseGrid(work, options);
  if (options.fill && fit) {
    work = cropToAspectAligned(work, gw, gh);
  }

  // 3. BOX 面积平均缩到网格
  const grid = toGrid(work, gw, gh, fit);

  // 4. 网格级去背景
  let alpha: Uint8ClampedArray;
  if (removeBg === 'flood') {
    alpha = floodRemoveBg(grid, tol);
  } else {
    alpha = new Uint8ClampedArray(grid.data);
  }
  const maskAlpha = alpha;

  // 5. 匹配
  let idx: Int32Array;
  if (options.dither ?? DEFAULTS_BEAD.dither) {
    idx = matchDitherData(grid, maskAlpha, palette);
  } else {
    idx = matchDirectData(grid, maskAlpha, palette);
  }

  // 6. 后处理
  if (options.despeckle) {
    idx = despeckle(idx, gw, gh, 2);
  }
  if (options.maxColors && options.maxColors > 0) {
    idx = limitColorsIdx(idx, palette, options.maxColors);
  }

  // 7. 输出 Grid
  const cells: Grid['cells'] = [];
  for (let y = 0; y < gh; y++) {
    const row = [];
    for (let x = 0; x < gw; x++) {
      const k = idx[y * gw + x]!;
      if (k < 0) {
        row.push({ code: '', hex: '', external: true });
      } else {
        row.push({ code: palette.codes[k]!, hex: palette.hexes[k]!, external: false });
      }
    }
    cells.push(row);
  }
  const colorSet = new Set<string>();
  for (const r of cells) for (const c of r) if (!c.external) colorSet.add(c.code);
  return { rows: gh, cols: gw, cells, colorCount: colorSet.size };
}

// 循环依赖规避：默认色卡在此懒加载（避免 core/types 反向引用 palettes）
import { MARD291 } from '../palettes/mard291';
const MARD291_DEFAULT: readonly Swatch[] = MARD291;