import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5001',
        changeOrigin: true,
        // Don't follow redirects - let the browser handle them
        followRedirects: false,
        // Rewrite URLs to strip trailing slashes before proxying
        rewrite: (path) => path.replace(/\/(\?|$)/, '$1'),
        // Configure proxy to log and handle requests
        configure: (proxy, options) => {
          proxy.on('proxyReq', (proxyReq, req, res) => {
            // Log outgoing request to help debug
            if (req.url.includes('visitors') && !req.url.includes('visits')) {
              console.log(`[Vite Proxy] Outgoing: ${req.method} ${req.url}`);
              console.log(`[Vite Proxy] Authorization present: ${!!req.headers.authorization}`);
            }
            // Ensure Authorization header is forwarded
            if (req.headers.authorization) {
              proxyReq.setHeader('Authorization', req.headers.authorization);
            }
          });
          proxy.on('proxyRes', (proxyRes, req, res) => {
            // Log responses for debugging
            if (req.url.includes('visitors') && !req.url.includes('visits')) {
              console.log(`[Vite Proxy] Response: ${proxyRes.statusCode} for ${req.url}`);
            }
          });
        },
      },
      '/auth': {
        target: 'http://localhost:5001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
