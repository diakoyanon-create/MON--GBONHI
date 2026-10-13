import { useParams } from 'react-router-dom';
import { getRow, listRows } from '@/api/crud';
import { useQuery } from '@/api/hooks';
import type { PublicProperty } from '@/api/publicApi';
import { ErrorBox, Spinner } from '@/components/ui';
import { PropertyView } from '@/pages/public/PublicPages';

/** Prévisualisation d'une annonce (même non publiée) avec uniquement les champs publics. */
export function PropertyPreviewPage() {
  const { id = '' } = useParams();
  const { data, loading, error } = useQuery(async () => {
    const p = await getRow('properties', id, 'id, reference, property_type, title, description, region, city, district, location_description, price_xof, negotiable, area, area_unit, bedrooms, bathrooms, features, commercial_status, is_featured, is_demo, published_at');
    if (!p) return null;
    const { rows } = await listRows('property_photos', { select: 'id, storage_path, caption, is_primary, position', eq: { property_id: id }, order: { column: 'position', ascending: true }, pageSize: 100 });
    const photos = [...rows].sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
    return { property: { ...p, primary_photo_path: photos[0]?.storage_path ?? null } as PublicProperty, photos: photos as Array<{ id: string; storage_path: string; caption: string | null }> };
  }, [id]);
  if (loading) return <Spinner />;
  if (error || !data) return <ErrorBox error={error ?? 'Bien introuvable.'} />;
  return <div className="-mx-4 rounded-xl bg-cream sm:-mx-6 lg:-mx-8"><PropertyView property={data.property} photos={data.photos} preview /></div>;
}
