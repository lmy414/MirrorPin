// 浏览器入口：打包给 webapp 静态页使用的算法层（无 sharp、无 Node API）。
// 生产物: webapp/app/algo.mjs（由 scripts/build-webapp.mjs 用 esbuild 生成，不入库）

export { generateForBoard, BOARD_PRESETS } from '../src/board';
export { renderPatternImage } from '../src/render/pattern';
export { countGridMaterials } from '../src/core/materials';
export { ALGORITHM_VERSION } from '../src/version';
export { QUALITY_PROFILES, resolveQualityProfile } from '../src/product-profiles';

export type {
  TopLevelOptions,
  AdvancedOptions,
  BoardSpec,
  PaletteId,
  GenerateResult,
} from '../src/board';
export type { RgbaImage, Grid, Cell } from '../src/core/types';
export type { MaterialRow } from '../src/core/materials';