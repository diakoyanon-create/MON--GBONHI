import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

/** Vérifie la configuration sans jamais lever d'exception (sinon page blanche). */
export function isValidConfig(u: string | undefined, key: string | undefined): boolean {
  if (!u || !key || u.includes('votre-projet') || key.includes('cle-publique')) return false;
  try {
    return /^https?:$/.test(new URL(u).protocol);
  } catch {
    return false;
  }
}

/** Vrai si l'application a reçu une URL et une clé publique Supabase valides. */
export const supabaseConfigured = isValidConfig(url, anonKey);

// La clé "anon" est publique par conception : la protection des données repose sur RLS.
// La clé service_role ne doit JAMAIS apparaître dans le code du navigateur.
export const supabase: SupabaseClient = createClient(
  supabaseConfigured ? url! : 'http://localhost:54321',
  supabaseConfigured ? anonKey! : 'non-configure',
  {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  },
);

export const PHOTO_BUCKET = 'property-photos';
export const DOCS_BUCKET = 'private-documents';
export const RECEIPTS_BUCKET = 'finance-receipts';
