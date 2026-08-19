import type { RgbaImage } from '@lib/core/types';

/** 浏览器端把图片文件解码为 RgbaImage（PNG/JPG/WebP 均可，createImageBitmap） */
export async function decodeImage(file: File): Promise<RgbaImage> {
  const bmp = await createImageBitmap(file);
  const { width, height } = bmp;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  const data = ctx.getImageData(0, 0, width, height).data;
  bmp.close();
  return { width, height, data: new Uint8ClampedArray(data) };
}