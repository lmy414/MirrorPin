import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // 算法库在父目录 src
      '@lib': resolve(__dirname, '../src'),
    },
  },
  server: {
    port: 5173,
  },
});