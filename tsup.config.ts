import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', 'render-node': 'src/render/node.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2020',
  external: ['sharp'],
});