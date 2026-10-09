import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  CATALOG_PAGE_SIZE, fetchCatalog, fetchFeatured, fetchPublicCities, fetchPublicProperty, fetchSimilar, type CatalogFilters, type PublicProperty,
} from '@/api/publicApi';
import { usePublicAgency, useQuery } from '@/api/hooks';
import { InquiryForm } from '@/components/InquiryForm';
import { PropertyCard } from '@/components/PropertyCard';
import { EmptyState, ErrorBox, Spinner } from '@/components/ui';
import { AREA_UNITS, PROPERTY_TYPES, PUBLIC_STATUS, label, options } from '@/domain/labels';
import { whatsappLink } from '@/domain/whatsapp';
import { formatNumber, formatXOF } from '@/lib/format';
import { photoUrl } from '@/lib/photos';
import { useSeo } from '@/lib/seo';

const DEMO_NOTICE = 'Les biens marqués « Exemple fictif » servent uniquement à la démonstration et ne sont pas disponibles à la vente.';

// ---------------------------------------------------------------------------
// Accueil
// ---------------------------------------------------------------------------
export function HomePage() {
  const { data: agency } = usePublicAgency();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const featured = useQuery(() => fetchFeatured(6), []);
  useSeo({ title: agency?.agency_name ?? 'Agence immobilière', description: agency?.tagline ?? 'Biens immobiliers à vendre en Côte d’Ivoire.', siteName: undefined });

  const search = (e: FormEvent) => {
    e.preventDefault();
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    if (type) p.set('type', type);
    navigate(`/biens?${p}`);
  };
  const hasDemo = featured.data?.some((p) => p.is_demo);

  return (
    <>
      <section className="bg-ink-900 text-cream">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:py-20">
          <p className="text-sm tracking-[0.2em] text-gold-300 uppercase">Côte d’Ivoire</p>
          <h1 className="mt-3 max-w-2xl font-display text-3xl leading-tight sm:text-5xl">{agency?.tagline ?? 'Trouvez le bien qui vous correspond'}</h1>
          <form onSubmit={search} role="search" className="mt-8 grid max-w-3xl gap-2 rounded-xl bg-white p-2 sm:grid-cols-[1fr_auto_auto]">
            <label className="sr-only" htmlFor="home-q">Ville, quartier ou référence</label>
            <input id="home-q" className="input border-0" placeholder="Ville, quartier ou référence…" value={q} onChange={(e) => setQ(e.target.value)} />
            <label className="sr-only" htmlFor="home-type">Type de bien</label>
            <select id="home-type" className="input border-0 sm:w-48" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">Tous les types</option>
              {options.propertyTypes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <button className="btn-gold">Rechercher</button>
          </form>
          <div className="mt-6 flex flex-wrap gap-2">
            {options.propertyTypes.filter((o) => o.value !== 'autre').map((o) => (
              <Link key={o.value} to={`/biens?type=${o.value}`} className="rounded-full border border-ink-700 px-3 py-1.5 text-sm text-ink-200 hover:border-gold-500 hover:text-gold-300">{o.label}</Link>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12">
        <div className="mb-6 flex items-end justify-between gap-4">
          <h2 className="font-display text-2xl">Biens récents et à la une</h2>
          <Link to="/biens" className="text-sm text-gold-700 underline">Voir tous les biens</Link>
        </div>
        {featured.loading ? <Spinner /> : featured.error ? <ErrorBox error="Le catalogue est momentanément indisponible." /> : !featured.data?.length ? (
          <EmptyState>Aucun bien publié pour le moment.</EmptyState>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{featured.data.map((p) => <PropertyCard key={p.id} p={p} />)}</div>
        )}
        {hasDemo && <p className="mt-4 text-xs text-ink-500">{DEMO_NOTICE}</p>}
      </section>

      {agency && (agency.zones_served?.length > 0 || agency.about) && (
        <section className="bg-cream-200">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 md:grid-cols-2">
            {agency.about && (
              <div>
                <h2 className="font-display text-2xl">L’agence</h2>
                <p className="mt-3 whitespace-pre-line text-ink-700">{agency.about}</p>
                <Link to="/a-propos" className="mt-4 inline-block text-sm text-gold-700 underline">En savoir plus</Link>
              </div>
            )}
            {agency.zones_served?.length > 0 && (
              <div>
                <h2 className="font-display text-2xl">Zones desservies</h2>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {agency.zones_served.map((z: string) => (
                    <li key={z}><Link to={`/biens?q=${encodeURIComponent(z)}`} className="inline-block rounded-full bg-white px-3 py-1.5 text-sm shadow-sm hover:text-gold-700">{z}</Link></li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      )}

      <section className="mx-auto max-w-3xl px-4 py-12">
        <h2 className="font-display text-2xl">Un projet ? Contactez-nous</h2>
        <p className="mt-2 text-ink-500">Décrivez votre recherche : nous vous proposerons des biens adaptés.</p>
        <div className="card mt-6 p-5"><InquiryForm /></div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------
export function CatalogPage() {
  const [params, setParams] = useSearchParams();
  const filters: CatalogFilters = {
    type: params.get('type') ?? '', city: params.get('ville') ?? '', district: params.get('quartier') ?? '',
    minPrice: params.get('prix_min') ?? '', maxPrice: params.get('prix_max') ?? '', minArea: params.get('surface_min') ?? '',
    bedrooms: params.get('chambres') ?? '', q: params.get('q') ?? '', sort: (params.get('tri') as CatalogFilters['sort']) ?? 'recent',
  };
  const page = Number(params.get('page') ?? 0);
  const [draft, setDraft] = useState(filters);
  useEffect(() => setDraft(filters), [params.toString()]); // eslint-disable-line react-hooks/exhaustive-deps
  const cities = useQuery(fetchPublicCities, []);
  const { data, error, loading } = useQuery(() => fetchCatalog(filters, page), [params.toString()]);
  useSeo({ title: filters.type ? `${label(PROPERTY_TYPES, filters.type)}s à vendre` : 'Biens à vendre', description: 'Terrains, maisons, appartements et locaux commerciaux à vendre en Côte d’Ivoire. Prix en FCFA.' });

  const apply = (e?: FormEvent) => {
    e?.preventDefault();
    const p = new URLSearchParams();
    const map: Array<[keyof CatalogFilters, string]> = [['type', 'type'], ['city', 'ville'], ['district', 'quartier'], ['minPrice', 'prix_min'], ['maxPrice', 'prix_max'], ['minArea', 'surface_min'], ['bedrooms', 'chambres'], ['q', 'q'], ['sort', 'tri']];
    for (const [k, name] of map) {
      const val = draft[k];
      if (val && !(k === 'sort' && val === 'recent')) p.set(name, String(val));
    }
    setParams(p);
  };
  const setD = (k: keyof CatalogFilters, val: string) => setDraft((d) => ({ ...d, [k]: val }));
  const count = data?.count ?? 0;
  const pages = Math.ceil(count / CATALOG_PAGE_SIZE);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="font-display text-3xl">Biens à vendre</h1>
      <form onSubmit={apply} className="card mt-5 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Filtres">
        <div><label className="label" htmlFor="c-q">Recherche</label><input id="c-q" className="input" placeholder="Mot-clé ou référence" value={draft.q} onChange={(e) => setD('q', e.target.value)} /></div>
        <div><label className="label" htmlFor="c-type">Type</label>
          <select id="c-type" className="input" value={draft.type} onChange={(e) => setD('type', e.target.value)}>
            <option value="">Tous</option>{options.propertyTypes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div><label className="label" htmlFor="c-ville">Commune / ville</label>
          <select id="c-ville" className="input" value={draft.city} onChange={(e) => setD('city', e.target.value)}>
            <option value="">Toutes</option>{cities.data?.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div><label className="label" htmlFor="c-quartier">Quartier</label><input id="c-quartier" className="input" value={draft.district} onChange={(e) => setD('district', e.target.value)} /></div>
        <div><label className="label" htmlFor="c-min">Budget min. (FCFA)</label><input id="c-min" className="input" inputMode="numeric" value={draft.minPrice} onChange={(e) => setD('minPrice', e.target.value.replace(/\D/g, ''))} /></div>
        <div><label className="label" htmlFor="c-max">Budget max. (FCFA)</label><input id="c-max" className="input" inputMode="numeric" value={draft.maxPrice} onChange={(e) => setD('maxPrice', e.target.value.replace(/\D/g, ''))} /></div>
        <div><label className="label" htmlFor="c-surf">Superficie min.</label><input id="c-surf" className="input" inputMode="numeric" value={draft.minArea} onChange={(e) => setD('minArea', e.target.value.replace(/\D/g, ''))} /></div>
        <div><label className="label" htmlFor="c-ch">Chambres min.</label><input id="c-ch" className="input" inputMode="numeric" value={draft.bedrooms} onChange={(e) => setD('bedrooms', e.target.value.replace(/\D/g, ''))} /></div>
        <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-4">
          <button className="btn-primary">Filtrer</button>
          <button type="button" className="btn-ghost" onClick={() => setParams(new URLSearchParams())}>Réinitialiser</button>
          <label className="ml-auto flex items-center gap-2 text-sm"><span>Trier</span>
            <select className="input w-auto" value={draft.sort} onChange={(e) => { setD('sort', e.target.value); }} aria-label="Trier">
              <option value="recent">Plus récents</option><option value="prix-asc">Prix croissant</option><option value="prix-desc">Prix décroissant</option>
            </select>
          </label>
        </div>
      </form>
      <div className="mt-6" aria-live="polite">
        {loading ? <Spinner /> : error ? <ErrorBox error="Le catalogue est momentanément indisponible." /> : !data?.rows.length ? (
          <EmptyState>Aucun bien ne correspond à ces critères. <button className="underline" onClick={() => setParams(new URLSearchParams())}>Voir tous les biens</button></EmptyState>
        ) : (
          <>
            <p className="mb-4 text-sm text-ink-500">{count} bien{count > 1 ? 's' : ''}</p>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{data.rows.map((p) => <PropertyCard key={p.id} p={p} />)}</div>
            {data.rows.some((p) => p.is_demo) && <p className="mt-4 text-xs text-ink-500">{DEMO_NOTICE}</p>}
            {pages > 1 && (
              <nav className="mt-8 flex items-center justify-center gap-3" aria-label="Pagination">
                <button className="btn-outline" disabled={page === 0} onClick={() => { const p = new URLSearchParams(params); p.set('page', String(page - 1)); setParams(p); window.scrollTo(0, 0); }}>← Précédent</button>
                <span className="text-sm">Page {page + 1} / {pages}</span>
                <button className="btn-outline" disabled={page + 1 >= pages} onClick={() => { const p = new URLSearchParams(params); p.set('page', String(page + 1)); setParams(p); window.scrollTo(0, 0); }}>Suivant →</button>
              </nav>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Détail d'un bien
// ---------------------------------------------------------------------------
export function PropertyPage() {
  const { reference = '' } = useParams();
  const { data, loading, error } = useQuery(() => fetchPublicProperty(reference), [reference]);
  if (loading) return <div className="mx-auto max-w-6xl px-4 py-10"><Spinner /></div>;
  if (error) return <div className="mx-auto max-w-6xl px-4 py-10"><ErrorBox error="Annonce momentanément indisponible." /></div>;
  if (!data) return <NotFoundPage message="Cette annonce n’est plus en ligne (bien vendu, retiré ou référence inconnue)." />;
  return <PropertyView property={data.property} photos={data.photos} />;
}

export function PropertyView({ property: p, photos, preview }: { property: PublicProperty; photos: Array<{ id: string; storage_path: string; caption: string | null }>; preview?: boolean }) {
  const { data: agency } = usePublicAgency();
  const [idx, setIdx] = useState(0);
  const similar = useQuery(() => (preview ? Promise.resolve([]) : fetchSimilar(p)), [p.id]);
  const location = [p.district, p.city, p.region].filter(Boolean).join(', ');
  useSeo({
    title: `${p.title} — ${location}`,
    description: `${label(PROPERTY_TYPES, p.property_type)} à vendre à ${location} : ${formatXOF(p.price_xof)}. Réf. ${p.reference}.`,
    image: photoUrl(photos[0]?.storage_path ?? p.primary_photo_path),
    noindex: preview || p.is_demo,
  });
  const wa = whatsappLink(agency?.whatsapp_number, agency?.whatsapp_message_template, p.reference);
  const current = photos[idx];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {preview && <div className="mb-4 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">Aperçu interne : cette page montre l’annonce telle qu’elle apparaîtra sur le site.</div>}
      <nav className="mb-4 text-sm text-ink-500" aria-label="Fil d’Ariane"><Link to="/biens" className="underline">Biens à vendre</Link> › {label(PROPERTY_TYPES, p.property_type)}</nav>
      <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0">
          <div className="overflow-hidden rounded-xl bg-cream-200">
            {current ? (
              <img src={photoUrl(current.storage_path) ?? ''} alt={current.caption ?? p.title} className="aspect-[4/3] w-full object-cover" />
            ) : <div className="flex aspect-[4/3] items-center justify-center text-ink-500">Photos à venir</div>}
          </div>
          {photos.length > 1 && (
            <ul className="mt-2 flex gap-2 overflow-x-auto pb-1" aria-label="Galerie">
              {photos.map((ph, i) => (
                <li key={ph.id} className="shrink-0">
                  <button onClick={() => setIdx(i)} aria-label={`Photo ${i + 1}`} aria-current={i === idx} className={`block overflow-hidden rounded-md border-2 ${i === idx ? 'border-gold-500' : 'border-transparent'}`}>
                    <img src={photoUrl(ph.storage_path) ?? ''} alt="" loading="lazy" className="h-16 w-24 object-cover" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className="badge bg-ink-900 text-gold-300">{label(PUBLIC_STATUS, p.commercial_status) || 'Aperçu'}</span>
              {p.is_demo && <span className="badge bg-amber-100 text-amber-900">Exemple fictif — non disponible</span>}
              <span className="font-mono text-xs text-ink-500">Réf. {p.reference}</span>
            </div>
            <h1 className="mt-3 font-display text-3xl">{p.title}</h1>
            <p className="mt-1 text-ink-500">{p.location_description || location}</p>
            <dl className="mt-6 grid grid-cols-2 gap-4 rounded-xl bg-white p-4 sm:grid-cols-4">
              <div><dt className="text-xs text-ink-500">Type</dt><dd className="font-medium">{label(PROPERTY_TYPES, p.property_type)}</dd></div>
              <div><dt className="text-xs text-ink-500">Superficie</dt><dd className="font-medium">{p.area ? `${formatNumber(p.area)} ${label(AREA_UNITS, p.area_unit)}` : '—'}</dd></div>
              {p.bedrooms !== null && <div><dt className="text-xs text-ink-500">Chambres</dt><dd className="font-medium">{p.bedrooms}</dd></div>}
              {p.bathrooms !== null && <div><dt className="text-xs text-ink-500">Salles d’eau</dt><dd className="font-medium">{p.bathrooms}</dd></div>}
            </dl>
            {p.description && <div className="mt-6 whitespace-pre-line text-ink-700">{p.description}</div>}
            {p.features?.length > 0 && (
              <>
                <h2 className="mt-6 font-semibold">Caractéristiques</h2>
                <ul className="mt-2 flex flex-wrap gap-2">{p.features.map((f) => <li key={f} className="badge bg-cream-200 text-ink-700">{f}</li>)}</ul>
              </>
            )}
            <p className="mt-6 text-xs text-ink-500">Les informations sont communiquées à titre indicatif et ne valent pas vérification juridique ou foncière.</p>
          </div>
        </div>
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <div className="card p-5">
            <div className="text-2xl font-semibold tabular-nums">{formatXOF(p.price_xof)}</div>
            {p.negotiable && <div className="text-sm text-ink-500">Prix négociable</div>}
            {wa && !p.is_demo && <a href={wa} target="_blank" rel="noopener noreferrer" className="btn mt-4 w-full bg-[#1f8f4e] text-white hover:bg-[#177540]">Écrire sur WhatsApp</a>}
          </div>
          <div className="card p-5">
            <h2 className="mb-3 font-semibold">Demande d’information</h2>
            {preview ? <p className="text-sm text-ink-500">Formulaire désactivé en aperçu.</p> : <InquiryForm propertyReference={p.reference} compact />}
          </div>
        </aside>
      </div>
      {!!similar.data?.length && (
        <section className="mt-12">
          <h2 className="mb-4 font-display text-2xl">Biens similaires</h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{similar.data.map((s) => <PropertyCard key={s.id} p={s} />)}</div>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pages institutionnelles
// ---------------------------------------------------------------------------
export function AboutPage() {
  const { data: a } = usePublicAgency();
  useSeo({ title: 'À propos', description: a?.tagline ?? undefined });
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="font-display text-3xl">À propos de {a?.agency_name}</h1>
      <p className="mt-4 whitespace-pre-line text-ink-700">{a?.about || 'Présentation de l’agence à compléter dans les paramètres.'}</p>
      {a?.zones_served?.length ? (
        <>
          <h2 className="mt-8 font-display text-xl">Zones desservies</h2>
          <p className="mt-2 text-ink-700">{a.zones_served.join(' · ')}</p>
        </>
      ) : null}
    </div>
  );
}

export function ContactPage() {
  const { data: a } = usePublicAgency();
  useSeo({ title: 'Contact', description: `Contactez ${a?.agency_name ?? 'l’agence'} par téléphone, WhatsApp ou via le formulaire.` });
  const wa = whatsappLink(a?.whatsapp_number, null);
  return (
    <div className="mx-auto grid max-w-5xl gap-8 px-4 py-10 md:grid-cols-[1fr_280px]">
      <div>
        <h1 className="font-display text-3xl">Contact</h1>
        <div className="card mt-6 p-5"><InquiryForm /></div>
      </div>
      <aside className="space-y-3 text-sm md:pt-16">
        {a?.phone && <p><strong>Téléphone</strong><br /><a className="underline" href={`tel:${a.phone.replace(/[^\d+]/g, '')}`}>{a.phone}</a></p>}
        {a?.email && <p><strong>Courriel</strong><br /><a className="underline" href={`mailto:${a.email}`}>{a.email}</a></p>}
        {a?.address && <p><strong>Adresse</strong><br />{a.address}</p>}
        {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="btn w-full bg-[#1f8f4e] text-white">WhatsApp</a>}
      </aside>
    </div>
  );
}

export function LegalPage({ kind }: { kind: 'mentions' | 'confidentialite' }) {
  const { data: a } = usePublicAgency();
  const title = kind === 'mentions' ? 'Mentions légales' : 'Politique de confidentialité';
  useSeo({ title });
  const text = kind === 'mentions' ? a?.legal_notice : a?.privacy_policy;
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="font-display text-3xl">{title}</h1>
      {text ? <div className="mt-6 whitespace-pre-line text-ink-700">{text}</div> : (
        <div className="mt-6 space-y-3 text-ink-700">
          {kind === 'confidentialite' ? (
            <>
              <p>Les informations transmises via le formulaire (nom, téléphone, courriel facultatif, message) sont utilisées uniquement pour répondre à votre demande et assurer le suivi commercial.</p>
              <p>Elles ne sont accessibles qu’aux membres autorisés de l’agence, ne sont pas revendues et sont conservées pour une durée limitée. Vous pouvez demander l’accès, la rectification ou la suppression de vos données en contactant l’agence.</p>
              <p className="text-sm text-ink-500">Texte provisoire : la politique définitive doit être rédigée et validée selon la réglementation applicable en Côte d’Ivoire.</p>
            </>
          ) : <p className="text-sm text-ink-500">Mentions légales à compléter par l’agence dans les paramètres (raison sociale, immatriculation, responsable de publication, hébergeur).</p>}
        </div>
      )}
      <p className="mt-6 text-sm"><strong>Contact :</strong> {[a?.agency_name, a?.email, a?.phone].filter(Boolean).join(' · ')}</p>
    </div>
  );
}

export function NotFoundPage({ message }: { message?: string }) {
  useSeo({ title: 'Page introuvable', noindex: true });
  return (
    <div className="mx-auto max-w-xl px-4 py-20 text-center">
      <h1 className="font-display text-3xl">Page introuvable</h1>
      <p className="mt-3 text-ink-500">{message ?? 'La page demandée n’existe pas.'}</p>
      <Link to="/biens" className="btn-primary mt-6">Voir les biens disponibles</Link>
    </div>
  );
}
