import { describe, it, expect } from 'vitest';
import { dpidDownscale } from '../src/core/dpid';
import { guidedSmooth } from '../src/core/guided';
import { l0Smooth } from '../src/core/l0';
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

  it('尺寸与有效像素数正确', () => {
    const img = makeImage(10, 6, () => [10, 20, 30, 128]);
    const out = dpidDownscale(img, 5, 3);
    expect(out.width).toBe(5);
    expect(out.height).toBe(3);
    expect(out.data.length).toBe(5 * 3 * 4);
  });
});

describe('guidedSmooth', () => {
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
  it('平坦区弱抖动被归零，强阶跃保留（lambda=0.02）', () => {
    const img = makeImage(32, 32, (x) => (x < 16 ? [120, 120, 120, 255] : [180, 180, 180, 255]));
    // 注入弱噪
    for (let x = 2; x < 6; x++) { img.data[(8 * 32 + x) * 4] = 130; }
    const out = l0Smooth(img, { lam: 0.02 });
    // 强阶跃仍保留
    const left = out.data[(16 * 32 + 12) * 4]!;
    const right = out.data[(16 * 32 + 20) * 4]!;
    expect(Math.abs(right - left)).toBeGreaterThan(40);
    // 弱噪附近应趋于分块恒定（相似）
    expect(Math.abs(out.data[(8 * 32 + 3) * 4]! - out.data[(8 * 32 + 4) * 4]!)).toBeLessThanOrEqual(10);
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
