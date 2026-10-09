import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getRow, listRows, logEvent, rpc, updateRow, type Row } from '@/api/crud';
import { useAgencySettings, useQuery } from '@/api/hooks';
import { useAuth } from '@/auth/AuthContext';
import { PhotoManager } from '@/components/PhotoManager';
import { PrivateDocuments } from '@/components/PrivateDocuments';
import { StatusHistory } from '@/components/StatusHistory';
import { Badge, DefinitionList, ErrorBox, PageHeader, Section, Spinner, StatusBadge, humanError } from '@/components/ui';
import {
  AREA_UNITS, MANDATE_STATUS, PROPERTY_STATUS, PROPERTY_TYPES, PUBLIC_STATUSES, TRANSACTION_STATUS, VERIFICATION_STATUS, VISIT_STATUS, label,
} from '@/domain/labels';
import { formatDate, formatDateTime, formatNumber, formatXOF, fullName } from '@/lib/format';
import { propertySheetPdf } from '@/pages/admin/pdfDocs';

export function PropertyDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const { data: settings } = useAgencySettings();
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: p, error, loading, reload } = useQuery(
    () => getRow('properties', id, '*, owner:owners!properties_owner_id_fkey(id, reference, last_name, first_names, phone_primary)'),
    [id],
  );
  const blockers = useQuery(() => rpc<string[]>('publication_blockers', { p_property_id: id }), [id, p?.updated_at]);
  const related = useQuery(async () => {
    const [mandates, visits, transactions] = await Promise.all([
      listRows('mandates', { eq: { property_id: id }, order: { column: 'created_at' } }),
      listRows('visits', { select: 'id, reference, scheduled_at, status, interest_level, buyer:buyers!visits_buyer_id_fkey(last_name, first_names)', eq: { property_id: id }, order: { column: 'scheduled_at' } }),
      listRows('transactions', { select: 'id, reference, status, agreed_price, buyer:buyers!transactions_buyer_id_fkey(last_name, first_names)', eq: { property_id: id }, order: { column: 'created_at' } }),
    ]);
    return { mandates: mandates.rows, visits: visits.rows, transactions: transactions.rows };
  }, [id]);

  if (loading) return <Spinner />;
  if (error || !p) return <ErrorBox error={error ?? 'Bien introuvable.'} />;

  const isPublic = PUBLIC_STATUSES.includes(p.commercial_status);

  async function setStatus(status: string, extra: Row = {}) {
    setBusy(true);
    setActionError(null);
    try {
      await updateRow('properties', id, { commercial_status: status, ...extra });
      await logEvent(status === 'publie' ? 'publication' : 'depublication', 'properties', `${p!.reference} → ${status}`, id);
      reload();
    } catch (e) {
      setActionError(humanError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={p.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{p.reference}</span>
            <StatusBadge value={p.commercial_status} map={PROPERTY_STATUS} />
            <StatusBadge value={p.verification_status} map={VERIFICATION_STATUS} />
            {p.is_demo && <Badge tone="gold">Fictif</Badge>}
          </span>
        }
        actions={
          <>
            {can.sales && <Link className="btn-outline btn-sm" to={`/admin/biens/${id}/modifier`}>Modifier</Link>}
            <Link className="btn-outline btn-sm" to={`/admin/biens/${id}/apercu`}>Prévisualiser l’annonce</Link>
            {settings && (
              <button className="btn-outline btn-sm" onClick={() => void propertySheetPdf(settings, p, related.data?.mandates ?? [])}>Fiche PDF</button>
            )}
          </>
        }
      />

      {can.sales && (
        <Section title="Publication sur le site">
          {isPublic ? (
            <div className="space-y-3 text-sm">
              <p>
                L’annonce est <strong>en ligne</strong> depuis le {formatDateTime(p.published_at)}.{' '}
                <Link className="text-gold-700 underline" to={`/biens/${p.reference}`} target="_blank">Voir sur le site</Link>
              </p>
              <button className="btn-outline btn-sm" disabled={busy} onClick={() => void setStatus('disponible')}>Dépublier (retirer du site)</button>
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              {blockers.data && blockers.data.length > 0 ? (
                <>
                  <p>Conditions de publication à remplir :</p>
                  <ul className="list-inside list-disc text-amber-800">{blockers.data.map((b) => <li key={b}>{b}</li>)}</ul>
                </>
              ) : ['vendu', 'archive'].includes(p.commercial_status) ? (
                <p className="text-ink-500">Un bien vendu ou archivé ne peut pas être publié. Son historique est conservé.</p>
              ) : (
                <p className="text-emerald-800">Toutes les conditions sont remplies.</p>
              )}
              <button
                className="btn-gold btn-sm"
                disabled={busy || Boolean(blockers.data?.length) || ['vendu', 'archive'].includes(p.commercial_status)}
                onClick={() => void setStatus('publie')}
              >
                Publier l’annonce
              </button>
            </div>
          )}
          <ErrorBox error={actionError} />
        </Section>
      )}

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Section title="Informations">
            <DefinitionList
              items={[
                ['Type', label(PROPERTY_TYPES, p.property_type)],
                ['Prix', `${formatXOF(p.price_xof)}${p.negotiable ? ' (négociable)' : ''}`],
                ['Localisation', [p.district, p.city, p.region].filter(Boolean).join(', ')],
                ['Localisation descriptive', p.location_description],
                ['Superficie', p.area ? `${formatNumber(p.area, 2)} ${label(AREA_UNITS, p.area_unit)}` : '—'],
                ['Chambres / salles d’eau', `${p.bedrooms ?? '—'} / ${p.bathrooms ?? '—'}`],
                ['Coordonnées (privées)', p.latitude ? `${p.latitude}, ${p.longitude}` : '—'],
                ['Caractéristiques', p.features?.length ? p.features.join(', ') : '—'],
                ['Origine', p.listing_origin],
                ['Motif d’indisponibilité', p.unavailability_reason],
                ['Créé le', formatDateTime(p.created_at)],
                ['Modifié le', formatDateTime(p.updated_at)],
              ]}
            />
            {p.description && <p className="mt-4 text-sm whitespace-pre-line text-ink-700">{p.description}</p>}
          </Section>
          <PhotoManager propertyId={id} editable={can.sales} onChange={() => blockers.reload()} />
          {can.sales && <PrivateDocuments propertyId={id} />}
        </div>
        <div className="space-y-5">
          <Section title="Propriétaire">
            {p.owner ? (
              <div className="text-sm">
                <Link className="font-medium underline" to={`/admin/proprietaires/${p.owner.id}`}>{fullName(p.owner)}</Link>
                <div className="text-ink-500">{p.owner.reference}</div>
                <div>{p.owner.phone_primary}</div>
              </div>
            ) : <p className="text-sm text-ink-500">Aucun propriétaire associé.</p>}
          </Section>
          <Section title="Mandats" actions={can.sales && p.owner ? <Link className="btn-outline btn-sm" to={`/admin/mandats/nouveau?property_id=${id}&owner_id=${p.owner.id}&retour=/admin/biens/${id}`}>+ Mandat</Link> : null}>
            <MiniList rows={related.data?.mandates} render={(m) => <><Link to={`/admin/mandats/${m.id}/modifier`} className="font-mono text-xs underline">{m.reference}</Link> <StatusBadge value={m.status} map={MANDATE_STATUS} /> <span className="text-xs text-ink-500">jusqu’au {formatDate(m.end_date)}</span></>} />
          </Section>
          <Section title="Visites" actions={can.sales ? <Link className="btn-outline btn-sm" to={`/admin/visites/nouveau?property_id=${id}&retour=/admin/biens/${id}`}>+ Visite</Link> : null}>
            <MiniList rows={related.data?.visits} render={(v) => <><Link to={`/admin/visites/${v.id}/modifier`} className="underline">{formatDateTime(v.scheduled_at)}</Link> — {fullName(v.buyer)} <StatusBadge value={v.status} map={VISIT_STATUS} /></>} />
          </Section>
          <Section title="Négociations" actions={can.negotiate && p.owner ? <Link className="btn-outline btn-sm" to={`/admin/transactions/nouveau?property_id=${id}&owner_id=${p.owner.id}&initial_asking_price=${p.price_xof ?? ''}`}>+ Dossier</Link> : null}>
            <MiniList rows={related.data?.transactions} render={(t) => <><Link to={`/admin/transactions/${t.id}`} className="font-mono text-xs underline">{t.reference}</Link> — {fullName(t.buyer)} <StatusBadge value={t.status} map={TRANSACTION_STATUS} /></>} />
          </Section>
          <StatusHistory entityType="properties" entityId={id} map={PROPERTY_STATUS} />
        </div>
      </div>
    </div>
  );
}

function MiniList({ rows, render }: { rows: Row[] | undefined; render: (r: Row) => React.ReactNode }) {
  if (!rows) return <Spinner />;
  if (!rows.length) return <p className="text-sm text-ink-500">Aucun élément.</p>;
  return <ul className="space-y-2 text-sm">{rows.map((r) => <li key={r.id} className="flex flex-wrap items-center gap-1.5">{render(r)}</li>)}</ul>;
}

export { MiniList };
