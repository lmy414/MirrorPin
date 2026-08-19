// CLI 独立打包：esbuild 单文件(ESM) + shebang + sharp external
import { build } from 'esbuild';

await build({
  entryPoints: ['cli/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: ['node18'],
  outfile: 'dist/cli.js',
  external: ['sharp'],
  banner: { js: '#!/usr/bin/env node' },
  sourcemap: true,
  logLevel: 'info',
});

console.log('dist/cli.js 构建完成');