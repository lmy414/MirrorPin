# MirrorPin API 0.3.0

本文档面向 `mirrorpin-core` 使用者。产品入口统一为 `generatePatternBead()` 或板规封装 `generateForBoard()`。

## 数据类型

```ts
interface RgbaImage { width: number; height: number; data: Uint8ClampedArray }
interface Swatch { code: string; hex: string }
interface Cell { code: string; hex: string; external: boolean }
interface Grid { rows: number; cols: number; cells: Cell[][]; colorCount: number }
```

Alpha 契约：连续 coverage 用于采样；`coverage >= 0.5`（源 Alpha 128）才是有效拼豆格。透明隐藏 RGB 不参与平滑、面积积分或 DPID。

## 色卡

```ts
import { MARD291, MARD221 } from 'mirrorpin-core';
MARD291.length; // 291
MARD221.length; // 221，A-H/M 标准子集
```

## generatePatternBead

```ts
const grid = generatePatternBead(image, {
  palette: MARD221,
  fixed: { w: 78, h: 78 },
  fill: true,
  cropToSubject: true,
  smooth: 'guided',
  scale: 'area',
  spatial: { enabled: true, topK: 8, smoothness: 0.35 },
});
```

### 主要 BeadOptions

| 字段 | 类型 | clean 默认 | 说明 |
|---|---|---|---|
| `palette` | `readonly Swatch[]` | MARD291 | 色卡 |
| `maxSide` | number | 50 | auto 网格最大边长 |
| `fixed` | `{w,h}` | — | 固定板规 |
| `fill` | boolean | false | fixed 时按比例裁铺满 |
| `cropToSubject` | boolean | false | 按 source foreground mask 裁主体 |
| `removeBg` | `none\|flood` | none | 源图安全置信度背景 flood |
| `backgroundTolerance` | number | 12 | flood 的 CIEDE2000 阈值 |
| `smooth` | `none\|gauss\|guided\|l0` | guided | mask-aware 平滑 |
| `scale` | `area\|box\|dpid` | area | 目标网格采样；box 为 area 兼容名 |
| `colorQuantize` | `{colors,...}` | — | 可选确定性预降色，默认关闭 |
| `spatial` | `Partial<SpatialQuantizeOptions>` | 开启 | top-K + Potts/ICM + cleanup |
| `maxColors` | number | — | 能量感知最终色号预算 |
| `minBeads` | number | 0 | 空间分量级稀有色合并 |
| `dither` | boolean | false | legacy 风格分支；不能与 spatial 同开 |
| `maxOperations` | number | 自动 | cleanup/color-budget 共享实时预算 |
| `diagnostics` | `BeadDiagnostics` | — | 写入 timing、energy、fragmentation 等 |
| `onProgress` | `(event)=>void` | — | `prepare/resample/candidates/optimize/cleanup/done` |
| `shouldCancel` | `()=>boolean` | — | 阶段边界取消检查 |
| `onDetailedResult` | `(details)=>void` | — | library-only 验收 hook，不序列化到 Worker |

### SpatialQuantizeOptions

```ts
interface SpatialQuantizeOptions {
  enabled?: boolean;          // true
  topK?: number;              // 8
  smoothness?: number;        // 0.35
  edgeSigma?: number;         // 0.12
  maxIterations?: number;     // 6
  cleanupMaxSize?: number;    // 2
  cleanupConfidence?: number; // 0.25
}
```

能量：

```text
E = Σ CIEDE2000_data_cost(cell, label)
  + λ Σ exp(-0.5 * (sourceEdge / edgeSigma)^2) * [neighbor labels differ]
```

相同能量使用确定性 tie-break；同输入与参数生成相同 Grid。

### 管线顺序

```text
foreground/background mask
→ subject/aspect crop
→ hidden-RGB extension
→ optional smooth
→ optional pre-quantize
→ exact area/DPID GridSamples
→ top-K CIEDE2000 candidates
→ deterministic Potts/ICM
→ confidence-aware region cleanup
→ energy-aware maxColors/minBeads
→ Grid + diagnostics
```

## Diagnostics

`PipelineDiagnostics` 包含：

- before/after `colorCount`、singleton/small-component ratio；
- `fragmentationBefore/After`（component、boundary、adjacency、valid cells）；
- optimizer/cleanup/color-budget/total energy；
- optimizer iterations；
- stage order 和 stage timings；
- resample/integration passes；
- operation budget 和各阶段操作数；
- total time。

## Board API 与质量档

```ts
const result = generateForBoard(image, {
  board: '78x78',
  palette: 'mard221',
  ...resolveQualityProfile('less'),
});
```

板规：`52x52 / 78x78 / 104x104 / 78x52`。

质量档：

- `standard`：`minBeads=0`，spatial 0.35。
- `less`：`minBeads=5`，spatial 0.48，提高 cleanup confidence。
- `minimal`：`minBeads=10`，spatial 0.62，`maxColors=48`。

`generateForBoard(image, options, runtime)` 的 runtime 可传 diagnostics、progress 和 cancellation hook。

## Worker 协议

输入：

```ts
{ type: 'generate', requestId, img, params }
{ type: 'cancel', requestId }
```

输出：

```ts
{ type: 'progress', requestId, stage, progress, elapsedMs, algorithmVersion }
{ type: 'done', requestId, grid, diagnostics, elapsedMs, algorithmVersion }
{ type: 'cancelled', requestId, algorithmVersion }
{ type: 'error', requestId, message, algorithmVersion }
```

图片 `Uint8ClampedArray.buffer` 可作为 transferable 发送。消费端必须按 `requestId` 丢弃 stale result。

## 渲染与材料

```ts
const png = await renderPatternPng(grid, { legend: true, paletteName: 'MARD 221' });
const rgba = renderPatternImage(grid, { cell: 40, board: 29 });
const materials = countGridMaterials(grid);
```

`countGridMaterials()` 返回 `{code,hex,count}[]`，按用量降序、同量按 code 升序；Node 与浏览器渲染器共同使用。

## 验收 API

```ts
const fixture = createAcceptanceFixture('text-lines', 78, 52);
const metrics = computeAcceptanceMetrics(samples, labels, fixture.palette, fixture.truth);
const canonical = canonicalGridString(grid);
```

指标包括 mean/P95 CIEDE2000、fragmentation、flat transitions、edge precision/recall/F1、thin-line label recall、颜色数与低用量色数。

## Legacy

`generatePattern*` 四套旧入口、`despeckle`、`limitColorsIdx`、`mergeRareIdx` 继续导出以兼容旧代码。新产品应只使用 `generatePatternBead()` / `generateForBoard()`。
