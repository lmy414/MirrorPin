// MirrorPin CLI：图片 -> 拼豆图纸(正式 PNG) + 可选材料清单。
// 用法示例：mirrorpin convert in.png -o out.png --max-side 64 --blur 3 --colors 48

import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import type { RgbaImage, Swatch, Grid } from '../src/core/types';
import {
  MARD291,
  MARD221,
  gaussianBlur,
  kmeansPalette,
  buildPalette,
  nearestSwatch,
  rgbToHex,
  generatePatternBead,
} from '../src/index';
import { renderPatternPng, countGridMaterials } from '../src/render/node';

const VERSION = '0.1.0';

const HELP = `MirrorPin ${VERSION} — 拼豆图纸生成工具

用法:
  node E:\\M_Workbench\\MirrorPin\\dist\\cli.js <input> -o <output.png> [选项]
  node E:\\M_Workbench\\MirrorPin\\dist\\cli.js <input> --materials <清单.csv> [选项]

必选其一:
  -o, --output <path>     输出图纸 PNG 路径
  --materials <path>      输出材料清单 CSV 路径

选项:
  --max-side <n>          网格最大边长（另一边按比例），默认 64
  --blur <sigma>          高斯模糊强度，默认 1
  --no-blur               关闭模糊
  --colors <n>            预处理降色数（0=不降色），默认 64
  --no-crop               关闭透明通道裁剪
  --max-colors <n>        最终色号上限（不限制则省略）
  --min-beads <n>         稀有色合并：用量 < n 的色号并入邻近色（0=不合并）
  --remove-bg <none|flood> 网格级按颜色清纯背景，默认 none
  --despeckle             清理 <2 格的杂点
  --dither                抖动（照片渐变用，会导致色号增多）
  --board <n>             板界线间隔，默认 29
  --palette <name>        色卡：mard291（含扩展 70 色，默认）| mard221（标准 A-H/M 221 色）
  --no-legend             关闭图纸内嵌材料清单面板（默认开启）
  -h, --help              显示帮助
  -V, --version           显示版本

示例:
  node E:\\M_Workbench\\MirrorPin\\dist\\cli.js "E:\\Downloads\\Q13_peek_探头.png" -o "E:\\M_Workbench\\MirrorPin\\output\\Q13_pattern.png" --materials "E:\\M_Workbench\\MirrorPin\\output\\Q13_materials.csv"
  node E:\\M_Workbench\\MirrorPin\\dist\\cli.js "E:\\Downloads\\Q13_peek_探头.png" -o "E:\\M_Workbench\\MirrorPin\\output\\Q13_pattern_mard221.png" --palette mard221 --min-beads 5 --no-blur --colors 0
`;

function printHelp(): void {
  console.log(HELP);
}

function parsePositiveInt(raw: string | undefined, name: string): number {
  if (raw === undefined) throw new Error(`${name} 缺少取值`);
  const v = Number(raw);
  if (!Number.isFinite(v) || !Number.isInteger(v) || v <= 0) throw new Error(`${name} 非法取值: ${raw}（需为正整数）`);
  return v;
}

function parseNonNegativeInt(raw: string | undefined, name: string): number {
  if (raw === undefined) throw new Error(`${name} 缺少取值`);
  const v = Number(raw);
  if (!Number.isFinite(v) || !Number.isInteger(v) || v < 0) throw new Error(`${name} 非法取值: ${raw}（需为非负整数）`);
  return v;
}

function parseBlurValue(raw: string | undefined): number | false {
  if (raw === undefined) throw new Error('--blur 缺少取值');
  if (raw === '0') return false;
  const v = Number(raw);
  if (!Number.isFinite(v) || v <= 0) throw new Error(`--blur 非法取值: ${raw}（需为正数，或 0 表示关闭）`);
  return v;
}

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

export type PaletteName = 'mard291' | 'mard221';

export interface ConvertArgs {
  input: string;
  output: string;
  /** @default 64 — 与 README 一致；库默认 50（src/beadpattern/core.ts:DEFAULTS_BEAD） */
  maxSide: number;
  /** false=关；数字=sigma @default 1 */
  blur: number | false;
  /** @default 64 — 0=不降色 */
  colors: number;
  crop: boolean;
  maxColors?: number;
  /** 稀有色合并阈值：用量低于该值的色号并入邻近色（0=关） */
  minBeads: number;
  removeBg: 'none' | 'flood';
  despeckle: boolean;
  dither: boolean;
  /** @default 29 */
  board: number;
  /** 图纸内嵌材料清单面板（默认开） */
  legend: boolean;
  /** 色卡：mard291（默认，含扩展）| mard221（标准 A-H/M） */
  palette: PaletteName;
  materials?: string; // 材料清单输出路径（optional，csv）
}

