import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// One self-contained bundle: no code splitting, every asset inlined by scripts/inline.mjs afterwards.
export default defineConfig({
  plugins: [preact()],
  build: {
    outDir: 'dist/ui',
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: { output: { codeSplitting: false } },
    target: 'es2022',
  },
});
