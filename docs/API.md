# MirrorPin API

本文档面向算法库使用者（`import from 'mirrorpin-core'`）。

## 核心类型

```ts
// src/core/types.ts
interface RgbaImage { width: number; height: number; data: Uint8ClampedArray }
interface Swatch { code: string; hex: string }          // hex 不含 #，如 "4B5BA3"
interface Cell { code: string; hex: string; external: boolean }
interface Grid { rows: number; cols: number; cells: Cell[][]; colorCount: number }
interface RGB { r: number; g: number; b: number }
```

`MardSwatch` 与 `Swatch` 同构，保留别名以兼容历史导入。

## 色卡

```ts
import { MARD291, MARD221 } from 'mirrorpin-core';
MARD291.length // 291 = 标准 221（A–H/M）+ 扩展 70（P/Q/R/T/Y/ZG）
MARD221.length // 221
MARD221.every(s => /^[A-HM]\d+$/.test(s.code)) // true，无扩展系列
```

`MARD221` 实现为 `MARD291.filter(s => MARD221_PREFIXES.has(s.code.replace(/\d+$/, '')))`，其中 `MARD221_PREFIXES = Set(['A','B','C','D','E','F','G','H','M'])`。

## generatePatternBead

```ts
import { generatePatternBead } from 'mirrorpin-core';
const grid: Grid = generatePatternBead(image: RgbaImage, options: BeadOptions);
```

### BeadOptions

| 字段 | 类型 | 默认（库） | 说明 |
|---|---|---|---|
| `palette` | `readonly Swatch[]` | `MARD291` | 色卡 |
| `maxSide` | `number` | `50`（CLI 默认 64） | 网格最大边长，另一边按比例 |
| `fixed` | `{ w:number; h:number }` | — | 固定尺寸（此时按比例居中补透明） |
| `fill` | `boolean` | — | 配合 `fixed` 按比例裁铺满整板 |
| `cropToSubject` | `boolean` | `false` | 按透明通道裁主体 |
| `removeBg` | `'none' \| 'flood'` | `'none'` | `flood` 时按颜色清纯背景 |
| `backgroundTolerance` | `number` | `12` | flood 的 CIEDE2000 阈值 |
| `smooth` | `'none' \| 'gauss' \| 'guided' \| 'l0'` | `none`（CLI 默认 `l0`） | 转像素前的保边平滑（`gauss` 用 `smoothSigma`，`guided` 用 `smoothRadius/smoothEps`，`l0` 用 `smoothLambda`） |
| `smoothSigma` | `number` | `1` | gauss 的 σ |
| `smoothLambda` | `number` | `0.02`（`l0soft` 为 0.005） | L0 的 λ |
| `smoothRadius` | `number` | `8` | 引导滤波窗口半径 |
| `smoothEps` | `number` | `100`（0..255 尺度） | 引导滤波正则 |
| `scale` | `'box' \| 'dpid'` | `box`（CLI 默认 `dpid`） | 降采样；`dpid` 仅 auto 网格生效 |
| `dpidLambda` | `number` | `1.0`（0 退化为 box） | DPID 细节权重指数 |
| `despeckle` | `boolean` | `false` | 清理 <2 格的杂点 |
| `dither` | `boolean` | `false` | Floyd–Steinberg 抖动 |
| `maxColors` | `number` | — | 最终色号上限（限色） |
| `minBeads` | `number` | `0` | 稀有色合并阈值（0/1=关） |

### 管线顺序

```
1. cropToSubject（可选）
2. chooseGrid → toGrid（BOX 面积平均）
3. floodRemoveBg（可选）
4. matchDirectData / matchDitherData（CIEDE2000 最近色）
5. despeckle（可选）
6. limitColorsIdx（若 maxColors>0）
7. mergeRareIdx（若 minBeads>1）
8. 输出 Grid
```

注意：`despeckle → limitColorsIdx → mergeRareIdx` 的顺序会影响最终色数；`--max-colors 10 --min-beads 20` 时可能最终 <10。

### 导出 helpers

`src/beadpattern/core.ts` 另导出：`buildBeadPalette`, `toGrid`, `cropToSubject`, `cropToAspectAligned`, `floodRemoveBg`, `matchDirectData`, `matchDitherData`, `despeckle`, `limitColorsIdx`, `mergeRareIdx`, `GridRgba`。

## 渲染

### Node 渲染（sharp）— `src/render/node.ts`

```ts
import { renderPatternPng, renderPatternSvg, countGridMaterials } from 'mirrorpin-core';
// 或 import { renderPatternPng } from 'mirrorpin-core/render-node';

const svg: string = renderPatternSvg(grid, opts);
const png: Buffer = await renderPatternPng(grid, opts);
const rows: MaterialRow[] = countGridMaterials(grid); // { code, hex, count } 按用量降序
```

`RenderNodeOptions`:

| 字段 | 类型 | 默认 |
|---|---|---|
| `cell` | `number` | 40 |
| `board` | `number` | 29 |
| `codeFont` | `number` | 14 |
| `coordFont` | `number` | 12 |
| `showCodes` | `boolean` | true |
| `showCoords` | `boolean` | true |
| `textThreshold` | `number` | 140 |
| `legend` | `boolean` | false（CLI 默认 true） |
| `title` | `string` | — |
| `paletteName` | `string` | `MARD 291` |

`renderPatternSvg` 详见 `E:\M_Workbench\MirrorPin\src\render\node.ts`：标题栏 56px，图例行高 30px、列宽 196px，单列行数为 `floor((H - legendTop - 16) / 30)`，放不下自动分列。

### 浏览器渲染 — `src/render/pattern.ts`

```ts
import { renderPatternImage } from 'mirrorpin-core';
const rgba: RgbaImage = renderPatternImage(grid, opts);
```

`RenderPatternOptions.title: number` 为标题区高度（像素），与 `RenderNodeOptions.title: string` 同名异型。

### countGridMaterials

```ts
function countGridMaterials(grid: Grid): MaterialRow[] // { code, hex, count }[] 按 count 降序，同量按 code 升序
```

用于渲染图例与 CSV，两处共用同一统计，避免不一致。

## 其它模块

- `src/core/pipeline.ts`: `generatePattern` / `generatePatternMapFirst` / `generatePatternAdvanced` / `generatePatternSoft`（历史多管线，仅 `generatePatternBead` 为当前主线）。
- `src/core/preprocess.ts`: `boxBlur`, `gaussianBlur`。
- `src/core/subject.ts`: `estimateBackground`, `computeBBox`, `cropSquare`。
- `src/beadpattern/ciede2000.ts`: `srgbToLab`, `ciede2000`, `Lab`。
- `src/core/color.ts`: `srgbToOklab`, `oklabDistance`, `hexToRgb`, `rgbToHex`（Oklab 体系，bead 管线用 Lab/CIEDE2000）。