export function parseArgs(argv: string[]): ConvertArgs {
  const a: ConvertArgs = {
    input: '',
    output: '',
    maxSide: 64,
    blur: 1,
    colors: 64,
    crop: true,
    removeBg: 'none',
    despeckle: false,
    dither: false,
    board: 29,
    legend: true,
    palette: 'mard291',
    minBeads: 0,
  };
  const unknown: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!;
    const next = () => argv[++i];
    switch (t) {
      case '-o':
      case '--output': {
        const v = next();
        if (v === undefined) throw new Error('--output 缺少取值');
        a.output = v;
        break;
      }
      case '--max-side':
        a.maxSide = parsePositiveInt(next(), '--max-side');
        break;
      case '--no-blur':
        a.blur = false;
        break;
      case '--blur':
        a.blur = parseBlurValue(next());
        break;
      case '--colors':
        a.colors = parseNonNegativeInt(next(), '--colors');
        break;
      case '--no-crop':
        a.crop = false;
        break;
      case '--max-colors':
        a.maxColors = parsePositiveInt(next(), '--max-colors');
        break;
      case '--min-beads':
        a.minBeads = parseNonNegativeInt(next(), '--min-beads');
        break;
      case '--remove-bg': {
        const v = (next() ?? '').toLowerCase();
        if (v !== 'none' && v !== 'flood') throw new Error(`--remove-bg 非法取值: ${v}（可选 none | flood）`);
        a.removeBg = v;
        break;
      }
      case '--despeckle':
        a.despeckle = true;
        break;
      case '--dither':
        a.dither = true;
        break;
      case '--board':
        a.board = parsePositiveInt(next(), '--board');
        break;
      case '--no-legend':
        a.legend = false;
        break;
      case '--palette': {
        const v = (next() ?? '').toLowerCase();
        if (v !== 'mard291' && v !== 'mard221') throw new Error(`未知色卡: ${v}（可选 mard291 / mard221）`);
        a.palette = v;
        break;
      }
      case '--materials': {
        const v = next();
        if (v === undefined) throw new Error('--materials 缺少取值');
        a.materials = v;
        break;
      }
      case '-h':
      case '--help':
        printHelp();
        process.exit(0);
        break;
      case '-V':
      case '--version':
        console.log(VERSION);
        process.exit(0);
        break;
      default:
        if (t.startsWith('-')) unknown.push(t);
        else if (!a.input) a.input = t;
        break;
    }
  }
  if (unknown.length) throw new Error(`未知参数: ${unknown.join(' ')}`);
  if (!a.input) throw new Error('缺少输入图片路径');
  if (!a.output && !a.materials) throw new Error('缺少输出路径，请用 -o 指定输出 PNG 或 --materials 指定清单');
  return a;
}

export async function convert(img: RgbaImage, args: ConvertArgs, render: (g: Grid) => Promise<Buffer>): Promise<Grid> {
  const work = preprocess(img, { blurOn: args.blur !== false, sigma: typeof args.blur === 'number' ? args.blur : 1, kColors: args.colors });
  const palette = args.palette === 'mard221' ? MARD221 : MARD291;
  const grid = generatePatternBead(work, {
    palette: palette as readonly Swatch[],
    maxSide: args.maxSide,
    cropToSubject: args.crop,
    removeBg: args.removeBg,
    despeckle: args.despeckle,
    dither: args.dither,
    maxColors: args.maxColors,
    minBeads: args.minBeads,
  });
  if (args.output) {
    const buf = await render(grid);
    await sharp(buf).toFile(args.output);
  }
  if (args.materials) {
    const rows = countGridMaterials(grid);
    const csv = ['code,hex,count', ...rows.map((r) => `${r.code},#${r.hex},${r.count}`)].join('\n');
    await writeFile(args.materials, Buffer.from(csv, 'utf8'));
  }
  // 打印摘要
  const rows = countGridMaterials(grid);
  console.log(`[mirrorpin] ${grid.cols}×${grid.rows} 格 · ${grid.colorCount} 色 · 豆合计 ${rows.reduce((s, r) => s + r.count, 0)}`);
  for (const r of rows.slice(0, 8)) console.log(`  ${r.code.padEnd(6)} #${r.hex.padEnd(7)} ×${r.count}`);
  return grid;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const img = await decode(args.input);
  await convert(img, args, (g) => {
    const rows = countGridMaterials(g);
    const total = rows.reduce((s, r) => s + r.count, 0);
    const paletteName = args.palette === 'mard221' ? 'MARD 221' : 'MARD 291';
    return renderPatternPng(g, {
      cell: 40,
      board: args.board,
      legend: args.legend,
      paletteName,
      title: `MirrorPin 拼豆图纸 · ${g.cols}×${g.rows} 格 · ${rows.length} 色 · 合计 ${total} 豆 · 色卡 ${paletteName}`,
    });
  });
  if (args.output) console.log(`输出图纸: ${args.output}`);
  if (args.materials) console.log(`材料清单: ${args.materials}`);
}

main().catch((e) => {
  console.error('错误:', (e as Error).message);
  process.exit(1);
});
