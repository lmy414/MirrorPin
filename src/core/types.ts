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