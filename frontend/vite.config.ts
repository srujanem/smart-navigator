import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
      '/media': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 1500,
    modulePreload: {
      resolveDependencies: (_filename, deps) =>
        deps.filter((d) => !d.includes('three-') && !d.includes('motion-')),
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          const norm = id.replace(/\\/g, '/');
          if (norm.includes('vite/preload-helper')) {
            return 'vendor';
          }
          if (!norm.includes('/node_modules/')) return undefined;
          if (
            norm.includes('/node_modules/three/') ||
            norm.includes('/node_modules/@react-three/') ||
            norm.includes('/node_modules/three-stdlib/') ||
            norm.includes('/node_modules/troika-') ||
            norm.includes('/node_modules/maath/') ||
            norm.includes('/node_modules/meshline/')
          ) {
            return 'three';
          }
          if (
            norm.includes('/node_modules/framer-motion/') ||
            norm.includes('/node_modules/motion-dom/') ||
            norm.includes('/node_modules/motion-utils/')
          ) {
            return 'motion';
          }
          if (norm.includes('/node_modules/lucide-react/')) {
            return 'icons';
          }
          if (
            norm.includes('/node_modules/react/') ||
            norm.includes('/node_modules/react-dom/') ||
            norm.includes('/node_modules/react-router') ||
            norm.includes('/node_modules/scheduler/')
          ) {
            return 'vendor';
          }
          return undefined;
        },
      },
    },
  },
})
