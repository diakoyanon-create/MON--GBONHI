import { supabase, PHOTO_BUCKET } from './supabase';

/** URL publique d'une photo. Les chemins "demo/…" pointent vers les illustrations fictives livrées avec le site. */
export function photoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith('demo/')) return `/${path}`;
  return supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** URL signée temporaire (5 minutes) pour un document privé. */
export async function signedUrl(bucket: string, path: string, seconds = 300): Promise<string> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, seconds);
  if (error) throw error;
  return data.signedUrl;
}
