import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';

// Static SPA: the SQL engine and its database live in a Web Worker.
export default defineConfig({
  plugins: [react()],
  css: { postcss: { plugins: [tailwindcss()] } },
  worker: { format: 'es' },
  build: { target: 'es2022' },
});
