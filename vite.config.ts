import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // maplibre (~1 MB) va aparte: el código de la app cambia seguido y el navegador conserva maplibre en caché.
        manualChunks(id) { if (id.includes('node_modules/maplibre-gl')) return 'maplibre'; },
      },
    },
  },
});
