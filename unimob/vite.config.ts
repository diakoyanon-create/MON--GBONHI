import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { robotsTxt } from './src/lib/robots';

/** Génère robots.txt au build avec l'URL absolue du sitemap (VITE_SITE_URL). */
function robots(siteUrl?: string): Plugin {
  return {
    name: 'robots-txt',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robotsTxt(siteUrl) });
    },
    configureServer(server) {
      server.middlewares.use('/robots.txt', (_req, res) => {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(robotsTxt(siteUrl));
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [react(), tailwindcss(), robots(env.VITE_SITE_URL ?? process.env.VITE_SITE_URL)],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    build: { sourcemap: false, chunkSizeWarningLimit: 900 },
  };
});
