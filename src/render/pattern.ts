// 正式图纸渲染：带色号文字 + 坐标 + 每格线/每10格粗线/板界，输出内存 RGBA。
// 全部自包含（位图字体），由调用方编码为 PNG 等。对标 bead-pattern 的 render_pattern。

import type { RGB, RgbaImage } from '../core/types';
import type { Grid } from '../core/types';
import { hexToRgb } from '../core/color';
import { glyph, textWidth } from './font';

export interface RenderPatternOptions {
  /** 每格边长（px），默认 40 */
  cell?: number;
  /** 每板格子数（板界周期），默认 29 */
  board?: number;
  /** 左侧坐标区宽度，默认 40 */
  gutter?: number;
  /** 顶部标题区高度（像素），默认 0（不画标题）。注意：与 RenderNodeOptions.title: string 不同 */
  title?: number;
  showCodes?: boolean;
  showCoords?: boolean;
}

/** 在画布上以位图字体画一段文字（scale 像素/格） */
function paintText(
  canvas: Uint8ClampedArray,
  W: number,
  ox: number,
  oy: number,
  text: string,
  scale: number,
  color: RGB,
): void {
  let cx = ox;
  for (const ch of text) {
    const rows = glyph(ch);
    for (let r = 0; r < rows.length; r++) {
      const line = rows[r]!;
      for (let c = 0; c < line.length; c++) {
        if (line[c] !== '#') continue;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const x = cx + c * scale + dx;
            const y = oy + r * scale + dy;
            const i = (y * W + x) * 4;
            canvas[i] = color.r;
            canvas[i + 1] = color.g;
            canvas[i + 2] = color.b;
            canvas[i + 3] = 255;
          }
        }
      }
    }
    cx += 4 * scale;
  }
}

/**
 * 把图纸网格渲染成正式图纸（RGBA 内存图）。
 * 外框：左侧 + 顶部坐标区；格子内填色 + 色号；网格线每格、每10格粗、板界红。
 */
export function renderPatternImage(
  grid: Grid,
  options: RenderPatternOptions = {},
): RgbaImage {
  const cell = options.cell ?? 40;
  const board = options.board ?? 29;
  const gutter = options.gutter ?? 40;
  const title = options.title ?? 0;
  const showCodes = options.showCodes ?? true;
  const showCoords = options.showCoords ?? true;

  const gw = grid.cols;
  const gh = grid.rows;
  const W = gutter + gw * cell + 8;
  const H = title + gutter + gh * cell + 8;
  const data = new Uint8ClampedArray(W * H * 4);

  const set = (x: number, y: number, r: number, g: number, b: number) => {
    const i = (y * W + x) * 4;
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  };

  // 白色画布
  for (let i = 0; i < W * H * 4; i += 4) {
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    data[i + 3] = 255;
  }

  const ox = gutter;
  const oy = title + gutter;

  // 格子填充 + 色号
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const k = grid.cells[y]?.[x]!;
      const x0 = ox + x * cell;
      const y0 = oy + y * cell;
      if (k.external) {
        // 空格画浅棋盘
        const light = (x + y) % 2 === 0 ? [245, 245, 245] : [238, 238, 238];
        for (let py = 0; py < cell; py++) for (let px = 0; px < cell; px++) {
          set(x0 + px, y0 + py, light[0]!, light[1]!, light[2]!);
        }
        continue;
      }
      const { r, g, b } = hexToRgb(k.hex);
      for (let py = 0; py < cell; py++) for (let px = 0; px < cell; px++) {
        set(x0 + px, y0 + py, r, g, b);
      }
      if (showCodes && k.code) {
        // 5x7 线框字，字号按格子宽度自适应（保证整段色号不超格）
        let scale = Math.max(1, Math.floor(cell / 16));
        while (scale > 1 && textWidth(k.code) * scale > cell - 4) scale--;
        const tw = textWidth(k.code) * scale;
        const th = 7 * scale;
        const cx = x0 + Math.round((cell - tw) / 2);
        const cy = y0 + Math.round((cell - th) / 2);
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        paintText(data, W, cx, cy, k.code, scale, lum > 140 ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 });
      }
    }
  }

  // 网格线：每格细线、每 10 格粗线、板界红线
  const drawLine = (x0: number, y0: number, x1: number, y1: number, color: number[], w: number) => {
    if (x0 === x1) {
      for (let y = y0; y < y1; y++) for (let d = 0; d < w; d++) set(Math.min(x0 + d, W - 1), y, color[0]!, color[1]!, color[2]!);
    } else {
      for (let x = x0; x < x1; x++) for (let d = 0; d < w; d++) set(x, Math.min(y0 + d, H - 1), color[0]!, color[1]!, color[2]!);
    }
  };
  for (let gx = 0; gx <= gw; gx++) {
    const x = ox + gx * cell;
    const isBoard = board > 0 && gx % board === 0;
    const major = gx % 10 === 0;
    drawLine(x, oy, x, oy + gh * cell, isBoard ? [200, 40, 40] : major ? [110, 110, 110] : [205, 205, 205], isBoard ? 3 : major ? 2 : 1);
  }
  for (let gy = 0; gy <= gh; gy++) {
    const y = oy + gy * cell;
    const isBoard = board > 0 && gy % board === 0;
    const major = gy % 10 === 0;
    drawLine(ox, y, ox + gw * cell, y, isBoard ? [200, 40, 40] : major ? [110, 110, 110] : [205, 205, 205], isBoard ? 3 : major ? 2 : 1);
  }

  // 坐标（顶部数字 + 左侧数字），每 5 格标一次
  if (showCoords) {
    const scale = 2;
    for (let gx = 0; gx < gw; gx++) {
      if (gx !== 0 && (gx + 1) % 5 !== 0) continue;
      const s = String(gx + 1);
      const tw = textWidth(s) * scale;
      paintText(data, W, Math.round(ox + gx * cell + (cell - tw) / 2), title + 8, s, scale, { r: 70, g: 70, b: 70 });
    }
    for (let gy = 0; gy < gh; gy++) {
      if (gy !== 0 && (gy + 1) % 5 !== 0) continue;
      const s = String(gy + 1);
      paintText(data, W, Math.round(gutter - 14), Math.round(oy + gy * cell + (cell - 10) / 2), s, scale, { r: 70, g: 70, b: 70 });
    }
  }

  return { width: W, height: H, data };
}