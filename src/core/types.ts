// 公共类型定义（M0 内核数据模型）

/** RGB 颜色分量，0..255 */
export interface RGB {
  r: number;
  g: number;
  b: number;
}

/**
 * RGBA 位图：与浏览器 ImageData 布局一致（data 为 R,G,B,A 交错的扁平数组，
 * 长度 = width * height * 4，A 通道 0..255）。
 * 素朴数据，不依赖 DOM，便于在 Node 侧测试。
 */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** 统一 alpha 纳入策略：alpha >= threshold 视为有效颜色。 */
export interface AlphaPolicy {
  /** 0..255 的整数，默认 128。 */
  threshold?: number;
}

/** 颜色量化选项；quantizeImage 也继续兼容直接传 colors 数字。 */
export interface ColorQuantizeOptions {
  /** 目标代表色数量；1..255 为启用，>=256 表示关闭。 */
  colors: number;
  /** 用于拟合色板的确定性硬样本上限，默认 120000。 */
  sampleLimit?: number;
  /** 确定性 k-means 随机种子，默认 42。 */
  seed?: number;
  /** 有效颜色的 alpha 策略。 */
  alpha?: AlphaPolicy;
}

/** Spatial CIEDE2000 quantization and Potts/ICM options. */
export interface SpatialQuantizeOptions {
  enabled?: boolean;
  topK?: number;
  smoothness?: number;
  edgeSigma?: number;
  maxIterations?: number;
  cleanupMaxSize?: number;
  cleanupConfidence?: number;
}

export interface ResolvedColorQuantizeOptions {
  colors: number;
  sampleLimit: number;
  seed: number;
  alpha: Required<AlphaPolicy>;
}

/** 基础空间碎色诊断，可由后续管线继续扩充。 */
export interface PipelineDiagnostics {
  componentCount: number;
  singletonComponentCount: number;
  singletonRatio: number;
  boundaryCount: number;
  adjacencyCount: number;
  boundaryRatio: number;
}

/** 一枚拼豆色号 */
export interface Swatch {
  /** 瓶身色号，如 A1 / B5 */
  code: string;
  /** 十六进制色值（不含 #），如 "F9F0CD" */
  hex: string;
}

/** 网格单元：已映射到色号的一个格子 */
export interface Cell {
  code: string;
  hex: string;
  /** 是否属于被剔除的外部（背景）区域 */
  external: boolean;
}

/** 生成的图纸模型：内存态网格 */
export interface Grid {
  /** 行数 */
  rows: number;
  /** 列数 */
  cols: number;
  cells: Cell[][];
  /** 去背景后实际使用的色号数 */
  colorCount: number;
}