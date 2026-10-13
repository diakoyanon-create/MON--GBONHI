import { supabase } from '@/lib/supabase';
import { isRangeError, sanitizeSearch } from './crud';

/**
 * Équivalences d'extensions.unaccent (PostgreSQL 16, relevées en base) pour les caractères que
 * la décomposition NFD ne traite pas : ligatures, lettres barrées, symboles Latin-1, ponctuation
 * typographique (apostrophe ’ des claviers mobiles, guillemets « », tirets, points de suspension).
 * Latin-1, Latin étendu A (U+00A0 à U+017F) et ponctuation (U+2010 à U+203A) donnent ainsi
 * exactement le même résultat qu'en base.
 */
const UNACCENT: Record<string, string> = {
  œ: 'oe', Œ: 'OE', æ: 'ae', Æ: 'AE', ß: 'ss', ẞ: 'SS', ø: 'o', Ø: 'O', ð: 'd', Ð: 'D', þ: 'th', Þ: 'TH',
  đ: 'd', Đ: 'D', ħ: 'h', Ħ: 'H', ı: 'i', ĳ: 'ij', Ĳ: 'IJ', ĸ: 'q', ŀ: 'l', Ŀ: 'L', ł: 'l', Ł: 'L', ŉ: "'n",
  ŋ: 'n', Ŋ: 'N', ŧ: 't', Ŧ: 'T', ſ: 's',
  '¡': '!', '¿': '?', '©': '(C)', '®': '(R)', '±': '+/-', '¼': '1/4', '½': '1/2', '¾': '3/4', '×': '*', '÷': '/', '\u00ad': '-',
  '’': "'", '‘': "'", '‛': "'", 'ʼ': "'", 'ʻ': "'", '′': "'", '‚': ',', '“': '"', '”': '"', '‟': '"', '″': '"', '„': ',,',
  '«': '<<', '»': '>>', '‹': '<', '›': '>',
  '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '―': '-', '−': '-', '…': '...', '‥': '..', '․': '.', '‖': '||',
};
const UNACCENT_RE = new RegExp(`[${Object.keys(UNACCENT).join('')}]`, 'g');

/**
 * Équivalent de lower(extensions.unaccent(t)) en base : accents retirés (NFD puis marques
 * combinantes), puis table ci-dessus, puis minuscules. « Cœur d’Angré » → « coeur d'angre ».
 */
export function unaccentLower(t: string): string {
  return t.normalize('NFD').replace(/\p{M}/gu, '').replace(UNACCENT_RE, (c) => UNACCENT[c]).toLowerCase();
}

/**
 * Terme de recherche normalisé comme search_text et district_search en base
 * (lower(extensions.unaccent(…))), puis débarrassé des caractères spéciaux de PostgREST.
 * L'ordre compte : « × » devient « * », qui doit encore être neutralisé.
 */
export function normalizeSearch(term: string): string {
  return sanitizeSearch(unaccentLower(term));
}

export type PublicProperty = {
  id: string;
  reference: string;
  property_type: string;
  title: string;
  description: string | null;
  region: string | null;
  city: string;
  district: string | null;
  location_description: string | null;
  price_xof: string | number | null;
  negotiable: boolean;
  area: string | number | null;
  area_unit: string;
  bedrooms: number | null;
  bathrooms: number | null;
  features: string[];
  commercial_status: string;
  is_featured: boolean;
  is_demo: boolean;
  published_at: string | null;
  primary_photo_path: string | null;
};

export type CatalogFilters = {
  type?: string;
  city?: string;
  district?: string;
  minPrice?: string;
  maxPrice?: string;
  minArea?: string;
  bedrooms?: string;
  q?: string;
  sort?: 'recent' | 'prix-asc' | 'prix-desc';
};

export const CATALOG_PAGE_SIZE = 12;

const CATALOG_PARAMS: Array<[keyof CatalogFilters, string]> = [
  ['type', 'type'], ['city', 'ville'], ['district', 'quartier'], ['minPrice', 'prix_min'], ['maxPrice', 'prix_max'],
  ['minArea', 'surface_min'], ['bedrooms', 'chambres'], ['q', 'q'], ['sort', 'tri'],
];

/**
 * Paramètres d'URL du catalogue à partir des filtres saisis, utilisés par « Filtrer » et par
 * le changement de tri (qui applique ainsi aussi les filtres saisis). Sans « page » : retour en page 1.
 */
export function catalogParams(f: CatalogFilters): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, name] of CATALOG_PARAMS) {
    const val = f[k];
    if (val && !(k === 'sort' && val === 'recent')) p.set(name, String(val));
  }
  return p;
}

