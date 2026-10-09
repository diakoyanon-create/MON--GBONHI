import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const root = join(__dirname, '..', '..');

async function waitHttp(url: string, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* attente */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Serveur indisponible : ${url}`);
}

export default async function globalSetup() {
  // @ts-expect-error module JS
  const { startStack } = await import('./stack.mjs');
  const { state, stop } = await startStack();
  const env = { ...process.env, VITE_SUPABASE_URL: state.url, VITE_SUPABASE_ANON_KEY: state.anonKey, VITE_SITE_URL: 'http://localhost:4173' };
  // Teste le build de production (et non le serveur de développement).
  execFileSync('npx', ['vite', 'build', '--outDir', 'dist-e2e', '--emptyOutDir'], { cwd: root, env, stdio: 'ignore' });
  const preview: ChildProcess = spawn('npx', ['vite', 'preview', '--outDir', 'dist-e2e', '--port', '4173', '--strictPort'], { cwd: root, env, stdio: 'ignore' });
  await waitHttp('http://localhost:4173/');
  return async () => {
    preview.kill();
    stop();
  };
}
