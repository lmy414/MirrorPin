// MirrorPin 算法内核（M0）公共出口

export { MARD291, MARD221, type MardSwatch } from './palettes/mard291';
export { ALGORITHM_VERSION } from './version';
export { QUALITY_PROFILES, resolveQualityProfile, type QualityProfileId, type QualityProfileOptions } from './product-profiles';
// MardSwatch 与 Swatch 同构，保留别名以兼容历史导入

export type {
  RGB,
  RgbaImage,
  AlphaPolicy,
  ColorQuantizeOptions,
  ResolvedColorQuantizeOptions,
  SpatialQuantizeOptions,
  PipelineDiagnostics,
  FragmentationSnapshot,
  Swatch,
  Cell,
  Grid,
} from './core/types';
export {
  DEFAULT_ALPHA_POLICY,
  DEFAULT_COLOR_QUANTIZE_OPTIONS,
  requireInteger,
  requireIntegerInRange,
  requirePositiveInteger,
  resolveAlphaPolicy,
  resolveColorQuantizeOptions,
  DEFAULT_SPATIAL_QUANTIZE_OPTIONS,
  resolveSpatialQuantizeOptions,
  DEFAULT_GENERATION_OPTIONS,
  GENERATION_PROFILES,
  type CanonicalGenerationOptions,
  type GenerationProfile,
} from './core/options';
export { isAlphaIncluded, cleanTransparentRgb, extendTransparentRgb } from './core/alpha';
export {
  buildForegroundMask,
  cropImageAndMaskRect,
  cropImageAndMaskToAspect,
  cropImageAndMaskToSubject,
  extendMaskedRgb,
  validateForegroundMask,
  type BuildForegroundMaskOptions,
  type ForegroundMask,
  type ImageMaskPair,
} from './core/background';
export {
  areaResampleToGrid,
  dpidResampleToGrid,
  fitResampleToGrid,
  gridSamplesToRgba,
  linearToSrgb,
  srgbToLinear,
  type DpidResampleOptions,
  type GridSamples,
  type ResampleOptions,
} from './core/resample';

export {
  srgbToOklab,
  oklabDistance,
  hexToRgb,
  rgbToHex,
  type Oklab,
} from './core/color';
export { sampleGrid, type SampleMode } from './core/grid';
export { buildPalette, nearestSwatch, type PaletteEntry } from './core/palette';
export { kmeansPalette, measureSpatialFragmentation, mulberry32, recoverEmptyCenters } from './core/quantize';
export { normalizeSwatches } from './core/palette';
export { deterministicSampleIndices, quantizeImage } from './core/color-quantize';
export { mergeRegions, removeBackground } from './core/post';
export {
  generatePattern,
  generatePatternMapFirst,
  generatePatternAdvanced,
  generatePatternSoft,
  type GenerateOptions,
  type MapFirstOptions,
  type AdvancedOptions as LegacyPipelineAdvancedOptions,
  type SoftOptions,
} from './core/pipeline';
export { boxBlur, gaussianBlur } from './core/preprocess';
export { applyMaskForSmoothing } from './core/smoothing';
export { l0Smooth, neumannGradient, neumannNegativeDivergence, applyNeumannSystem, solveNeumannSystem, l0MemoryBudget } from './core/l0';
export { guidedSmooth } from './core/guided';
export { dpidDownscale } from './core/dpid';
export { estimateBackground, computeBBox, cropSquare, type BBox, type BackgroundEstimate } from './core/subject';
export {
  generatePatternBead,
  buildBeadPalette,
  toGrid,
  cropToSubject,
  cropToAspectAligned,
  floodRemoveBg,
  matchDirectData,
  matchDitherData,
  despeckle,
  limitColorsIdx,
  mergeRareIdx,
  type BeadDiagnostics,
  type BeadOptions,
  type SmoothKind,
  type ScaleKind,
  type ResampleEvent,
  type ResampleHook,
  type GenerationDetails,
  type DetailedResultHook,
  type GenerationStage,
  type ProgressEvent,
  type ProgressHook,
} from './beadpattern/core';
export { srgbToLab, ciede2000, type Lab } from './beadpattern/ciede2000';
export { buildPaletteCandidates, validCell, type PaletteCandidates } from './core/palette-candidates';
export { optimizeSpatialLabels, type SpatialQuantizeResult } from './core/spatial-quantize';
export {
  analyzeLabelRegions,
  cleanupSpatialLabels,
  enforceSpatialColorBudget,
  mergeSpatialRareLabels,
  computeSpatialLabelEnergy,
  type RegionBBox,
  type RegionStats,
  type LabelRegionCleanupOptions,
  type LabelCleanupDiagnostics,
  type SpatialLabelsResult,
  type SpatialColorBudgetOptions,
  type SpatialColorDiagnostics,
  type SpatialColorResult,
  createOperationBudget,
  type SharedOperationBudget,
} from './core/label-regions';
export { renderPatternImage, type RenderPatternOptions } from './render/pattern';
export { renderPatternSvg, renderPatternPng, type RenderNodeOptions } from './render/node';
export { countGridMaterials, type MaterialRow } from './core/materials';
export {
  canonicalGridString,
  computeAcceptanceMetrics,
  type AcceptanceTruth,
  type AcceptanceMetrics,
} from './core/metrics';
export {
  createAcceptanceFixture,
  type AcceptanceFixture,
  type AcceptanceFixtureId,
} from './core/acceptance-fixtures';
export {
  BOARD_PRESETS,
  generateForBoard,
  type BoardAdvancedOptions,
  type BoardAdvancedOptions as AdvancedOptions,
  type BoardSpec,
  type GenerateResult as BoardGenerateResult,
  type BoardGenerationRuntime,
  type PaletteId,
  type TopLevelOptions as BoardOptions,
} from './board';
