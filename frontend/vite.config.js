import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Geliştirmede tüm istekler Vite proxy'si üzerinden gider; böylece CORS sorunu yaşanmaz.
//   /api   → ASP.NET Core backend (http://localhost:5080)
//   /hubs  → SignalR hub (WebSocket dahil)
//   /vision→ FastAPI görüntü işleme servisi (http://localhost:8000), önek silinerek
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.PROXY_API_TARGET || 'http://localhost:5080';
  const visionTarget = env.PROXY_VISION_TARGET || 'http://localhost:8000';

  const proxy = {
    '/api': { target: apiTarget, changeOrigin: true },
    '/hubs': { target: apiTarget, changeOrigin: true, ws: true },
    '/vision': {
      target: visionTarget,
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/vision/, ''),
    },
  };

  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      proxy,
    },
    preview: {
      port: 4173,
      proxy,
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      chunkSizeWarningLimit: 1200,
    },
  };
});
