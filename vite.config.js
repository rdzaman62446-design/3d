import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const page = (name) => fileURLToPath(new URL(name, import.meta.url));

export default defineConfig({
  // Relative paths so the build works from any sub-folder, such as GitHub Pages.
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 800, // three.js alone is ~550 kB
    rollupOptions: {
      input: { main: page('index.html'), app: page('app.html') },
    },
  },
  worker: { format: 'es' },
});
