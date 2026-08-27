// 构建 webapp 浏览器 bundle：webapp/entry.ts → webapp/app/algo.mjs
// 纯浏览器目标：fft.js 打进包，sharp/Node API 不参与。产物不入库（.gitignore）。
import { build } from 'esbuild';

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