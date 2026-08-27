# 前端 v1 交接文档 · MirrorPin 拼豆图纸（纯前端一次性成图）

> **面向**：前端工程师 / UI-UX 设计师 / 产品  
> **范围**：基于 `E:\M_Workbench\MirrorPin` 主干 `0.2.0`（默认管线 `L0 λ0.02 + DPID λ1.0`）的纯前端、一次性成图流程  
> **不做**：实时拖杆预览 / 逐格手改 / 后端存储与鉴权 / 批量队列 / 付费  

---

## 0. 一句话定位

用户上传一张图 → 选板子与少数可选项 → 点「生成」→ 拿到可直接拼的正式图纸与材料清单。所有计算在浏览器本地完成，图片与图纸不经过服务器。

---

## 1. 探查结论

### 1.1 管线事实（唯一真相源）

`E:\M_Workbench\MirrorPin\src\beadpattern\core.ts:generatePatternBead`

```
透明裁剪(cropToSubject) → 保边平滑(smooth: l0 | guided | gauss | none) → 固定板规裁铺满(fill, 仅 fixed) →
降采样(scale: dpid | box) → CIEDE2000 最近 MARD 色号 → 抖动(dither, 仅 auto) →
despeckle → limitColorsIdx → mergeRare(稀有合并) → Grid
```

- **板规是两条路**：`fixed {w,h}+fill:true` 直达目标尺寸并等比裁铺满（浏览器端走这条）；`maxSide` 的 auto 适配仅 CLI 保留。
- **平滑与降采样已入管线**：`smooth=l0(0.02) / l0soft(0.005) / guided(r=8,eps=100) / gauss(σ=1) / none`，`scale=dpid(box)`，默认 `l0+dpid`（四类素材最优）。新增 `fft.js`（MIT）仅供 L0 的频域求解。
- **去背景两级**：透明裁剪（主体外接框，`src/core/subject.ts`）与 CIEDE2000 连通泛洪（`removeBg=flood, tol=12`，仅改 alpha，不改色）。
- **其余量化与管线不进 v1**：`src/core/preprocess.ts` 的旧降色滑杆、`src/core/pipeline.ts` 四套 map 细粒度管线、`src/core/post.ts` 的 Oklab 分支均不参与。

### 1.2 全部可配参数全表

| 维度 | 参数 | 候选 | v1 归属 | 说明 |
|---|---|---|---|---|
| 板规 | `board: 52×52 / 78×78 / 104×104 / 78×52` | 4 档 | 暴露（主区） | 物理规格，用户按已有板子选 |
| 色卡 | `palette: mard291 / mard221` | 2 档 | 暴露（主区） | 直接影响可采购性；默认 `mard221`（标准色·更易买齐） |
| 稀有色合并 | `minBeads: 0 / 5 / 10` | 阈值 | 暴露（主区三档） | 体验最直观：少半包/一包料；文案见 3.3 |
| 抠白底 | `removeBg: flood / none` | 布尔 | 暴露（主区开关） | 白底 JPG 占比高，一键覆盖 80% 场景 |
| 降色预处理 | `colors/kColors: 16..96` | 滑杆 | 隐藏（已移除） | 旧值为省算力，现与 L0 耦合，已从 v1 去掉 |
| 平滑 | `smooth/smoothLambda/smoothSigma/smoothRadius/smoothEps` | 5 选 + 数参 | 折叠（高级） | 默认 `l0 (λ0.02)`，弱档 `l0soft (λ0.005)`；`guided r8/eps100`、`gauss σ1` 可展开 |
| 降采样 | `scale/dpidLambda` | `box/dpid`+λ | 折叠（高级） | 默认 `dpid λ1.0`（0 退化为 box），展开前隐藏 |
| 限色 | `maxColors` | 整数 | 折叠（高级） | 固定板规下不建议用；更直观的是稀有合并，限色仅给想严控色数的用户 |
| 抖动 | `dither` | 布尔 | 折叠（高级·默认关） | 破坏离散色数，与 `minBeads` 冲突 |
| 主体裁剪 | `cropToSubject` | 布尔 | 隐藏（固定 `true`） | 关掉会导致透明图整板留白，板界难解释 |
| 渲染规格 | `cell/board/gutter/title/show*` | 像素 | 折叠（高级） | 纸面默认 `cell40/board29`，普通用户无需感知 |
| 白底阈值 | `backgroundTolerance` | 数值 | 折叠（高级） | 去白底的 CIEDE2000 阈值，默认 12 |

> **结论**：主区 4 项 + 图片本身；其余 6 组收进**默认折叠的高级设置**，经 `E:\M_Workbench\MirrorPin\src\board.ts:TopLevelOptions.advanced` 展开。未展开时一律取最优默认。

### 1.3 前端顶层 API

`E:\M_Workbench\MirrorPin\src\board.ts`

