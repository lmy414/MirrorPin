// 活动版主线程入口：只保留材料统计、质量档和版本，生成在 Worker 中执行。
export { countGridMaterials } from '../src/core/materials';
export { ALGORITHM_VERSION } from '../src/version';
export { QUALITY_PROFILES, resolveQualityProfile } from '../src/product-profiles';
