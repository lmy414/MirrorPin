import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ALPHA_POLICY,
  cleanTransparentRgb,
  extendTransparentRgb,
  isAlphaIncluded,
  DEFAULT_COLOR_QUANTIZE_OPTIONS,
  measureSpatialFragmentation,
  resolveAlphaPolicy,
  resolveColorQuantizeOptions,
} from '../src';
import { makeImage } from './helpers';

describe('共享选项验证', () => {
  it('alpha 阈值统一采用 >= 128，明确覆盖 127/128/129', () => {
    expect(DEFAULT_ALPHA_POLICY.threshold).toBe(128);
    expect(isAlphaIncluded(127)).toBe(false);
    expect(isAlphaIncluded(128)).toBe(true);
    expect(isAlphaIncluded(129)).toBe(true);
  });

  it('拒绝越界或非整数 alpha 阈值', () => {
    expect(() => resolveAlphaPolicy({ threshold: -1 })).toThrow(/threshold/);
    expect(() => resolveAlphaPolicy({ threshold: 127.5 })).toThrow(/整数/);
    expect(() => resolveAlphaPolicy({ threshold: 256 })).toThrow(/threshold/);
  });

  it('统一解析颜色量化整数选项，并释放 SpatialQuantizeOptions 名称', () => {
    expect(DEFAULT_COLOR_QUANTIZE_OPTIONS).toEqual({ sampleLimit: 120000, seed: 42 });
    expect(resolveColorQuantizeOptions({ colors: 4 })).toEqual({
      colors: 4,
      sampleLimit: 120000,
      seed: 42,
      alpha: DEFAULT_ALPHA_POLICY,
    });
    expect(() => resolveColorQuantizeOptions({ colors: 2, sampleLimit: 0 })).toThrow(/sampleLimit/);
  });
});

describe('透明 RGB 纯函数', () => {
  it('cleanTransparentRgb 只清洗阈值以下 RGB，保留 alpha 与输入', () => {
    const input = makeImage(3, 1, (x) => [10 + x, 20 + x, 30 + x, 127 + x]);
    const output = cleanTransparentRgb(input);
    expect(output).not.toBe(input);
    expect(Array.from(output.data)).toEqual([
      0, 0, 0, 127,
      11, 21, 31, 128,
      12, 22, 32, 129,
    ]);
    expect(Array.from(input.data.slice(0, 4))).toEqual([10, 20, 30, 127]);
  });

  it('extendTransparentRgb 从最近的不透明像素延拓颜色且不改 alpha', () => {
    const input = makeImage(5, 1, (x) => {
      if (x === 1) return [200, 10, 20, 255];
      if (x === 4) return [10, 20, 200, 255];
      return [99, 88, 77, 0];
    });
    const output = extendTransparentRgb(input);
    expect(Array.from(output.data)).toEqual([
      200, 10, 20, 0,
      200, 10, 20, 255,
      200, 10, 20, 0,
      10, 20, 200, 0,
      10, 20, 200, 255,
    ]);
  });

  it('二维等距 tie-break 规范选择较小源像素索引', () => {
    const input = makeImage(3, 3, (x, y) => {
      if (x === 1 && y === 0) return [200, 10, 20, 255];
      if (x === 0 && y === 1) return [10, 20, 200, 255];
      return [99, 88, 77, 0];
    });
    const output = extendTransparentRgb(input);
    expect(Array.from(output.data.slice((1 * 3 + 1) * 4, (1 * 3 + 1) * 4 + 4))).toEqual([200, 10, 20, 0]);
  });

  it('自定义 threshold 同时控制清洗和延拓源', () => {
    const input = makeImage(3, 1, (x) => {
      if (x === 0) return [200, 0, 0, 100];
      if (x === 2) return [0, 0, 200, 200];
      return [17, 18, 19, 0];
    });
    expect(Array.from(cleanTransparentRgb(input, { threshold: 200 }).data)).toEqual([
      0, 0, 0, 100,
      0, 0, 0, 0,
      0, 0, 200, 200,
    ]);
    expect(Array.from(extendTransparentRgb(input, { threshold: 200 }).data)).toEqual([
      0, 0, 200, 100,
      0, 0, 200, 0,
      0, 0, 200, 200,
    ]);
  });

  it('extendTransparentRgb 不修改输入 data', () => {
    const input = makeImage(3, 2, (x, y) => x === 2 && y === 1 ? [1, 2, 3, 255] : [90, 80, 70, 0]);
    const before = new Uint8ClampedArray(input.data);
    extendTransparentRgb(input);
    expect(input.data).toEqual(before);
  });

  it('全透明图延拓为清洁黑色而不是泄露隐藏 RGB', () => {
    const input = makeImage(2, 1, () => [91, 82, 73, 0]);
    expect(Array.from(extendTransparentRgb(input).data)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('空间碎色指标', () => {
  it('统计四连通分量、单格分量和异色边界比例', () => {
    const labels = new Int32Array([
      1, 1, 2,
      1, 3, 2,
      4, 3, 5,
    ]);
    expect(measureSpatialFragmentation(labels, 3, 3)).toEqual({
      componentCount: 5,
      singletonComponentCount: 2,
      singletonRatio: 0.4,
      smallComponentCount: 4,
      smallComponentRatio: 0.8,
      smallComponentThreshold: 2,
      validCellCount: 9,
      boundaryCount: 8,
      adjacencyCount: 12,
      boundaryRatio: 2 / 3,
    });
  });

  it('拒绝尺寸不匹配和非整数尺寸', () => {
    expect(() => measureSpatialFragmentation(new Int32Array(4), 1.5, 2)).toThrow(/整数/);
    expect(() => measureSpatialFragmentation(new Int32Array(3), 2, 2)).toThrow(/长度/);
  });
});
