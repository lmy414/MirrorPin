import { describe, expect, it } from 'vitest';
import { deterministicSampleIndices, quantizeImage } from '../src';
import type { ColorQuantizeOptions } from '../src';
import { makeImage } from './helpers';

function image(colors: number[]): { width: number; height: number; data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(colors.length * 4);
  colors.forEach((value, i) => {
    data[i * 4] = value;
    data[i * 4 + 1] = 255 - value;
    data[i * 4 + 2] = value / 2;
    data[i * 4 + 3] = 255;
  });
  return { width: colors.length, height: 1, data };
}

describe('quantizeImage', () => {
  it('公开选项类型使用 ColorQuantizeOptions，并保留数字兼容调用', () => {
    const options: ColorQuantizeOptions = { colors: 2, sampleLimit: 4, seed: 1 };
    const input = image([0, 80, 160, 240]);
    expect(quantizeImage(input, options).width).toBe(4);
    expect(quantizeImage(input, 2).width).toBe(4);
  });

  it('colors <= 0 或 >= 256 时保持关闭并复用原图', () => {
    const input = image([0, 80, 160, 240]);
    expect(quantizeImage(input, 0)).toBe(input);
    expect(quantizeImage(input, 256)).toBe(input);
  });

  it('按 colors 限制不透明像素的代表色数量并保留尺寸/alpha', () => {
    const input = image([0, 80, 160, 240]);
    const output = quantizeImage(input, 2);
    const colors = new Set<string>();
    for (let i = 0; i < output.data.length; i += 4) {
      colors.add(`${output.data[i]},${output.data[i + 1]},${output.data[i + 2]}`);
      expect(output.data[i + 3]).toBe(255);
    }
    expect(output.width).toBe(input.width);
    expect(output.height).toBe(input.height);
    expect(colors.size).toBeLessThanOrEqual(2);
  });

  it('alpha 127 被忽略，128 与 129 被纳入量化', () => {
    const input = makeImage(3, 1, (x) => [x * 100, 0, 0, 127 + x]);
    const output = quantizeImage(input, { colors: 1, sampleLimit: 3 });
    expect(Array.from(output.data.slice(0, 4))).toEqual([0, 0, 0, 127]);
    expect(Array.from(output.data.slice(4, 8))).toEqual([150, 0, 0, 128]);
    expect(Array.from(output.data.slice(8, 12))).toEqual([150, 0, 0, 129]);
  });

  it('透明像素隐藏 RGB 不改变不透明像素量化结果', () => {
    const a = makeImage(4, 1, (x) => x < 2 ? [x * 20, 40, 60, 255] : [0, 0, 0, 0]);
    const b = makeImage(4, 1, (x) => x < 2 ? [x * 20, 40, 60, 255] : [255, 17, 231, 0]);
    expect(quantizeImage(a, 1).data.slice(0, 8)).toEqual(quantizeImage(b, 1).data.slice(0, 8));
  });

  it('确定性 sampleLimit helper 严格不超限并返回精确均匀索引', () => {
    const indices = [2, 5, 9, 14, 20, 27, 35, 44, 54, 65, 77];
    const sampled = deterministicSampleIndices(indices, 4);
    expect(sampled.length).toBeLessThanOrEqual(4);
    expect(sampled).toEqual([2, 14, 44, 77]);
    expect(deterministicSampleIndices(indices, 20)).toEqual(indices);
  });

  it('确定性硬 sampleLimit 覆盖整幅图而非只取左上前缀', () => {
    const input = makeImage(100, 1, (x) => x < 50 ? [255, 0, 0, 255] : [0, 0, 255, 255]);
    const output = quantizeImage(input, { colors: 1, sampleLimit: 10, seed: 42 });
    expect(output.data[0]).toBeGreaterThan(60);
    expect(output.data[2]).toBeGreaterThan(60);
  });

  it('同一 5-bit 桶中的像素仍逐像素匹配，不依赖首像素顺序', () => {
    const firstDark = makeImage(4, 1, (x) => {
      if (x === 0) return [8, 0, 0, 255];
      if (x === 1) return [15, 0, 0, 255];
      if (x === 2) return [0, 0, 0, 255];
      return [23, 0, 0, 255];
    });
    const firstLight = makeImage(4, 1, (x) => {
      if (x === 0) return [15, 0, 0, 255];
      if (x === 1) return [8, 0, 0, 255];
      if (x === 2) return [0, 0, 0, 255];
      return [23, 0, 0, 255];
    });
    const a = quantizeImage(firstDark, { colors: 2, sampleLimit: 4, seed: 1 });
    const b = quantizeImage(firstLight, { colors: 2, sampleLimit: 4, seed: 1 });
    expect(Array.from(a.data.slice(0, 8))).toEqual(Array.from(b.data.slice(4, 8)).concat(Array.from(b.data.slice(0, 4))));
  });

  it('选项对象验证 colors/sampleLimit/seed 为整数', () => {
    const input = image([0, 255]);
    expect(() => quantizeImage(input, { colors: 1.5 })).toThrow(/整数/);
    expect(() => quantizeImage(input, { colors: 2, sampleLimit: 1.5 })).toThrow(/整数/);
    expect(() => quantizeImage(input, { colors: 2, seed: 1.5 })).toThrow(/整数/);
  });
});
