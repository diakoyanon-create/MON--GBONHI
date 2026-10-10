/**
 * Les liens d'invitation et de réinitialisation de Supabase ramènent sur la « Site URL »
 * avec `#access_token=…&type=invite|recovery`. On redirige vers /mot-de-passe en gardant
 * le fragment (lu ensuite par supabase-js) pour que la personne choisisse son mot de passe.
 */
export function authRedirectTarget(loc: { pathname: string; hash: string; search: string }): string | null {
  const params = new URLSearchParams(loc.hash.replace(/^#/, ''));
  const query = new URLSearchParams(loc.search);
  const type = params.get('type') ?? query.get('type');
  if (type !== 'invite' && type !== 'recovery') return null;
  if (loc.pathname === '/mot-de-passe') return null;
  return `/mot-de-passe${loc.search}${loc.hash}`;
}
