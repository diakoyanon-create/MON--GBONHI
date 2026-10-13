// Cloudflare Pages Function : sert index.html avec les métadonnées propres à l'annonce
// (titre, description, photo) pour les robots des réseaux sociaux et des moteurs de recherche.
// Utilise uniquement la clé publique « anon » et la vue public_properties.
import { injectMeta } from '../../src/lib/ogInject';
import { propertyDescription } from '../../src/domain/propertyText';

type Env = {
  ASSETS: { fetch: (req: Request | string) => Promise<Response> };
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
};

export async function onRequestGet({ request, env, params }: { request: Request; env: Env; params: { reference: string } }): Promise<Response> {
  const page = await env.ASSETS.fetch(new URL('/', request.url).toString());
  const url = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY;
  const reference = String(params.reference ?? '').toUpperCase();
  if (!url || !key || !/^[A-Z0-9-]{2,40}$/.test(reference)) return page;
  try {
    const r = await fetch(
      `${url}/rest/v1/public_properties?select=reference,title,property_type,price_xof,district,city,region,is_demo,primary_photo_path&reference=eq.${encodeURIComponent(reference)}&limit=1`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    const [p] = r.ok ? ((await r.json()) as Array<Record<string, any>>) : [];
    const agencyRes = await fetch(`${url}/rest/v1/public_agency_info?select=agency_name&limit=1`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    const [agency] = agencyRes.ok ? ((await agencyRes.json()) as Array<{ agency_name: string }>) : [];
    if (!p) return page;
    const origin = new URL(request.url).origin;
    const photo = p.primary_photo_path
      ? String(p.primary_photo_path).startsWith('demo/')
        ? `${origin}/${p.primary_photo_path}`
        : `${url}/storage/v1/object/public/property-photos/${p.primary_photo_path}`
      : null;
    const html = injectMeta(await page.text(), {
      title: `${p.title} — ${[p.district, p.city].filter(Boolean).join(', ')}`,
      description: propertyDescription(p as never),
      url: `${origin}/biens/${p.reference}`,
      image: photo,
      siteName: agency?.agency_name ?? null,
      noindex: Boolean(p.is_demo),
    });
    const headers = new Headers(page.headers);
    headers.set('Content-Type', 'text/html; charset=utf-8');
    headers.set('Cache-Control', 'public, max-age=300');
    return new Response(html, { status: 200, headers });
  } catch {
    return page;
  }
}
