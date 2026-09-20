import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Mirrors public/metacong/'s existing pattern: a self-contained SPA built
// with `base` set to its own subpath and the dist output copied straight
// into public/, so Express can serve it as a static folder with no server
// changes beyond pointing '/' at its index.html.
export default defineConfig({
  base: '/home/',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../public/home',
    emptyOutDir: true,
  },
});
