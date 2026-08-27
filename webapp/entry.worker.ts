// Web Worker 入口：在 worker 线程执行 generateForBoard，避免阻塞生成中页动画。
// 与 app/main.mjs 的消息协议：
//   in:  { type: 'generate', img: {width,height,data(Uint8ClampedArray, transferable)}, params: TopLevelOptions }
//   out: { type: 'done', grid: Grid, elapsedMs: number }
//      | { type: 'error', message: string }
// 生产物: webapp/app/algo.worker.mjs（scripts/build-webapp.mjs 生成，不入库）

import { generateForBoard } from '../src/board';

self.onmessage = (ev) => {
  const { type, img, params } = ev.data;
  if (type !== 'generate') return;
  try {
    const t0 = performance.now();
    const result = generateForBoard(img, params);
    const elapsedMs = Math.round(performance.now() - t0);
    self.postMessage({ type: 'done', grid: result.grid, elapsedMs });
  } catch (e) {
    self.postMessage({ type: 'error', message: String(e && e.message ? e.message : e) });
  }
};

export {}; // ESM worker 导出占位（esbuild 打包时消除）