/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'editor',
              test: /node_modules[\\/](@tiptap|prosemirror|orderedmap|w3c-keyname|rope-sequence)/,
              priority: 30,
            },
            {
              name: 'editor-markdown',
              test: /node_modules[\\/](marked|markdown-it)/,
              priority: 35,
            },
            {
              name: 'react',
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 20,
            },
            {
              name: 'ui',
              test: /node_modules[\\/](@radix-ui|radix-ui|@floating-ui)[\\/]/,
              priority: 20,
            },
            { name: 'supabase', test: /node_modules[\\/]@supabase[\\/]/, priority: 20 },
          ],
        },
      },
    },
  },
  server: { port: 5173 },
  preview: { port: 4173 },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    testTimeout: 20000,
  },
});
