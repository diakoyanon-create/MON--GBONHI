import { Link } from 'react-router-dom';
import type { PublicProperty } from '@/api/publicApi';
import { AREA_UNITS, PROPERTY_TYPES, PUBLIC_STATUS, label } from '@/domain/labels';
import { formatNumber, formatXOF } from '@/lib/format';
import { photoUrl } from '@/lib/photos';

export function PropertyCard({ p }: { p: PublicProperty }) {
  const img = photoUrl(p.primary_photo_path);
  return (
    <article className="group card overflow-hidden transition-shadow hover:shadow-md">
      <Link to={`/biens/${p.reference}`} className="block">
        <div className="relative aspect-[4/3] overflow-hidden bg-cream-200">
          {img ? (
            <img src={img} alt={p.title} loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-ink-500">Photo à venir</div>
          )}
          <div className="absolute top-2 left-2 flex flex-wrap gap-1.5">
            <span className="badge bg-ink-900/85 text-gold-300">{label(PUBLIC_STATUS, p.commercial_status)}</span>
            {p.is_demo && <span className="badge bg-amber-100 text-amber-900">Exemple fictif</span>}
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs font-medium tracking-wide text-gold-700 uppercase">{label(PROPERTY_TYPES, p.property_type)}</div>
          <h3 className="mt-1 line-clamp-2 font-display text-lg text-ink-900">{p.title}</h3>
          <p className="mt-1 text-sm text-ink-500">{[p.district, p.city].filter(Boolean).join(', ')}</p>
          <div className="mt-3 flex items-end justify-between gap-2">
            <div className="text-lg font-semibold text-ink-900 tabular-nums">{formatXOF(p.price_xof)}</div>
            {p.area && <div className="text-sm text-ink-500">{formatNumber(p.area)} {label(AREA_UNITS, p.area_unit)}</div>}
          </div>
          <div className="mt-2 font-mono text-[11px] text-ink-300">Réf. {p.reference}</div>
        </div>
      </Link>
    </article>
  );
}
