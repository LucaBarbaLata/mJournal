import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

// Shared, framework-free domain logic lives in src/core and is imported as "@core/...".
const alias = { '@core': resolve('src/core') };

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      outDir: 'out/main',
      rollupOptions: { input: resolve('src/main/index.ts') },
    },
  },
  preload: {
    resolve: { alias },
    build: {
      outDir: 'out/preload',
      rollupOptions: { input: resolve('src/preload/index.ts') },
    },
  },
  renderer: {
    root: resolve('src/renderer'),
    resolve: { alias },
    plugins: [react()],
    build: {
      outDir: resolve('out/renderer'),
      rollupOptions: { input: resolve('src/renderer/index.html') },
    },
  },
});
