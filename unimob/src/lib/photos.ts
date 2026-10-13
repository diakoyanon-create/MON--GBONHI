import { supabase, PHOTO_BUCKET } from './supabase';

/** URL publique d'une photo. Les chemins "demo/…" pointent vers les illustrations fictives livrées avec le site. */
export function photoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith('demo/')) return `/${path}`;
  return supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Les fichiers privés sont envoyés sans mise en cache navigateur. */
export const PRIVATE_UPLOAD_OPTIONS = { cacheControl: '0', upsert: false } as const;

export const POPUP_BLOCKED = 'Autorisez les fenêtres pop-up pour ce site afin d’ouvrir le document, puis réessayez.';

/**
 * Ouvre l'onglet qui affichera un document privé. À appeler directement dans le gestionnaire
 * de clic, AVANT tout appel réseau : après un await, le navigateur la bloquerait comme pop-up.
 */
export function openBlankWindow(): Window {
  const win = window.open('', '_blank');
  if (!win) throw new Error(POPUP_BLOCKED);
  return win;
}

/**
 * Ouvre un document privé sans créer d'URL réutilisable : le fichier est téléchargé avec la
 * session de l'utilisateur puis affiché depuis la mémoire du navigateur (URL locale révoquée).
 * `target` : onglet déjà ouvert par openBlankWindow (sinon ouvert ici, dans le clic).
 * L'onglet de l'application n'est jamais redirigé vers le document : si la fenêtre est
 * bloquée, une erreur est levée et la page reste en place.
 */
export async function openPrivateFile(bucket: string, path: string, target?: Window): Promise<void> {
  const win = target ?? openBlankWindow();
  try {
    const { data, error } = await supabase.storage.from(bucket).download(path);
    if (error || !data) throw error ?? new Error('Document introuvable');
    const url = URL.createObjectURL(data);
    win.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    win.close();
    throw e;
  }
}
