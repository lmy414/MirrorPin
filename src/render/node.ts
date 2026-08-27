// 正式图纸渲染（Node）：用 sharp 把 SVG 渲染成 PNG，色号/坐标为真系统 TTF 抗锯齿小字。
// 结构与 bead-pattern 的 render_pattern 一致：填充格 + 居中色号 + 坐标 + 每格/10格/板界线。

import sharp from 'sharp';
import type { Grid } from '../core/types';
import { hexToRgb } from '../core/color';

export interface RenderNodeOptions {
  /** 每格边长（px），默认 40 */
  cell?: number;
  /** 每板格子数（板界周期），默认 29 */
  board?: number;
  /** 色号字号（px），默认 14 */
  codeFont?: number;
  /** 坐标字号，默认 12 */
  coordFont?: number;
  showCodes?: boolean;
  showCoords?: boolean;
  /** 白色到黑色判定阈值（亮度），默认 140 */
  textThreshold?: number;
  /** 在图纸右侧渲染材料清单面板（色块+色号+用量），默认关 */
  legend?: boolean;
  /** 顶部标题文字，传入则绘制标题栏 */
  title?: string;
  /** 色卡名称（图例副标题展示），默认 MARD 291 */
  paletteName?: string;
}

/** 材料清单行：色号 + 色值 + 用量 */
export interface MaterialRow {
  code: string;
  hex: string;
  count: number;
}

