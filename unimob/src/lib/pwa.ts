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