```ts
export type BoardSpec = '52x52' | '78x78' | '104x104' | '78x52';
export const BOARD_PRESETS: Record<BoardSpec, { w: number; h: number; label: string }>;

export type PaletteId = 'mard291' | 'mard221';

export interface AdvancedOptions {
  smooth?: 'none'|'gauss'|'guided'|'l0';  // 默认 'l0'
  smoothLambda?: number;  // l0: 0.02（弱档 0.005）
  smoothSigma?: number;   // gauss: 1
  smoothRadius?: number;  // guided: 8
  smoothEps?: number;     // guided: 100
  scale?: 'box'|'dpid';   // 默认 'dpid'
  dpidLambda?: number;    // 1.0
  maxColors?: number;     // 不限则 undefined
  dither?: boolean;       // 默认 false
  despeckle?: boolean;    // 默认 false
  backgroundTolerance?: number; // 12
  renderCell?: number;    // 40
  renderBoard?: number;   // 29
}

export interface TopLevelOptions {
  board: BoardSpec;                 // 必填
  palette?: PaletteId;              // 默认 mard221
  minBeads?: number;               // 0|5|10，三档
  removeBg?: boolean;              // false=flood/none
  cropToSubject?: boolean;         // 默认 true
  advanced?: AdvancedOptions;      // 默认折叠，不传则取最优
}

import { generateForBoard } from '@lib/board';
const { grid } = generateForBoard(rgba, { board: '78x78', palette: 'mard221', minBeads: 5, removeBg: true });
// 需要精调时：generateForBoard(rgba, { board, advanced: { smooth: 'l0', smoothLambda: 0.005, scale: 'dpid' } })
```

内部映射：`board → fixed{ w,h }+fill:true → generatePatternBead({ palette, smooth='l0' lam0.02, scale='dpid' … }) → Grid`，`Grid` 直连 `renderPatternImage` 与 `countGridMaterials`。

### 1.4 现状与纯前端约束

- 现状 `E:\M_Workbench\MirrorPin\web\src\App.tsx`：文件选择（`createImageBitmap`）、250ms 防抖实时重算、3 滑杆（`maxSide/blur+sigma/kColors/crop`）、预览 `cell20` / 导出 `cell40` 的 `renderPatternImage`，无色卡/豆数/板规/抠白底。
- v1 改为提交式：上述滑杆全部移除，改为一次性表单 + 提交；`web/src/lib/decode.ts` 的 `createImageBitmap→canvas.getImageData` 解码链路保留，`web/src/lib/pipeline.ts` 的旧 kmeans 降色废弃。
- 全流程本地：`decodeImage` + `generateForBoard` + `renderPatternImage`/`countGridMaterials` 均在主线程（L0 的 FFT 约 956×696 需 ~8s，1024² 约 50s，需预留 loading 与取消）。
- 约束：**不把图片与图纸发到服务器**，服务器不存储、不画像、不埋点。`web` 为独立 Vite 项目（`@lib → ../src`，`E:\M_Workbench\MirrorPin\web\package.json` 与根 `fft.js ^4.0.4` 已同步）。

---

## 2. 用户流程（一次设置一次导出）

```
上传图片（拖拽/选择，PNG/JPG/WebP）
  ↓
选板规 / 色卡 / 复杂度(三档) / 抠白底开关
  ↓（按需展开高级）
高级设置（默认折叠）：平滑 / 降采样 / 限色 / 抖动 / 渲染 / 阈值
  ↓
点击「生成图纸」→ loading（可取消）
  ↓
展示正式图纸（网格/色号/坐标/板界/标题与右侧清单面板）+ 信息条
  ↓
「下载图纸 PNG」与「下载清单 CSV」并列（清单含 W×H / N色 / 合计M豆 / 色卡名）
  ↓
可返回改参重出图；不提供逐格手改
```

- 输出规格：固定板规 `fill` 裁铺满，`renderPatternImage` 自带标题与清单；CSV 形如 `code,hex,count`。
- 实验产物（不进主干）：`E:\M_Workbench\MirrorPin\output\exp-step1-smooth-dpid\<exp>\sheet.png` 等已用于定版默认 `l0+dpid`。

---

## 3. 界面与交互

### 3.1 页面结构（单页四段式）

1. **输入区**：拖拽 + 选择按钮，支持 PNG/JPG/WebP；上传后显示缩略、文件名与像素尺寸；空态有示例图。
2. **参数区（主）**：板规四卡片 + 色卡下拉 + 复杂度三档 + 抠白底开关（见 3.2–3.4）。
3. **高级区（默认折叠）**：标题「高级设置 ▸」，展开后分组——平滑 / 降采样 / 限色 / 抖动 / 渲染 / 白底阈值（见 3.5），每项有默认值小字与「恢复默认」。
4. **动作与结果区**：`生成图纸`（主按钮，生成中为 loading）；成功后出现信息条 `W×H 格 · N 色 · 合计 M 豆 · 色卡 MARD ***`，以及 `下载图纸 PNG` / `下载清单 CSV`；图纸区域可滚动查看，无缩放编辑。

