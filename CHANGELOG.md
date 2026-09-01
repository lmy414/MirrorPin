# Changelog

格式基于 [Keep a Changelog](https://keepachangelog.com/)，版本遵循 [SemVer](https://semver.org/)。

## [0.3.0] - 2026-09-01

### Added

- 线性光、Alpha-aware 精确面积采样与统一 `GridSamples`（coverage、variance、edgeX、edgeY）。
- 每格 top-K MARD CIEDE2000 候选和确定性边缘敏感 Potts/ICM 空间优化。
- 置信度/边缘感知连通分量清理，以及能量感知 `maxColors`、空间分量级 `minBeads`。
- 统一 operation budget、阶段 timing、能量拆分与 before/after fragmentation diagnostics。
- `standard / less / minimal` 三种可序列化质量 profile。
- Webapp 与 minitool 共享 Worker 协议、requestId、真实阶段进度、取消和 algorithm version。
- IndexedDB schema v2 保存图片、参数、Grid、diagnostics 和版本。
- 可重复验收矩阵：mean/P95 CIEDE2000、碎片、flat transition、edge F1、thin-line recall、颜色数、耗时、内存和三次确定性 SHA-256。
- 完全自包含 Webapp 部署 ZIP，含根 `index.html` 与 `/generating`、`/result`、`/error` 物理路由别名，不再依赖 Tailwind/Lucide CDN 或 SPA rewrite。
- README 增加示例图片及 104×104、78×78、52×52 三种板规的拼豆图纸输出展示。

### Changed

- 产品默认切换为 `guided + area + spatial on + top-K 8`；默认预降色和抖动关闭。
- Alpha 标签域统一为 `coverage >= 0.5` / `alpha >= 128`，连续 coverage 继续用于物理颜色积分。
- 主体 mask 在裁剪和平滑之前建立；透明隐藏 RGB 不再污染边缘。
- fixed/fill 的 DPID 与 area 直接输出目标板规，不再绕过或二次 BOX。
- CLI、Webapp、minitool 和公共 board API 统一走 `generatePatternBead()` 主管线。
- 版本统一由 `ALGORITHM_VERSION = 0.3.0` 提供。

### Compatibility

- `generatePatternBead()` 旧字段继续接受。
- `box` 作为面积采样兼容名保留。
- `src/core/pipeline.ts`、`despeckle`、`limitColorsIdx`、`mergeRareIdx` 保留 legacy 导出，但不再是产品默认路径。

## [0.2.0] - 2026-08-27

### Added

- L0、Guided、高斯保边平滑与 DPID 降采样。
- CLI `--smooth`、`--smooth-sigma`、`--scale`。

## [0.1.0] - 2026-08-27

### Added

- `generatePatternBead()`、MARD 291/221、正式 PNG/CSV、材料清单、基础 CLI 与后处理。