/** 统计网格内各色号用量，按用量降序（同量按色号升序） */
export function countGridMaterials(grid: Grid): MaterialRow[] {
  const m = new Map<string, MaterialRow>();
  for (const row of grid.cells) {
    for (const c of row) {
      if (c.external || !c.code) continue;
      const e = m.get(c.code);
      if (e) e.count++;
      else m.set(c.code, { code: c.code, hex: c.hex, count: 1 });
    }
  }
  return [...m.values()].sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function renderPatternSvg(grid: Grid, options: RenderNodeOptions = {}): string {
  const cell = options.cell ?? 40;
  const board = options.board ?? 29;
  const codeFont = options.codeFont ?? 14;
  const coordFont = options.coordFont ?? 12;
  const showCodes = options.showCodes ?? true;
  const showCoords = options.showCoords ?? true;

  const gw = grid.cols;
  const gh = grid.rows;
  const gutter = 42;
  const titleH = options.title ? 56 : 0;

  // 图例面板布局：单列行数由图纸高度决定，放不下自动分列
  const materials = options.legend ? countGridMaterials(grid) : [];
  const total = materials.reduce((s, m) => s + m.count, 0);
  const legendRowH = 30;
  const legendEntryW = 196;
  const legendTop = titleH + 16;
  const H = titleH + gutter + gh * cell + 6;
  const legendRows = materials.length ? Math.max(1, Math.floor((H - legendTop - 16) / legendRowH)) : 0;
  const legendCols = materials.length ? Math.ceil(materials.length / legendRows) : 0;
  const legendW = materials.length ? 16 + legendCols * legendEntryW + 20 : 0;

  const W = gutter + gw * cell + 6 + legendW;

  // 亮度
  const lum = (hex: string) => {
    const { r, g, b } = hexToRgb(hex);
    return 0.299 * r + 0.587 * g + 0.114 * b;
  };
  const textColor = (hex: string) => (lum(hex) > (options.textThreshold ?? 140) ? '#000000' : '#ffffff');

  const p: string[] = [];
  p.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Arial, Helvetica, sans-serif">`,
    `<rect width="${W}" height="${H}" fill="#ffffff"/>`,
  );

  const ox = gutter;
  const oy = gutter;

  // 格子填充 + 居中色号
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const k = grid.cells[y]?.[x]!;
      const x0 = ox + x * cell;
      const y0 = oy + y * cell;
      if (k.external) {
        const c = (x + y) % 2 === 0 ? '#f5f5f5' : '#ededed';
        p.push(`<rect x="${x0}" y="${y0}" width="${cell}" height="${cell}" fill="${c}"/>`);
        continue;
      }
      p.push(`<rect x="${x0}" y="${y0}" width="${cell}" height="${cell}" fill="#${k.hex}"/>`);
      if (showCodes && k.code) {
        p.push(
          `<text x="${x0 + cell / 2}" y="${y0 + cell / 2 + codeFont * 0.32}" font-size="${codeFont}" fill="${textColor(k.hex)}" text-anchor="middle">${esc(k.code)}</text>`,
        );
      }
    }
  }

  // 网格线：每格细、每 10 格粗、板界红
  const line = (x1: number, y1: number, x2: number, y2: number, stroke: string, w: number) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${w}"/>`;
  for (let gx = 0; gx <= gw; gx++) {
    const x = ox + gx * cell;
    const isBoard = board > 0 && gx % board === 0;
    p.push(line(x, oy, x, oy + gh * cell, isBoard ? '#c82828' : gx % 10 === 0 ? '#6e6e6e' : '#cdcdcd', isBoard ? 3 : gx % 10 === 0 ? 2 : 1));
  }
  for (let gy = 0; gy <= gh; gy++) {
    const y = oy + gy * cell;
    const isBoard = board > 0 && gy % board === 0;
    p.push(line(ox, y, ox + gw * cell, y, isBoard ? '#c82828' : gy % 10 === 0 ? '#6e6e6e' : '#cdcdcd', isBoard ? 3 : gy % 10 === 0 ? 2 : 1));
  }

  // 坐标（顶部 + 左侧，每 5 格标）
  if (showCoords) {
    for (let gx = 0; gx < gw; gx++) {
      if (gx !== 0 && (gx + 1) % 5 !== 0) continue;
      p.push(`<text x="${ox + gx * cell + cell / 2}" y="${14}" font-size="${coordFont}" fill="#464646" text-anchor="middle">${gx + 1}</text>`);
    }
    for (let gy = 0; gy < gh; gy++) {
      if (gy !== 0 && (gy + 1) % 5 !== 0) continue;
      p.push(`<text x="14" y="${oy + gy * cell + cell / 2 + coordFont * 0.32}" font-size="${coordFont}" fill="#464646" text-anchor="middle">${gy + 1}</text>`);
    }
  }

  // 标题栏
  if (options.title) {
    p.push(`<text x="${gutter}" y="${34}" font-size="22" font-weight="bold" fill="#1a1a1a">${esc(options.title)}</text>`);
    p.push(line(gutter, titleH - 12, gutter + gw * cell, titleH - 12, '#dddddd', 1));
  }

  // 材料清单面板（右侧）：色块 + 色号 + 色值 + 用量
  if (materials.length) {
    const lx = gutter + gw * cell + 6 + 16;
    p.push(line(lx - 8, titleH + 4, lx - 8, H - 6, '#dddddd', 1));
    p.push(`<text x="${lx}" y="${legendTop + 8}" font-size="17" font-weight="bold" fill="#222222">材料清单</text>`);
    p.push(`<text x="${lx}" y="${legendTop + 28}" font-size="12" fill="#888888">${esc(options.paletteName ?? 'MARD 291')} · ${materials.length} 色 · 合计 ${total} 颗</text>`);
    const rowY0 = legendTop + 48;
    materials.forEach((m, i) => {
      const x = lx + Math.floor(i / legendRows) * legendEntryW;
      const y = rowY0 + (i % legendRows) * legendRowH;
      p.push(`<rect x="${x}" y="${y}" width="22" height="22" fill="#${m.hex}" stroke="#bbbbbb" stroke-width="1"/>`);
      p.push(`<text x="${x + 30}" y="${y + 17}" font-size="14" font-weight="bold" fill="#222222">${esc(m.code)}</text>`);
      p.push(`<text x="${x + 78}" y="${y + 16}" font-size="11" fill="#999999">#${m.hex}</text>`);
      p.push(`<text x="${x + legendEntryW - 26}" y="${y + 17}" font-size="13" fill="#333333" text-anchor="end">×${m.count}</text>`);
    });
  }

  p.push('</svg>');
  return p.join('\n');
}

/** 渲染正式图纸为 PNG buffer */
export async function renderPatternPng(grid: Grid, options: RenderNodeOptions = {}): Promise<Buffer> {
  const svg = renderPatternSvg(grid, options);
  return sharp(Buffer.from(svg)).png().toBuffer();
}