### 3.2 板规组件

四张卡片等宽：`52×52`、`78×78（单板）`、`104×104（双板）`、`78×52（非标）`。内部传 `TopLevelOptions.board`，渲染以 `board=29` 为板界刻度。`78×52` 加「非标」角标并写清 `78×52` 比例。

### 3.3 主参数文案与校验

- 色卡：`MARD 221（标准·推荐，易购）` / `MARD 291（含扩展 70 色）`，下拉默认 221，副文案“标准色更易买齐”。
- 复杂度：`标准 | 颜色更少(−5豆色) | 颜色最少(−10豆色)`，默认“标准”，对应 `minBeads 0/5/10`。
- 抠白底：开关默认开，副文案“去掉纸上的白底”。说明小字“若浅发末梢被误合，请关闭重试”（`backgroundTolerance` 默认为 12 的折衷）。
- 校验：未选图禁用生成；生成失败（内存/尺寸异常）toast + 重试；尺寸合法性由 `generateForBoard` 内 `Grid` 保证。

### 3.4 性能体感

- 中图 L0+DPID 在 956×696 约 8s，1024² 约 50s（fullscreen FFT）；需骨架屏与“稍等一下”文案，不做实时滑杆刷新。
- 104×104 近 11k 格，生成后滚动查看即可，无需编辑。`renderPatternImage` 在该尺度下 0.2s 内完成。

### 3.5 高级设置（默认折叠）

| 分组 | 控件 | 默认 | 说明 |
|---|---|---|---|
| 平滑 | 单选：`l0 标准` / `l0 弱` / `引导滤波` / `高斯` / `关` | `l0 标准 (λ0.02)` | 弱档对应 `λ0.005`；引导 `r8/eps100`；高斯 `σ1` |
| 降采样 | 单选：`DPID` / `BOX` | `DPID (λ1.0)` | `DPID` 细节保真，`BOX` 为等效回退 |
| 限色 | 数字输入（可空） | 不限 | 固定板规下一般不填；填则严控色数 |
| 抖动 | 开关 | 关 | 与限色/稀有合并冲突，默认关 |
| 去杂 | 开关 `despeckle` | 关 | 对应后处理 `<2格` 杂点清理 |
| 渲染 | `cell` / `board` | `40 / 29` | 纸面规格，改动仅影响出图排版 |
| 白底阈值 | `backgroundTolerance` | `12` | CIEDE2000 阈值，越大越“抠得干净”但易误抠 |

每项带默认值小字与「恢复默认」链路；收起时不参与生成。

### 3.6 隐私与合规（向用户承诺）

页脚常驻一句话：**“全程本地计算，图片与图纸不上传到服务器；服务器不存储、不记录。”** 链接到本节。后续若接入匿名访问统计，需另行告知（不含图像内容）。

---

## 4. 工程交接

- **算法入口**：`E:\M_Workbench\MirrorPin\src\board.ts:generateForBoard`（板规与色卡映射已定；其余 16 项在 `advanced` 折叠中）。
- **渲染**：`E:\M_Workbench\MirrorPin\src\render\pattern.ts:renderPatternImage`（浏览器位图字体，零依赖；清单来自 `E:\M_Workbench\MirrorPin\src\render\node.ts:countGridMaterials`）。
- **解码**：沿用 `E:\M_Workbench\MirrorPin\web\src\lib\decode.ts` 的 `createImageBitmap`；`web/src/lib/pipeline.ts` 的旧 kmeans 路径废弃。
- **构建**：`web` 为 Vite+React 独立项目（`fft.js` 已在两级 `package.json` 同步为 `^4.0.4`），`tsconfig` 的 `@lib → ../src` 保持。
- **产研边界**：下一步预研 `Gerstner 网格级能量优化`（`E:\M_Workbench\MirrorPin\experiments\exp-step2-grid-energy` 待建）与本版 `L0+DPID` 递进，不阻塞 v1。

---

## 5. 待 UI/UX 确认

1. 复杂度三档用词与结果区是否同步显示“已合并 X 色”；
2. 抠白底的默认态与文案；
3. 板规四卡片的排布与非标角标；
4. 高级设置中平滑分组的 5 选呈现（单选/下拉）与「恢复默认」交互；
5. 隐私承诺的露出位置与 wording。

---

## 6. 验收清单

- [ ] 上传 PNG/JPG/WebP 均可解码并显示缩略；
- [ ] 四板规均可生成且尺寸与板界正确（`fixed+fill` 铺满）；
- [ ] 默认（不展开高级）等价于 `l0(λ0.02)+dpid(λ1.0)` 且与 CLI 默认一致；
- [ ] 高级展开后改参可生效且可一键恢复默认；
- [ ] 生成中可取消/重试，完成后可下载 PNG 与 CSV（含信息条）；
- [ ] 页脚含本地计算隐私承诺；
- [ ] 构建 `E:\M_Workbench\MirrorPin\web` 可 `npm run dev / build` 通过。
