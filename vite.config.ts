import { defineConfig, loadEnv, type Plugin } from 'vite';

/** Inserta una Content-Security-Policy (sólo en el build) con el origen del worker de push tomado de VITE_PUSH_URL. */
function csp(pushUrl: string): Plugin {
  let push = '';
  try { push = pushUrl ? new URL(pushUrl).origin : ''; } catch { /* sin worker */ }
  const policy = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'", // MapLibre y la UI usan estilos en línea (style="--c:…"); los scripts en línea siguen prohibidos
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' https://tiles.openfreemap.org https://ws.rosario.gob.ar${push ? ' ' + push : ''}`,
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
  ].join('; ');
  return {
    name: 'viajo-csp',
    apply: 'build',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' }],
  };
}

export default defineConfig(({ mode }) => ({
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
  plugins: [csp(loadEnv(mode, process.cwd(), 'VITE_').VITE_PUSH_URL ?? process.env.VITE_PUSH_URL ?? '')],
}));
