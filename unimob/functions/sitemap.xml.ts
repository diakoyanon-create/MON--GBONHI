// Cloudflare Pages Function : sitemap dynamique des annonces publiées.
// Utilise uniquement l'URL du projet et la clé publique « anon » (variables d'environnement
// SUPABASE_URL et SUPABASE_ANON_KEY définies dans Cloudflare) : seules les données de la vue
// public_properties sont lisibles. Aucun secret n'est nécessaire.
type Env = { SUPABASE_URL?: string; SUPABASE_ANON_KEY?: string; VITE_SUPABASE_URL?: string; VITE_SUPABASE_ANON_KEY?: string };

const STATIC_PATHS = ['/', '/biens', '/a-propos', '/contact', '/mentions-legales', '/confidentialite'];

const xmlEscape = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c] as string);

export async function onRequestGet({ request, env }: { request: Request; env: Env }): Promise<Response> {
  const origin = new URL(request.url).origin;
  const url = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY;
  let items: Array<{ reference: string; published_at: string | null; is_demo: boolean }> = [];
  if (url && key) {
    const r = await fetch(`${url}/rest/v1/public_properties?select=reference,published_at,is_demo&limit=5000`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (r.ok) items = await r.json();
  }
  const urls = [
    ...STATIC_PATHS.map((p) => `<url><loc>${xmlEscape(origin + p)}</loc></url>`),
    // Les biens de démonstration (fictifs) ne sont pas proposés aux moteurs de recherche.
    ...items
      .filter((i) => !i.is_demo)
      .map((i) => `<url><loc>${xmlEscape(`${origin}/biens/${i.reference}`)}</loc>${i.published_at ? `<lastmod>${i.published_at.slice(0, 10)}</lastmod>` : ''}</url>`),
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
}
