import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'static',
  publicDir: '../public',
  plugins: [react()],
  define: {
    'process.env.NEXT_PUBLIC_MATERIAL_API_BASE_URL': JSON.stringify(
      process.env.NEXT_PUBLIC_MATERIAL_API_BASE_URL ?? '',
    ),
  },
  build: {
    outDir: '../dist-static',
    emptyOutDir: true,
    sourcemap: true,
  },
});
