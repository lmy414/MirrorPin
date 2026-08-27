# Changelog

格式基于 [Keep a Changelog](https://keepachangelog.com/)，版本遵循 [SemVer](https://semver.org/)。

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