function catalogQuery(f: CatalogFilters) {
  let q = supabase.from('public_properties').select('*', { count: 'exact' });
  if (f.type) q = q.eq('property_type', f.type);
  if (f.city) q = q.eq('city', f.city);
  const district = f.district ? normalizeSearch(f.district) : '';
  if (district) q = q.ilike('district_search', `*${district}*`);
  if (f.minPrice && Number(f.minPrice) > 0) q = q.gte('price_xof', Number(f.minPrice));
  if (f.maxPrice && Number(f.maxPrice) > 0) q = q.lte('price_xof', Number(f.maxPrice));
  if (f.minArea && Number(f.minArea) > 0) q = q.gte('area', Number(f.minArea));
  if (f.bedrooms && Number(f.bedrooms) > 0) q = q.gte('bedrooms', Number(f.bedrooms));
  // Recherche insensible aux accents : « adjame » trouve « Adjamé ».
  const term = f.q ? normalizeSearch(f.q) : '';
  if (term) q = q.ilike('search_text', `*${term}*`);
  if (f.sort === 'prix-asc') q = q.order('price_xof', { ascending: true, nullsFirst: false });
  else if (f.sort === 'prix-desc') q = q.order('price_xof', { ascending: false, nullsFirst: false });
  else q = q.order('published_at', { ascending: false, nullsFirst: false });
  return q;
}

/** Une page du catalogue ; une page au-delà du total renvoie une liste vide et le total réel. */
export async function fetchCatalog(f: CatalogFilters, page = 0) {
  const p = Number.isInteger(page) && page > 0 ? page : 0;
  const { data, error, count } = await catalogQuery(f).range(p * CATALOG_PAGE_SIZE, p * CATALOG_PAGE_SIZE + CATALOG_PAGE_SIZE - 1);
  if (error) {
    if (isRangeError(error)) {
      const { count: total } = await catalogQuery(f).range(0, 0);
      return { rows: [] as PublicProperty[], count: total ?? 0 };
    }
    throw error;
  }
  return { rows: (data ?? []) as PublicProperty[], count: count ?? 0 };
}

/** Biens mis en avant par l'agence. */
export async function fetchFeatured(limit = 6) {
  const { data, error } = await supabase
    .from('public_properties')
    .select('*')
    .eq('is_featured', true)
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as PublicProperty[];
}

/** Biens les plus récemment publiés (hors ceux déjà affichés « à la une »). */
export async function fetchRecent(limit = 6, excludeIds: string[] = []) {
  let q = supabase.from('public_properties').select('*').order('published_at', { ascending: false, nullsFirst: false }).limit(limit);
  if (excludeIds.length) q = q.not('id', 'in', `(${excludeIds.join(',')})`);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as PublicProperty[];
}

export async function fetchPublicProperty(reference: string) {
  const { data, error } = await supabase.from('public_properties').select('*').eq('reference', reference.toUpperCase()).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { data: photos } = await supabase
    .from('public_property_photos')
    .select('id, storage_path, caption, position, is_primary')
    .eq('property_id', data.id)
    .order('is_primary', { ascending: false })
    .order('position', { ascending: true });
  return { property: data as PublicProperty, photos: (photos ?? []) as Array<{ id: string; storage_path: string; caption: string | null }> };
}

export async function fetchSimilar(p: PublicProperty, limit = 3) {
  const { data } = await supabase
    .from('public_properties')
    .select('*')
    .eq('property_type', p.property_type)
    .neq('id', p.id)
    .order('published_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as PublicProperty[];
}

export async function fetchPublicCities(): Promise<string[]> {
  const { data } = await supabase.from('public_properties').select('city').order('city').limit(1000);
  return [...new Set((data ?? []).map((r: { city: string }) => r.city))].sort((a, b) => a.localeCompare(b, 'fr'));
}

export type InquiryPayload = {
  full_name: string;
  phone: string;
  email: string | null;
  property_reference: string | null;
  message: string;
  contact_preference: string;
  consent: boolean;
  website?: string;
};

/** Envoi via la fonction contrôlée submit_inquiry (aucun accès direct à la table). */
export async function submitInquiry(p: InquiryPayload): Promise<{ ok: boolean; reference?: string }> {
  const { data, error } = await supabase.rpc('submit_inquiry', {
    p_full_name: p.full_name,
    p_phone: p.phone,
    p_message: p.message,
    p_email: p.email,
    p_property_reference: p.property_reference,
    p_contact_preference: p.contact_preference,
    p_consent: p.consent,
    p_website: p.website ?? null,
  });
  if (error) throw error;
  return data as { ok: boolean; reference?: string };
}
