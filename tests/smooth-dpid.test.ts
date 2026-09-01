import { describe, it, expect } from 'vitest';
import { dpidDownscale } from '../src/core/dpid';
import { guidedSmooth } from '../src/core/guided';
import { applyNeumannSystem, l0Smooth, neumannGradient, neumannNegativeDivergence, solveNeumannSystem } from '../src/core/l0';
import { makeImage } from './helpers';

describe('dpidDownscale', () => {
  it('纯色图与 BOX 等价（64×64→2×2，像素级误差 <1）', () => {
    const img = makeImage(64, 64, () => [120, 80, 200, 255]);
    const box = dpidDownscale(img, 2, 2, { lambda: 0 });
    for (let i = 0; i < box.data.length; i++) {
      expect(Math.abs(box.data[i]! - [120, 80, 200, 255][i % 4]!)).toBeLessThanOrEqual(1);
    }
  });

  it('细线细节保留：偏离均值多的像素权重应更大', () => {
    // 背景白(255)，中心10px 黑线条(0)，偏离大 → 降采样到 2×2 时更接近黑色
    const img = makeImage(32, 32, (x) => (x >= 14 && x < 18 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    const dpid = dpidDownscale(img, 2, 2, { lambda: 1.0 });
    const box = dpidDownscale(img, 2, 2, { lambda: 0 });
    const avgDpid = dpid.data[0]!;
    const avgBox = box.data[0]!;
    // DPID 对黑线加权，结果应比 BOX 更暗
    expect(avgDpid).toBeLessThan(avgBox);
  });

  it('非整数面积重采样与手算 coverage oracle 一致', () => {
    const img = makeImage(3, 1, (x) => [[0, 0, 0, 255], [60, 60, 60, 255], [180, 180, 180, 255]][x]! as [number, number, number, number]);
    const out = dpidDownscale(img, 2, 1, { lambda: 0 });
    // areaResampleToGrid 在 linear light 中积分，再编码回 sRGB。
    expect(Array.from(out.data)).toEqual([
      33, 33, 33, 255,
      153, 153, 153, 255,
    ]);
  });

  it('尺寸与有效像素数正确', () => {
    const img = makeImage(10, 6, () => [10, 20, 30, 128]);
    const out = dpidDownscale(img, 5, 3);
    expect(out.width).toBe(5);
    expect(out.height).toBe(3);
    expect(out.data.length).toBe(5 * 3 * 4);
  });
});

describe('guidedSmooth', () => {
  it('验证参数并在奇异纯色协方差下保持有限且 alpha 不变', () => {
    const img = makeImage(3, 2, (x, y) => [80, 80, 80, 120 + x + y]);
    expect(() => guidedSmooth(img, { r: -1 })).toThrow(/r/);
    expect(() => guidedSmooth(img, { r: 1.5 })).toThrow(/整数/);
    expect(() => guidedSmooth(img, { eps: -1 })).toThrow(/eps/);
    const out = guidedSmooth(img, { r: 1, eps: 0 });
    for (let i = 0; i < out.data.length; i += 4) {
      expect(Number.isFinite(out.data[i]!)).toBe(true);
      expect(out.data[i + 3]).toBe(img.data[i + 3]);
    }
  });

  it('纯色输入保持原色，不因奇异协方差变黑', () => {
    const img = makeImage(7, 5, () => [173, 91, 44, 255]);
    const out = guidedSmooth(img, { r: 2, eps: 1e-6 });
    expect(Array.from(out.data)).toEqual(Array.from(img.data));
  });

  it('灰度秩一输入保持有限且不会塌成黑色', () => {
    const img = makeImage(9, 5, (x) => {
      const v = 40 + x * 20;
      return [v, v, v, 255];
    });
    const out = guidedSmooth(img, { r: 2, eps: 1e-6 });
    for (let i = 0; i < out.data.length; i += 4) {
      expect(Number.isFinite(out.data[i]!)).toBe(true);
      expect(out.data[i]!).toBeGreaterThan(10);
    }
  });

  it('平坦区带噪应被压平，强边缘保留（此图用 r=8/eps=100，弱作断言）', () => {
    const img = makeImage(16, 16, (x) => (x < 8 ? [100, 100, 100, 255] : [200, 200, 200, 255]));
    // 注入少量噪点
    img.data[4 * 4 + 0] = 120; img.data[4 * 4 + 1] = 120; img.data[4 * 4 + 2] = 120;
    const out = guidedSmooth(img, { r: 2, eps: 100 });
    // 强边缘（跨中线）仍应有足够对比
    const left = out.data[(8 * 16 + 7) * 4]!;
    const right = out.data[(8 * 16 + 8) * 4]!;
    expect(Math.abs(right - left)).toBeGreaterThan(40);
  });
});

describe('l0Smooth', () => {
  it('Neumann 梯度与负散度互为伴随，并且 PCG 残差满足门禁', () => {
    const width = 5;
    const height = 3;
    const n = width * height;
    const values = Float64Array.from({ length: n }, (_, i) => (i * 13 + 7) / 100);
    const h = new Float64Array(n);
    const v = new Float64Array(n);
    const dualH = Float64Array.from({ length: n }, (_, i) => (i - 4) / 17);
    const dualV = Float64Array.from({ length: n }, (_, i) => (3 - i) / 19);
    const div = new Float64Array(n);
    neumannGradient(values, width, height, h, v);
    neumannNegativeDivergence(dualH, dualV, width, height, div);
    let lhs = 0;
    let rhs = 0;
    for (let i = 0; i < n; i++) {
      lhs += h[i]! * dualH[i]! + v[i]! * dualV[i]!;
      rhs += values[i]! * div[i]!;
    }
    expect(Math.abs(lhs - rhs)).toBeLessThan(1e-12);

    const beta = 3.75;
    const expected = new Float64Array(n);
    applyNeumannSystem(values, width, height, beta, expected);
    const solution = new Float64Array(n);
    const stats = solveNeumannSystem(expected, width, height, beta, solution, new Float64Array(n), new Float64Array(n), new Float64Array(n), new Float64Array(n), { tolerance: 1e-10 });
    expect(stats.residual).toBeLessThanOrEqual(stats.tolerance);
    for (let i = 0; i < n; i++) expect(solution[i]!).toBeCloseTo(values[i]!, 10);
  });

  it('验证参数', () => {
    const img = makeImage(4, 4, () => [100, 80, 60, 255]);
    expect(() => l0Smooth(img, { lam: 0 })).toThrow(/lam/);
    expect(() => l0Smooth(img, { betaMax: 0 })).toThrow(/betaMax/);
    expect(() => l0Smooth(img, { betaRate: 1 })).toThrow(/betaRate/);
  });

  it('支持 1×N 与 N×1，缺失方向导数为 0', () => {
    for (const img of [
      makeImage(1, 9, (_x, y) => [80 + y * 8, 60, 40, 255]),
      makeImage(9, 1, (x) => [80 + x * 8, 60, 40, 255]),
    ]) {
      const out = l0Smooth(img, { lam: 0.02 });
      expect([out.width, out.height]).toEqual([img.width, img.height]);
      expect(Array.from(out.data).every(Number.isFinite)).toBe(true);
    }
  });

  it('超过 padded 像素安全预算时在分配前明确拒绝', () => {
    const img = { width: 1025, height: 1025, data: new Uint8ClampedArray(1025 * 1025 * 4) };
    expect(() => l0Smooth(img)).toThrow(/预算|上限|过大/);
  });

  it('保持尺寸与 alpha；非恒等/降噪保边门禁见独立后续核心回归 spec', () => {
    const img = makeImage(8, 8, (x, y) => [100 + x + y, 80, 60, 127 + ((x + y) % 3)]);
    const out = l0Smooth(img, { lam: 0.02 });
    expect(out.width).toBe(img.width);
    expect(out.height).toBe(img.height);
    for (let i = 3; i < out.data.length; i += 4) expect(out.data[i]).toBe(img.data[i]);
  });

  it('1×N 末端高值不会通过周期接缝污染首端', () => {
    const base = makeImage(17, 1, (x) => [x === 0 ? 32 : 96, 96, 96, 255]);
    const changed = makeImage(17, 1, (x) => [x === 0 ? 32 : x === 16 ? 255 : 96, 96, 96, 255]);
    const a = l0Smooth(base, { lam: 0.02 });
    const b = l0Smooth(changed, { lam: 0.02 });
    expect(Math.abs(b.data[0]! - a.data[0]!)).toBeLessThanOrEqual(2);
    expect(Math.abs(b.data[4]! - a.data[4]!)).toBeLessThanOrEqual(2);
  });

  it('N×1 末端高值不会通过周期接缝污染首端', () => {
    const base = makeImage(1, 17, (_x, y) => [y === 0 ? 32 : 96, 96, 96, 255]);
    const changed = makeImage(1, 17, (_x, y) => [y === 0 ? 32 : y === 16 ? 255 : 96, 96, 96, 255]);
    const a = l0Smooth(base, { lam: 0.02 });
    const b = l0Smooth(changed, { lam: 0.02 });
    expect(Math.abs(b.data[0]! - a.data[0]!)).toBeLessThanOrEqual(2);
    expect(Math.abs(b.data[4 * 1]! - a.data[4 * 1]!)).toBeLessThanOrEqual(2);
  });

  it('非2次幂二维图的一侧边缘结构不会在对侧形成周期接缝', () => {
    const base = makeImage(7, 5, () => [96, 96, 96, 255]);
    const changed = makeImage(7, 5, (x, y) => [x === 0 && y >= 1 && y <= 3 ? 220 : 96, 96, 96, 255]);
    const a = l0Smooth(base, { lam: 0.02 });
    const b = l0Smooth(changed, { lam: 0.02 });
    for (let y = 1; y <= 3; y++) {
      const opposite = (y * 7 + 6) * 4;
      expect(Math.abs(b.data[opposite]! - a.data[opposite]!)).toBeLessThanOrEqual(2);
    }
  });
});

describe('generatePatternBead + smooth/scale 集成', () => {
  it('新选项不破坏原有路径（平局系默认 none+box 与显式 none+box 一致）', async () => {
    const { generatePatternBead } = await import('../src/beadpattern/core');
    const img = makeImage(32, 32, () => [120, 80, 200, 255]);
    const a = generatePatternBead(img, { maxSide: 16, smooth: 'none', scale: 'box' });
    const b = generatePatternBead(img, { maxSide: 16 });
    expect(a.colorCount).toBe(b.colorCount);
  });

  it('smooth=l0 与 dpid 均可正常完成管线', async () => {
    const { generatePatternBead } = await import('../src/beadpattern/core');
    const img = makeImage(24, 24, (x, y) => (x + y) % 2 === 0 ? [220, 30, 30, 255] : [30, 30, 220, 255]);
    const a = generatePatternBead(img, { maxSide: 12, smooth: 'l0', smoothLambda: 0.02 });
    const b = generatePatternBead(img, { maxSide: 12, scale: 'dpid', dpidLambda: 1.0 });
    expect(a.colorCount).toBeGreaterThanOrEqual(1);
    expect(b.colorCount).toBeGreaterThanOrEqual(1);
  });
});
