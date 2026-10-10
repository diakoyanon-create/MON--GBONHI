import { supabase, PHOTO_BUCKET } from './supabase';

/** URL publique d'une photo. Les chemins "demo/…" pointent vers les illustrations fictives livrées avec le site. */
export function photoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith('demo/')) return `/${path}`;
  return supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Les fichiers privés sont envoyés sans mise en cache navigateur. */
export const PRIVATE_UPLOAD_OPTIONS = { cacheControl: '0', upsert: false } as const;

/**
 * Ouvre un document privé sans créer d'URL réutilisable : le fichier est téléchargé avec la
 * session de l'utilisateur puis affiché depuis la mémoire du navigateur (URL locale révoquée).
 */
export async function openPrivateFile(bucket: string, path: string): Promise<void> {
  // Fenêtre ouverte immédiatement (sinon bloquée comme pop-up après un appel réseau).
  const win = window.open('', '_blank');
  try {
    const { data, error } = await supabase.storage.from(bucket).download(path);
    if (error || !data) throw error ?? new Error('Document introuvable');
    const url = URL.createObjectURL(data);
    if (win) win.location.href = url;
    else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    win?.close();
    throw e;
  }
}
