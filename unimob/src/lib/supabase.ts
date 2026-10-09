import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Vrai si l'application a reçu une URL et une clé publique Supabase. */
export const supabaseConfigured = Boolean(url && anonKey && !url.includes('votre-projet'));

// La clé "anon" est publique par conception : la protection des données repose sur RLS.
// La clé service_role ne doit JAMAIS apparaître dans le code du navigateur.
export const supabase: SupabaseClient = createClient(
  url ?? 'http://localhost:54321',
  anonKey ?? 'non-configure',
  {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  },
);

export const PHOTO_BUCKET = 'property-photos';
export const DOCS_BUCKET = 'private-documents';
export const RECEIPTS_BUCKET = 'finance-receipts';
