// MirrorPin CLI：图片 -> 拼豆图纸(正式 PNG) + 可选材料清单。
// 用法示例：mirrorpin convert in.png -o out.png --max-side 64 --blur 3 --colors 48

import sharp from 'sharp';
import type { RgbaImage, Swatch, Grid } from '../src/core/types';
import {
  MARD291,
  gaussianBlur,
  kmeansPalette,
  buildPalette,
  nearestSwatch,
  rgbToHex,
  generatePatternBead,
} from '../src/index';
import { renderPatternPng } from '../src/render/node';

/** 用 sharp 解码任意图片（PNG/JPG/WebP）为 RGBA RgbaImage */
export async function decode(imagePath: string): Promise<RgbaImage> {
  const { data, info } = await sharp(imagePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data) };
}

/** 预处理：高斯模糊(可选) + kmeans 降色(可选)。kColors>=256 或 <=0 表示不降色 */
export function preprocess(
  img: RgbaImage,
  opts: { blurOn: boolean; sigma: number; kColors: number },
): RgbaImage {
  const blurred = opts.blurOn && opts.sigma > 0 ? gaussianBlur(img, opts.sigma) : img;
  if (!(opts.kColors > 0) || opts.kColors >= 256) return blurred;

  const { width: W, height: H, data } = blurred;
  const samples: { r: number; g: number; b: number }[] = [];
  const step = 3;
  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      const i = (y * W + x) * 4;
      if (data[i + 3]! < 128) continue;
      samples.push({ r: data[i]!, g: data[i + 1]!, b: data[i + 2]! });
      if (samples.length >= 120000) break;
    }
  }
  if (samples.length === 0) return blurred;

  const centers = kmeansPalette(samples, Math.min(opts.kColors, samples.length));
  const swatches = centers.map((c, i) => ({ code: String(i), hex: rgbToHex(c) }));
  const entries = buildPalette(swatches);

  const out = new Uint8ClampedArray(data);
  const cache = new Map<number, string>();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (data[i + 3]! < 128) continue;
      const key = ((data[i]! >> 3) << 10) | ((data[i + 1]! >> 3) << 5) | (data[i + 2]! >> 3);
      let hx = cache.get(key);
      if (!hx) {
        hx = nearestSwatch({ r: data[i]!, g: data[i + 1]!, b: data[i + 2]! }, entries).hex;
        cache.set(key, hx);
      }
      out[i] = parseInt(hx.slice(0, 2), 16);
      out[i + 1] = parseInt(hx.slice(2, 4), 16);
      out[i + 2] = parseInt(hx.slice(4, 6), 16);
    }
  }
  return { width: W, height: H, data: out };
}

export interface ConvertArgs {
  input: string;
  output: string;
  maxSide: number;
  blur: boolean | number; // false=关；数字=sigma
  colors: number; // 0=不降色
  crop: boolean;
  maxColors?: number;
  removeBg: 'none' | 'flood';
  despeckle: boolean;
  dither: boolean;
  board: number;
  materials?: string; // 材料清单输出路径（optional，csv）
}

export function parseArgs(argv: string[]): ConvertArgs {
  const a = { input: '', output: '' , maxSide: 64, blur: true as boolean | number, colors: 64, crop: true, removeBg: 'none' as 'none' | 'flood', despeckle: false, dither: false, board: 29 };
  const unknown: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!;
    const next = () => argv[++i]!;
    switch (t) {
      case '-o': case '--output': a.output = next(); break;
      case '--max-side': a.maxSide = Number(next()); break;
      case '--no-blur': a.blur = false; break;
      case '--blur': { const v = next(); a.blur = v === '0' ? false : Number(v) || 1; } break;
      case '--colors': a.colors = Number(next()); break;
      case '--no-crop': a.crop = false; break;
      case '--max-colors': a.maxColors = Number(next()); break;
      case '--remove-bg': a.removeBg = next() === 'flood' ? 'flood' : 'none'; break;
      case '--despeckle': a.despeckle = true; break;
      case '--dither': a.dither = true; break;
      case '--board': a.board = Number(next()); break;
      case '--materials': a.materials = next(); break;
      default:
        if (t.startsWith('-')) unknown.push(t);
        else if (!a.input) a.input = t;
        break;
    }
  }
  if (unknown.length) throw new Error(`未知参数: ${unknown.join(' ')}`);
  if (!a.input) throw new Error('缺少输入图片路径');
  if (!a.output && !a.materials) throw new Error('缺少输出路径，请用 -o 指定输出 PNG');
  return a;
}

function countMaterials(grid: Grid): { code: string; hex: string; count: number }[] {
  const m = new Map<string, { code: string; hex: string; count: number }>();
  for (const row of grid.cells) {
    for (const c of row) {
      if (c.external || !c.code) continue;
      const e = m.get(c.code);
      if (e) e.count++;
      else m.set(c.code, { code: c.code, hex: c.hex, count: 1 });
    }
  }
  return [...m.values()].sort((x, y) => y.count - x.count);
}

export async function convert(img: RgbaImage, args: ConvertArgs, render: (g: Grid) => Promise<Buffer>): Promise<Grid> {
  const work = preprocess(img, { blurOn: typeof args.blur !== 'boolean', sigma: typeof args.blur === 'number' ? args.blur : 1, kColors: args.colors });
  const grid = generatePatternBead(work, {
    palette: MARD291 as readonly Swatch[],
    maxSide: args.maxSide,
    cropToSubject: args.crop,
    removeBg: args.removeBg,
    despeckle: args.despeckle,
    dither: args.dither,
    maxColors: args.maxColors,
  });
  if (args.output) {
    const buf = await render(grid);
    await sharp(buf).toFile(args.output);
  }
  if (args.materials) {
    const rows = countMaterials(grid);
    const csv = ['code,hex,count', ...rows.map((r) => `${r.code},#${r.hex},${r.count}`)].join('\n');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(args.materials, Buffer.from(csv, 'utf8'));
  }
  // 打印摘要
  const rows = countMaterials(grid);
  console.log(`[mirrorpin] ${grid.cols}×${grid.rows} 格 · ${grid.colorCount} 色 · 豆合计 ${rows.reduce((s, r) => s + r.count, 0)}`);
  for (const r of rows.slice(0, 8)) console.log(`  ${r.code.padEnd(6)} #${r.hex.padEnd(7)} ×${r.count}`);
  return grid;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const img = await decode(args.input);
  await convert(img, args, (g) => renderPatternPng(g, { cell: 40, board: args.board }));
  if (args.output) console.log(`输出图纸: ${args.output}`);
  if (args.materials) console.log(`材料清单: ${args.materials}`);
}

main().catch((e) => {
  console.error('错误:', (e as Error).message);
  process.exit(1);
});