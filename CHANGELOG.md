# Changelog

格式基于 [Keep a Changelog](https://keepachangelog.com/)，版本遵循 [SemVer](https://semver.org/)。

## [0.2.0] - 2026-08-27

### Added
- 保边平滑：`l0Smooth` (L0 梯度最小化，λ=0.02/弱档 0.005) / `guidedSmooth` (引导滤波，r=8/eps=100) / `gaussianBlur`，统一接入 `generatePatternBead({ smooth, smoothLambda/smoothSigma/smoothEps })`
- 保细节降采样：`dpidDownscale` (λ=1.0，0 退化为 box)，统一接入 `generatePatternBead({ scale, dpidLambda })`
- CLI：`--smooth` / `--smooth-sigma` / `--scale`（默认 `l0+dpid`，`--blur`/`--no-blur` 兼容旧参），`--help` 同步

### Changed
- 默认管线由 `gauss+box` 切换为 `l0+dpid`（四类素材实验验证：赛璐璐上色/线稿梗图/文字信息图/低饱和粉彩均第一梯队）
- 版本 `0.1.0 → 0.2.0`，新增依赖 `fft.js` (MIT)

### Notes
- L0 在 1024² 上约数秒（FFT，2048² 需 padding）；后续可提供“降至 512 再做 L0”快速路径
- 实验目录 `experiments/` 与 `output/exp-*` 已入 `.gitignore`，跨图对比 `exp-step1-smooth-dpid/<exp>/sheet.png`

## [0.1.0] - 2026-08-27

### Added
- 转像素主管线 `generatePatternBead`（BOX 面积平均 + CIEDE2000 + 主体裁剪 + despeckle/限色）
- MARD 291/221 色卡（`MARD291` 291 色，`MARD221` 221 色标准 A–H/M 子集）
- 稀有色合并 `mergeRareIdx` / `--min-beads`
- 正式图纸渲染（SVG+sharp 与位图字体双渲染器）及图例/标题栏（`--palette`/`--no-legend`）
- CLI：`--max-side/--blur/--colors/--max-colors/--min-beads/--remove-bg/--despeckle/--dither/--board/--palette/--no-legend/--help/--version`，CSV `code,hex,count`
- 测试 68 项，构建（tsup + esbuild）与类型声明

### Changed
- README 与 CLI 选项表对齐，示例改用 `E:\` 绝对路径

## [Unreleased]
- 预留：preprocess 共享化、countGridMaterials 统一、limitColorsIdx/mergeRareIdx 合并为通用 mergeByCount、CI/lint/format
