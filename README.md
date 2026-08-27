# MirrorPin · 拼豆图纸生成工具

把任意图片转成**可采购的拼豆图纸**：降噪预处理 → 转像素（CIEDE2000 感知配色）→ 输出带色号/坐标的正式图纸 PNG 与材料清单 CSV。

项目同时提供**算法库**（纯 TS，无 DOM 依赖，浏览器/Node 通用）与**命令行工具 CLI**；浏览器前端在 `web/` 目录，M1 迭代中。

## 特性

- **预处理**：内置 L0 梯度最小化 / 高斯 / 引导滤波（默认 L0 λ=0.02，保边压平，平坦区自动归零、强边保留锐化），后续可扩展。
- **转像素**：以 TS 忠实重写 [bead-pattern](https://github.com/wuZHeBoy/bead-pattern) 的整套思路——主体裁剪、保细节降采样（DPID，细节权重偏离均值越大越高）、完整 **CIEDE2000** 感知配色、网格级去背景、despeckle 除杂、limit_colors 限色、稀有色合并。
- **固定色卡**：内置 **MARD 291** 官方瓶身色号（如 `A1`/`B5`），另可切换 **MARD 221** 标准色卡（A–H/M 系列 221 色）；输出可直接按色号采购。
- **输出**：正式图纸 PNG（标题栏 + 每格色号 + 坐标 + 网格线 + 板界 + **内嵌材料清单**）+ 材料清单 CSV。
- **稀有色合并**：`--min-beads` 把用量过少的色号就近并入 CIEDE2000 最近的在用色，避免“买一包只用一两颗”。

## 技术栈

| 层 | 技术 |
|---|---|
| 核心 | TypeScript，纯计算无 DOM 依赖（浏览器/Node 皆可用） |
| CLI 渲染 | sharp（native，仅 Node 端用于 PNG 编码/解码） |
| 构建 | tsup（库）+ esbuild（CLI） |
| 测试 | vitest |

## 安装

```bash
npm install          # 安装依赖（含 sharp 原生模块，需良好网络；Windows 下若失败可重试）
npm run build        # 产出 dist/（库 + cli.js）
npm test             # 运行测试
```

## CLI 用法

```bash
node E:\M_Workbench\MirrorPin\dist\cli.js <input> -o <output.png> [选项]
node E:\M_Workbench\MirrorPin\dist\cli.js <input> --materials <清单.csv> [选项]
node E:\M_Workbench\MirrorPin\dist\cli.js --help       # 查看帮助
node E:\M_Workbench\MirrorPin\dist\cli.js --version    # 查看版本
```

### 选项

| 选项 | 说明 | 默认 |
|---|---|---|
| `-o, --output <path>` | 输出图纸 PNG | 必填（与 --materials 二选一） |
| `--materials <path>` | 输出材料清单 CSV（表头 `code,hex,count`） | 不输出 |
| `--max-side <n>` | 网格最大边长（另一边按比例），需为正整数 | 64 |
| `--blur <sigma>` | 高斯模糊强度（正数；`0` 表示关闭） | 1 |
| `--no-blur` | 关闭模糊 | — |
| `--smooth <kind>` | 保边平滑（默认 `l0`）：`none/gauss/guided/l0/l0soft`；`--smooth-sigma` 调参（gauss=σ，l0/l0soft=λ，guided=eps） | l0 |
| `--scale <kind>` | 降采样：`box`（面积平均）/ `dpid`（保细节，默认） | dpid |
| `--colors <n>` | 预处理降色数（0=不降色） | 64 |
| `--max-colors <n>` | 最终色号上限 | 不限制 |
| `--min-beads <n>` | 稀有色合并：用量 < n 的色号并入 CIEDE2000 最近在用色 | 不合并 |
| `--remove-bg <none\|flood>` | 网格级按颜色清纯背景（flood 用 CIEDE2000 阈值 12） | none |
| `--no-crop` | 关闭透明通道裁剪 | 默认裁剪 |
| `--despeckle` | 清理 <2 格的杂点 | 关 |
| `--dither` | 抖动（照片渐变用，会导致色号增多） | 关 |
| `--board <n>` | 板界线间隔 | 29 |
| `--palette <name>` | 色卡：`mard291`（含扩展 70 色）/ `mard221`（标准 A-H/M 221 色） | mard291 |
| `--no-legend` | 关闭图纸内嵌材料清单面板 | 默认开启 |
| `-h, --help` | 显示帮助 | — |
| `-V, --version` | 显示版本 | — |

### 示例

```bash
# 生成图纸 + 材料清单
node E:\M_Workbench\MirrorPin\dist\cli.js "E:\Downloads\Q13_peek_探头.png" -o "E:\M_Workbench\MirrorPin\output\Q13_pattern.png" --materials "E:\M_Workbench\MirrorPin\output\Q13_materials.csv" --max-side 64 --blur 2 --colors 48

# 只用材料清单，不输出图纸
node E:\M_Workbench\MirrorPin\dist\cli.js "E:\Downloads\Q13_peek_探头.png" --materials "E:\M_Workbench\MirrorPin\output\Q13_materials.csv"

# 标准 221 色卡 + 稀有色合并 + 关闭模糊
node E:\M_Workbench\MirrorPin\dist\cli.js "E:\Downloads\Q13_peek_探头.png" -o "E:\M_Workbench\MirrorPin\output\Q13_pattern_mard221.png" --materials "E:\M_Workbench\MirrorPin\output\Q13_materials_mard221.csv" --palette mard221 --min-beads 5 --no-blur --colors 0
```

### 图纸说明

- 每格居中色号（亮底黑字/暗底白字），四周行列坐标（每 5 格标注），网格线每格细线/每 10 格粗线/板界红线，背景透明区为浅棋盘。
- 顶部标题栏：`MirrorPin 拼豆图纸 · W×H 格 · N 色 · 合计 M 豆 · 色卡 MARD 291/221`。
- 右侧材料清单面板：色块 + 色号 + 色值 + 用量（×n），按用量降序，单列放不下自动分列；副标题 `MARD 291/221 · N 色 · 合计 M 颗`。
- CSV 表头 `code,hex,count`，如 `C29,#4B5BA3,619`。

## 算法库

入口 `src/index.ts`。核心导出：`generatePatternBead`（转像素主管线；`smooth: l0|guided|gauss|none` + `scale: dpid|box`，M1 起默认 `l0+dpid`）、`l0Smooth`/`guidedSmooth`/`dpidDownscale`/`gaussianBlur`（预处理/降采样）、`renderPatternPng`/`renderPatternSvg`/`countGridMaterials`（渲染与统计）、`MARD291`/`MARD221`（色卡）。

```ts
import {
  generatePatternBead,
  MARD291,
  MARD221,
  gaussianBlur,
  renderPatternPng,
  countGridMaterials,
} from 'mirrorpin-core';

const grid = generatePatternBead(image, {
  palette: MARD221,        // 或 MARD291
  maxSide: 72,             // 库默认 50，CLI 默认 64
  cropToSubject: true,
  despeckle: false,
  maxColors: undefined,    // 不限色
  minBeads: 5,             // 稀有色合并阈值
});
const png = await renderPatternPng(grid, { legend: true, paletteName: 'MARD 221' });
const rows = countGridMaterials(grid); // { code, hex, count }[]
```

### 管线

```
预处理(保边平滑 L0/引导/高斯，可关) → 只按透明通道裁主体(有背景则带上)
→ 降采样到网格（DPID 保细节，BOX 等价口径可回退）→ CIEDE2000 最近色号
→ (可选) despeckle 去杂 / limit_colors 限色 / 稀有色合并(mergeRareIdx) / dither
→ 正式图纸渲染(色号+坐标+网格+板界+图例) + 材料清单
```

后处理顺序：`despeckle → limitColorsIdx → mergeRareIdx`；详见 `docs/API.md`。

### 双渲染器

| 模块 | 用途 | 依赖 |
|---|---|---|
| `src/render/node.ts` | Node/CLI：SVG + sharp 真 TTF 抗锯齿，含图例/标题栏 | sharp |
| `src/render/pattern.ts` | 浏览器/内存：位图字体，自包含零依赖 | 无 |

`RenderNodeOptions.title: string`（标题文字）与 `RenderPatternOptions.title: number`（标题区高度像素）同名异型，见 `docs/API.md`。

## 目录结构

```
src/
  beadpattern/   # CIEDE2000 + 转像素核心（TS 重写自 bead-pattern 思路）
  core/          # 类型 / 颜色 / 量化 / 采样 / 预处理 / 后处理
  palettes/      # MARD 291/221 色卡
  render/        # 正式图纸渲染（node/sharp + 浏览器/内存）
cli/             # CLI 入口
web/             # 浏览器前端（M1，Vite + React，独立 npm 项目，见 web/README.md）
tests/           # 单元测试
docs/
  API.md         # 算法库 API
  design/M0-review.md  # M0 归档文档
```

## 浏览器前端（web）

`web/` 为独立 Vite 项目（非 npm workspaces），通过 `@lib -> ../src` 别名复用算法库。

```bash
cd E:\M_Workbench\MirrorPin\web
npm install
npm run dev      # 本地预览
npm run build    # 生产构建
```

当前 `web/src/App.tsx` 为基础预览（上传→参数→预览→导出），`konva`/`react-konva` 已安装但尚未接入，仍为 Canvas 2D 直绘；后续迭代接入。

## 版权与致谢

本项目遵循 **MIT License**（见 `LICENSE`）。

### 借鉴来源（MIT，特此致谢）

- **[bead-pattern](https://github.com/wuZHeBoy/bead-pattern)（MIT）** —— 转像素算法的整体思路与实现被本项目**以 TypeScript 重写**：主体裁剪 `crop_to_subject`、`Image.BOX` 面积平均降采样、完整 `CIEDE2000` 配色、`flood_remove_bg` 去背景、`despeckle`/`limit_colors` 后处理。重写保留其原始 MIT 版权声明。
- **[pyxelate](https://github.com/sedthh/pyxelate)（MIT）** —— 调研阶段仅作试跑参考，未进入正式管线。

### 运行时依赖（新增 fft.js 用于 L0 的频域求解，MIT）及其许可

| 依赖 | 许可 | 用途 |
|---|---|---|
| sharp | Apache-2.0 | CLI/Node 端图片编解码与 PNG 渲染 |
| esbuild | MIT | CLI 打包 |
| tsup | MIT | 库打包 |
| vitest | MIT | 测试 |
| TypeScript | Apache-2.0 | 语言 |

web 端依赖 react/react-dom/konva/react-konva/vite（均 MIT），见 `E:\M_Workbench\MirrorPin\web\package.json`。

### 色卡数据声明

`MARD 291` 色号与 RGB 值为**事实型数据**，转录自公开色卡资料（pixel-beads / bitbead 等），非本项目的原创代码。商品实色以实物色卡为准，图纸中标注为近似色。`MARD221` 为其子集（A–H/M 系列）。

## License

[MIT](./LICENSE)
