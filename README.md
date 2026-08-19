# MirrorPin · 拼豆图纸生成工具

把任意图片转成**可采购的拼豆图纸**：降噪预处理 → 转像素(CIEDE2000 感知配色) → 输出带色号/坐标的正式图纸 PNG 与材料清单 CSV。

项目同时提供**算法库**(纯 TS) 与 **命令行工具 CLI**，浏览器前端(M1)在后续迭代。

## 特性

- **预处理**：高斯模糊（σ 可调、可开关），降杂色；后续可扩展双边/引导滤波等算法。
- **转像素**：以 TS 忠实重写 [bead-pattern](/d:/claude/MirrorPin) 的整套思路——主体裁剪、Image.BOX 面积平均降采样、完整 **CIEDE2000** 感知配色、网格级去背景、despeckle 除杂、limit_colors 限色。
- **固定色卡**：内置 **MARD 291** 官方瓶身色号(如 `A1`/`B5`)，输出可直接按色号采购。
- **输出**：正式图纸 PNG（每格色号 + 坐标 + 网格线 + 板界）+ 材料清单 CSV。

## 技术栈

- 核心：TypeScript，纯计算无 DOM 依赖（浏览器/Node 皆可用）。
- CLI 渲染：sharp（native，仅 Node 端用于 PNG 编码/解码）。
- 构建：tsup（库）+ esbuild（CLI）。

## 安装

```bash
npm install
npm run build   # 产出 dist/（库 + cli.js）
```

## CLI 用法

```bash
node dist/cli.js <input.png> -o out.png [选项]
```

常用选项：

| 选项 | 说明 | 默认 |
|---|---|---|
| `-o, --output <path>` | 输出图纸 PNG | 必填 |
| `--materials <path>` | 输出材料清单 CSV | 不输出 |
| `--max-side <n>` | 网格最大边长（另一边按比例） | 64 |
| `--blur <sigma>` | 高斯模糊强度 | 1 |
| `--no-blur` | 关闭模糊 | — |
| `--colors <n>` | 预处理降色数（0=不降色） | 64 |
| `--max-colors <n>` | 最终色号上限 | 不限制 |
| `--remove-bg <none\|flood>` | 网格级按颜色清纯背景 | none |
| `--no-crop` | 关闭透明通道裁剪 | — |
| `--despeckle` | 清理 <2 格的杂点 | 关 |
| `--dither` | 抖动（照片渐变用，会导致色号增多） | 关 |
| `--board <n>` | 板界线间隔 | 29 |

示例：

```bash
# 生成图纸 + 材料清单
node dist/cli.js input.png -o out.png --materials shopping.csv --max-side 64 --blur 2 --colors 48

# 只用材料清单，不输出图纸
node dist/cli.js input.png --materials shopping.csv
```

## 算法库

入口 `src/index.ts`。核心：`generatePatternBead`（转像素主管线）、`gaussianBlur`（预处理）、`renderPatternPng`（正式图纸 PNG）、`MARD291`（色卡）。

```ts
import { generatePatternBead, MARD291, gaussianBlur } from 'mirrorpin-core';
```

## 目录结构

```
src/
  beadpattern/   # CIEDE2000 + 转像素核心（TS 重写自 bead-pattern 思路）
  core/          # 类型 / 颜色 / 量化 / 采样 / 预处理 / 后处理
  palettes/      # MARD 291 色卡
  render/        # 正式图纸渲染（node/sharp + 浏览器/内存）
cli/             # CLI 入口
web/             # 浏览器前端（M1，迭代中）
```

## 版权与致谢

本项目遵循 **MIT License**（见 `LICENSE`）。

### 借鉴来源（MIT，特此致谢）

- **[bead-pattern](https://github.com/wuZHeBoy/bead-pattern)（MIT）** —— 转像素算法的整体思路与实现被本项目**以 TypeScript 重写**：主体裁剪 `crop_to_subject`、`Image.BOX` 面积平均降采样、完整 `CIEDE2000` 配色、`flood_remove_bg` 去背景、`despeckle`/`limit_colors` 后处理。重写保留其原始 MIT 版权声明。
- **[pyxelate](https://github.com/sedthh/pyxelate)（MIT）** —— 调研阶段仅作试跑参考，未进入正式管线。

### 运行时依赖及其许可

| 依赖 | 许可 | 用途 |
|---|---|---|
| sharp | Apache-2.0 | CLI/Node 端图片编解码与 PNG 渲染 |
| esbuild | MIT | CLI 打包 |
| tsup | MIT | 库打包 |
| vitest | MIT | 测试 |
| TypeScript | Apache-2.0 | 语言 |

web 端依赖 react/react-dom/konva/react-konva/vite（均 MIT），见 `web/package.json`。

### 色卡数据声明

`MARD 291` 色号与 RGB 值为**事实型数据**，转录自公开色卡资料（pixel-beads / bitbead 等），非本项目的原创代码。商品实色以实物色卡为准，图纸中标注为近似色。

## License

[MIT](./LICENSE)