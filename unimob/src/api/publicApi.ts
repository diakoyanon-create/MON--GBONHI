import { supabase } from '@/lib/supabase';
import { sanitizeSearch } from './crud';

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

export async function fetchCatalog(f: CatalogFilters, page = 0) {
  let q = supabase.from('public_properties').select('*', { count: 'exact' });
  if (f.type) q = q.eq('property_type', f.type);
  if (f.city) q = q.ilike('city', sanitizeSearch(f.city));
  if (f.district) q = q.ilike('district', `*${sanitizeSearch(f.district)}*`);
  if (f.minPrice && Number(f.minPrice) > 0) q = q.gte('price_xof', Number(f.minPrice));
  if (f.maxPrice && Number(f.maxPrice) > 0) q = q.lte('price_xof', Number(f.maxPrice));
  if (f.minArea && Number(f.minArea) > 0) q = q.gte('area', Number(f.minArea));
  if (f.bedrooms && Number(f.bedrooms) > 0) q = q.gte('bedrooms', Number(f.bedrooms));
  const term = f.q ? sanitizeSearch(f.q) : '';
  if (term) q = q.or(`title.ilike.*${term}*,reference.ilike.*${term}*,city.ilike.*${term}*,district.ilike.*${term}*`);
  if (f.sort === 'prix-asc') q = q.order('price_xof', { ascending: true, nullsFirst: false });
  else if (f.sort === 'prix-desc') q = q.order('price_xof', { ascending: false, nullsFirst: false });
  else q = q.order('published_at', { ascending: false, nullsFirst: false });
  q = q.range(page * CATALOG_PAGE_SIZE, page * CATALOG_PAGE_SIZE + CATALOG_PAGE_SIZE - 1);
  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: (data ?? []) as PublicProperty[], count: count ?? 0 };
}

export async function fetchFeatured(limit = 6) {
  const { data, error } = await supabase
    .from('public_properties')
    .select('*')
    .order('is_featured', { ascending: false })
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(limit);
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
  const { data } = await supabase.from('public_properties').select('city').limit(1000);
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
