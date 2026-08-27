// 构建 webapp 浏览器 bundle：webapp/entry.ts → webapp/app/algo.mjs
// 纯浏览器目标：fft.js 打进包，sharp/Node API 不参与。产物不入库（.gitignore）。
import { build } from 'esbuild';

// 主线程算法包
await build({
  entryPoints: ['webapp/entry.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  outfile: 'webapp/app/algo.mjs',
  sourcemap: true,
  logLevel: 'info',
});

console.log('webapp/app/algo.mjs 构建完成');

// Web Worker 算法包（generateForBoard 跑在 worker，避免阻塞生成中页动画）
await build({
  entryPoints: ['webapp/entry.worker.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  outfile: 'webapp/app/algo.worker.mjs',
  sourcemap: true,
  logLevel: 'info',
});

console.log('webapp/app/algo.worker.mjs 构建完成');