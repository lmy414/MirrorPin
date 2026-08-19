// 测试辅助：构造内存位图

import type { RgbaImage } from '../src';

/** 由逐像素函数构造位图，pixelFn 返回 [r,g,b,a]（0..255），默认全不透明 */
export function makeImage(
  width: number,
  height: number,
  pixelFn: (x: number, y: number) => [number, number, number, number] = () => [255, 255, 255, 255],
): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  let i = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelFn(x, y);
      data[i++] = r;
      data[i++] = g;
      data[i++] = b;
      data[i++] = a;
    }
  }
  return { width, height, data };
}

/** 纯色位图 */
export function solidImage(width: number, height: number, rgb: [number, number, number]): RgbaImage {
  return makeImage(width, height, () => [rgb[0], rgb[1], rgb[2], 255]);
}