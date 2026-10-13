// Le service worker ne met en cache QUE les fichiers statiques de l'application
// (JS/CSS/icônes). Aucune réponse de l'API Supabase ni aucun document n'est mis en cache.
export function registerServiceWorker() {
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* installation facultative */
      });
    });
  }
}

const RELOAD_KEY = 'chunk-reload-at';

/** Vrai si l'erreur vient d'un fichier JS disparu après un nouveau déploiement. */
export function isChunkLoadError(error: unknown): boolean {
  const msg = String((error as { message?: string } | null)?.message ?? error ?? '');
  return /dynamically imported module|Importing a module script failed|ChunkLoadError|Failed to fetch module|error loading dynamically/i.test(msg);
}

/** Recharge une seule fois (par minute) pour récupérer la nouvelle version. */
export function reloadOnceForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    /* stockage indisponible : on recharge quand même une fois */
  }
  window.location.reload();
  return true;
}

export function installChunkReload() {
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadOnceForNewVersion()) event.preventDefault();
  });
}
