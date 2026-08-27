// MirrorPin 算法内核（M0）公共出口

export { MARD291, MARD221, type MardSwatch } from './palettes/mard291';
// MardSwatch 与 Swatch 同构，保留别名以兼容历史导入

export type { RGB, RgbaImage, Swatch, Cell, Grid } from './core/types';

export {
  srgbToOklab,
  oklabDistance,
  hexToRgb,
  rgbToHex,
  type Oklab,
} from './core/color';
export { sampleGrid, type SampleMode } from './core/grid';
export { buildPalette, nearestSwatch, type PaletteEntry } from './core/palette';
export { kmeansPalette, mulberry32 } from './core/quantize';
export { mergeRegions, removeBackground } from './core/post';
export {
  generatePattern,
  generatePatternMapFirst,
  generatePatternAdvanced,
  generatePatternSoft,
  type GenerateOptions,
  type MapFirstOptions,
  type AdvancedOptions,
  type SoftOptions,
} from './core/pipeline';
export { boxBlur, gaussianBlur } from './core/preprocess';
export { l0Smooth } from './core/l0';
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
  type BeadOptions,
  type SmoothKind,
  type ScaleKind,
} from './beadpattern/core';
export { srgbToLab, ciede2000, type Lab } from './beadpattern/ciede2000';
export { renderPatternImage, type RenderPatternOptions } from './render/pattern';
export { renderPatternSvg, renderPatternPng, countGridMaterials, type RenderNodeOptions, type MaterialRow } from './render/node';