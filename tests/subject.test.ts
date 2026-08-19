import { describe, it, expect } from 'vitest';
import { computeBBox, cropSquare, estimateBackground } from '../src';
import { makeImage } from './helpers';
import type { BackgroundEstimate } from '../src';

describe('estimateBackground / computeBBox / cropSquare', () => {
  it('白背景居中红块 -> 估计近白背景，bbox 框住红块', () => {
    const img = makeImage(100, 100, (x, y) => {
      const core = x >= 40 && x < 60 && y >= 30 && y < 70;
      return core ? [200, 30, 20, 255] : [255, 255, 255, 255];
    });
    const bg = estimateBackground(img);
    expect(bg).not.toBeNull();
    const bbox = computeBBox(img, bg as BackgroundEstimate);
    expect(bbox).not.toBeNull();
    expect(bbox!.x0).toBeLessThanOrEqual(40);
    expect(bbox!.x1).toBeGreaterThanOrEqual(60);
    expect(bbox!.y0).toBeLessThanOrEqual(30);
    expect(bbox!.y1).toBeGreaterThanOrEqual(70);
  });

  it('主体非方形时裁剪为正方形窗口且保留主体内容', () => {
    // 80x80 里一条蓝色竖条：宽20(x10..29) 高40(y20..59)
    const img = makeImage(80, 80, (x, y) => {
      const bar = x >= 10 && x < 30 && y >= 20 && y < 60;
      return bar ? [10, 20, 200, 255] : [255, 255, 255, 255];
    });
    const bg = estimateBackground(img) as BackgroundEstimate;
    const bbox = computeBBox(img, bg)!;
    const cropped = cropSquare(img, bbox);
    // 方形边长 = max(20,40) = 40
    expect(cropped.width).toBe(40);
    expect(cropped.height).toBe(40);
    // 窗口 xl=10+(20-40)/2=0, yl=20；竖条位于窗口 y0..39, x10..29
    // 取窗口内 (x=10,y=0) 所在像素应仍是蓝色
    const o = 0 * cropped.width * 4 + 10 * 4;
    expect(cropped.data[o + 2]).toBeGreaterThan(150); // B 通道接近 200
  });

  it('透明背景 -> estimateBackground 返回 null', () => {
    const img = makeImage(50, 50, (x, y) => {
      const core = x >= 20 && x < 30 && y >= 20 && y < 30;
      return core ? [10, 200, 10, 255] : [0, 0, 0, 0];
    });
    expect(estimateBackground(img)).toBeNull();
  });
});