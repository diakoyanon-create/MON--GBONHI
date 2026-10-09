import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getRow, listRows, rpc, updateRow, type Row } from '@/api/crud';
import { useAgencySettings, useQuery } from '@/api/hooks';
import { useAuth } from '@/auth/AuthContext';
import { InteractionsPanel } from '@/components/InteractionsPanel';
import { PrivateDocuments } from '@/components/PrivateDocuments';
import { StatusHistory } from '@/components/StatusHistory';
import { DefinitionList, ErrorBox, Modal, PageHeader, Section, Spinner, StatusBadge, humanError } from '@/components/ui';
import {
  BUYER_STATUS, CONTACT_PREF, INQUIRY_SOURCE, INQUIRY_STATUS, MANDATE_STATUS, PROPERTY_STATUS, PROPERTY_TYPES, VERIFICATION_STATUS, VISIT_STATUS, label, options,
} from '@/domain/labels';
import { whatsappLink } from '@/domain/whatsapp';
import { formatDate, formatDateTime, formatXOF, fullName } from '@/lib/format';
import { ResourceForm } from '@/resources/ResourceForm';
import type { FieldDef } from '@/resources/types';
import { REL } from '@/resources/configs';
import { MiniList } from './PropertyDetailPage';
import { buyerSheetPdf, ownerSheetPdf } from './pdfDocs';

function contactLinks(phone: string | null | undefined) {
  if (!phone) return null;
  const tel = phone.replace(/[^\d+]/g, '');
  const wa = whatsappLink(phone, null);
  return (
    <span className="flex flex-wrap gap-2">
      <a className="btn-outline btn-sm" href={`tel:${tel}`}>Appeler</a>
      {wa && <a className="btn-outline btn-sm" href={wa} target="_blank" rel="noopener noreferrer">WhatsApp</a>}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Propriétaire
// ---------------------------------------------------------------------------
const checkFields: FieldDef[] = [
  { name: 'doc_type', label: 'Type de document', type: 'text', required: true, placeholder: 'Titre foncier, ACD, CNI…' },
  { name: 'doc_reference', label: 'Référence du document', type: 'text' },
  { name: 'property_id', label: 'Bien concerné', type: 'relation', relation: REL.property },
  { name: 'received_date', label: 'Date de réception', type: 'date' },
  { name: 'verification_status', label: 'Statut de vérification', type: 'select', required: true, options: options.verification },
  { name: 'verified_at', label: 'Date de vérification', type: 'date', help: 'Obligatoire si « Vérifié ».', showIf: (v) => v.verification_status === 'verifie' },
  { name: 'comment', label: 'Commentaire', type: 'textarea' },
];

export function OwnerDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const { data: settings } = useAgencySettings();
  const [check, setCheck] = useState<Row | null | 'new'>(null);
  const { data: o, error, loading } = useQuery(() => getRow('owners', id), [id]);
  const rel = useQuery(async () => {
    const [props, mandates, checks] = await Promise.all([
      listRows('properties', { select: 'id, reference, title, commercial_status, price_xof', eq: { owner_id: id }, pageSize: 200 }),
      listRows('mandates', { select: 'id, reference, status, end_date', eq: { owner_id: id }, pageSize: 200 }),
      listRows('document_checks', { select: '*, property:properties!document_checks_property_id_fkey(reference)', eq: { owner_id: id }, order: { column: 'created_at' }, pageSize: 200 }),
    ]);
    return { props: props.rows, mandates: mandates.rows, checks: checks.rows };
  }, [id]);

  if (loading) return <Spinner />;
  if (error || !o) return <ErrorBox error={error ?? 'Propriétaire introuvable.'} />;

  return (
    <div className="space-y-5">
      <PageHeader
        title={fullName(o)}
        subtitle={<span className="flex flex-wrap items-center gap-2"><span className="font-mono">{o.reference}</span><StatusBadge value={o.verification_status} map={VERIFICATION_STATUS} /></span>}
        actions={
          <>
            {can.sales && <Link className="btn-outline btn-sm" to={`/admin/proprietaires/${id}/modifier`}>Modifier</Link>}
            {can.sales && <Link className="btn-outline btn-sm" to={`/admin/biens/nouveau?owner_id=${id}`}>+ Bien</Link>}
            {settings && <button className="btn-outline btn-sm" onClick={() => void ownerSheetPdf(settings, o)}>Fiche PDF</button>}
          </>
        }
      />
      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Section title="Coordonnées" actions={contactLinks(o.phone_primary)}>
            <DefinitionList items={[
              ['Téléphone principal', o.phone_primary], ['Téléphone secondaire', o.phone_secondary], ['Courriel', o.email],
              ['Préférence de contact', label(CONTACT_PREF, o.contact_preference)], ['Localité', o.locality], ['Adresse', o.address],
              ['Premier contact', formatDate(o.first_contact_date)], ['Source', o.source],
            ]} />
            {o.notes && <p className="mt-4 text-sm whitespace-pre-line text-ink-700">{o.notes}</p>}
          </Section>
          <Section title="Contrôle des documents" actions={can.sales && <button className="btn-outline btn-sm" onClick={() => setCheck('new')}>+ Contrôle</button>}>
            <p className="mb-3 text-xs text-ink-500">Les informations juridiques restent « à vérifier » tant que le contrôle nécessaire n’a pas été réalisé.</p>
            {!rel.data ? <Spinner /> : rel.data.checks.length === 0 ? <p className="text-sm text-ink-500">Aucun document enregistré.</p> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Type</th><th>Référence</th><th>Reçu</th><th>Statut</th><th>Vérifié le</th><th /></tr></thead>
                  <tbody>
                    {rel.data.checks.map((c) => (
                      <tr key={c.id}>
                        <td>{c.doc_type}{c.property ? <div className="text-xs text-ink-500">{c.property.reference}</div> : null}</td>
                        <td>{c.doc_reference ?? '—'}</td>
                        <td>{formatDate(c.received_date)}</td>
                        <td><StatusBadge value={c.verification_status} map={VERIFICATION_STATUS} /></td>
                        <td>{formatDate(c.verified_at)}</td>
                        <td>{can.sales && <button className="btn-ghost btn-sm" onClick={() => setCheck(c)}>Modifier</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
          {can.sales && <PrivateDocuments ownerId={id} />}
          <InteractionsPanel ownerId={id} />
        </div>
        <div className="space-y-5">
          <Section title="Biens">
            <MiniList rows={rel.data?.props} render={(p) => <><Link className="underline" to={`/admin/biens/${p.id}`}>{p.reference}</Link> {p.title} <StatusBadge value={p.commercial_status} map={PROPERTY_STATUS} /></>} />
          </Section>
          <Section title="Mandats">
            <MiniList rows={rel.data?.mandates} render={(m) => <><Link className="font-mono text-xs underline" to={`/admin/mandats/${m.id}/modifier`}>{m.reference}</Link> <StatusBadge value={m.status} map={MANDATE_STATUS} /> <span className="text-xs text-ink-500">→ {formatDate(m.end_date)}</span></>} />
          </Section>
        </div>
      </div>
      <Modal open={check !== null} title={check === 'new' ? 'Nouveau contrôle de document' : 'Modifier le contrôle'} onClose={() => setCheck(null)}>
        {check !== null && (
          <ResourceForm
            table="document_checks"
            fields={checkFields}
            row={check === 'new' ? null : check}
            defaults={{ verification_status: 'a_verifier' }}
            extra={{ owner_id: id }}
            onSaved={() => { setCheck(null); rel.reload(); }}
            onCancel={() => setCheck(null)}
          />
        )}
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Acheteur / prospect
// ---------------------------------------------------------------------------
export function BuyerDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const { data: settings } = useAgencySettings();
  const { data: b, error, loading } = useQuery(() => getRow('buyers', id), [id]);
  const rel = useQuery(async () => {
    const [matches, visits, dups] = await Promise.all([
      rpc<Row[]>('property_matches', { p_buyer_id: id }),
      listRows('visits', { select: 'id, reference, scheduled_at, status, property:properties!visits_property_id_fkey(reference, title)', eq: { buyer_id: id }, order: { column: 'scheduled_at' } }),
      getRow('buyers', id, 'phone, email').then((r) => (r ? rpc<Row[]>('find_duplicate_contacts', { p_phone: r.phone, p_email: r.email, p_exclude: id }) : [])),
    ]);
    return { matches, visits: visits.rows, dups };
  }, [id]);

  if (loading) return <Spinner />;
  if (error || !b) return <ErrorBox error={error ?? 'Prospect introuvable.'} />;

  return (
    <div className="space-y-5">
      <PageHeader
        title={fullName(b)}
        subtitle={<span className="flex flex-wrap items-center gap-2"><span className="font-mono">{b.reference}</span><StatusBadge value={b.status} map={BUYER_STATUS} /></span>}
        actions={
          <>
            {can.sales && <Link className="btn-outline btn-sm" to={`/admin/acheteurs/${id}/modifier`}>Modifier</Link>}
            {can.sales && <Link className="btn-outline btn-sm" to={`/admin/visites/nouveau?buyer_id=${id}&retour=/admin/acheteurs/${id}`}>+ Visite</Link>}
            {can.sales && <Link className="btn-outline btn-sm" to={`/admin/taches/nouveau?buyer_id=${id}&title=${encodeURIComponent(`Relancer ${fullName(b)}`)}`}>+ Rappel</Link>}
            {settings && <button className="btn-outline btn-sm" onClick={() => void buyerSheetPdf(settings, b)}>Fiche PDF</button>}
          </>
        }
      />
      {rel.data && rel.data.dups.length > 0 && (
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <strong>Doublon possible :</strong>{' '}
          {rel.data.dups.map((d, i) => (
            <span key={d.id}>
              {i > 0 && ', '}
              <Link className="underline" to={d.kind === 'acheteur' ? `/admin/acheteurs/${d.id}` : `/admin/proprietaires/${d.id}`}>{d.full_name} ({d.reference}, {d.kind})</Link>
            </span>
          ))}
          . Vérifiez avant de fusionner manuellement.
        </div>
      )}
      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Section title="Profil et besoin" actions={contactLinks(b.phone)}>
            <DefinitionList items={[
              ['Téléphone', b.phone], ['Courriel', b.email],
              ['Budget', b.budget_min || b.budget_max ? `${formatXOF(b.budget_min)} → ${formatXOF(b.budget_max)}` : '—'],
              ['Zones', b.zones?.join(', ') || '—'],
              ['Types de biens', b.property_types?.map((t: string) => label(PROPERTY_TYPES, t)).join(', ') || '—'],
              ['Superficie min.', b.area_min ?? '—'], ['Chambres min.', b.bedrooms_min ?? '—'], ['Délai', b.project_timeline],
              ['Source', b.source], ['Préférence', label(CONTACT_PREF, b.contact_preference)],
              ['Dernier contact', formatDateTime(b.last_contact_at)], ['Prochaine relance', formatDateTime(b.next_follow_up_at)],
              ['Consentement contact', b.consent_contact ? `Oui (${formatDate(b.consent_date)})` : 'Non'],
              ['Accepte les offres', b.consent_marketing ? 'Oui' : 'Non'],
            ]} />
            {b.notes && <p className="mt-4 text-sm whitespace-pre-line text-ink-700">{b.notes}</p>}
          </Section>
          <InteractionsPanel buyerId={id} />
        </div>
        <div className="space-y-5">
          <Section title="Biens correspondant aux critères">
            <MiniList rows={rel.data?.matches} render={(p) => <><Link className="underline" to={`/admin/biens/${p.id}`}>{p.reference}</Link> {p.title} — {formatXOF(p.price_xof)}</>} />
          </Section>
          <Section title="Visites">
            <MiniList rows={rel.data?.visits} render={(v) => <><Link className="underline" to={`/admin/visites/${v.id}/modifier`}>{formatDateTime(v.scheduled_at)}</Link> {v.property?.reference} <StatusBadge value={v.status} map={VISIT_STATUS} /></>} />
          </Section>
          <StatusHistory entityType="buyers" entityId={id} map={BUYER_STATUS} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Demande
// ---------------------------------------------------------------------------
export function InquiryDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: i, error, loading, reload } = useQuery(
    () => getRow('inquiries', id, '*, property:properties!inquiries_property_id_fkey(id, reference, title), buyer:buyers!inquiries_buyer_id_fkey(id, reference, last_name, first_names)'),
    [id],
  );
  const dups = useQuery(() => (i ? rpc<Row[]>('find_duplicate_contacts', { p_phone: i.phone, p_email: i.email }) : Promise.resolve([])), [i?.id]);

  if (loading) return <Spinner />;
  if (error || !i) return <ErrorBox error={error ?? 'Demande introuvable.'} />;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setErr(humanError(e));
    } finally {
      setBusy(false);
    }
  };
  const buyerDups = (dups.data ?? []).filter((d) => d.kind === 'acheteur');

  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader
        title={`Demande de ${i.full_name}`}
        subtitle={<span className="flex flex-wrap items-center gap-2"><span className="font-mono">{i.reference}</span><StatusBadge value={i.status} map={INQUIRY_STATUS} /></span>}
        actions={can.sales && <Link className="btn-outline btn-sm" to={`/admin/demandes/${id}/modifier`}>Modifier</Link>}
      />
      <Section title="Message" actions={contactLinks(i.phone)}>
        <p className="text-sm whitespace-pre-line">{i.message}</p>
        <div className="mt-4">
          <DefinitionList items={[
            ['Reçue le', formatDateTime(i.created_at)], ['Canal', label(INQUIRY_SOURCE, i.source)],
            ['Téléphone', i.phone], ['Courriel', i.email], ['Préférence de contact', label(CONTACT_PREF, i.contact_preference)],
            ['Bien', i.property ? <Link className="underline" to={`/admin/biens/${i.property.id}`}>{i.property.reference} — {i.property.title}</Link> : i.property_reference_input ? `${i.property_reference_input} (non rattachée)` : '—'],
            ['Consentement', i.consent ? `Oui${i.consent_text ? ` — « ${i.consent_text} »` : ''}` : 'Non'],
            ['Prospect lié', i.buyer ? <Link className="underline" to={`/admin/acheteurs/${i.buyer.id}`}>{fullName(i.buyer)} ({i.buyer.reference})</Link> : '—'],
          ]} />
        </div>
      </Section>
      {can.sales && (
        <Section title="Traitement">
          <div className="flex flex-wrap gap-2">
            {i.status === 'nouveau' && <button className="btn-outline btn-sm" disabled={busy} onClick={() => void run(() => updateRow('inquiries', id, { status: 'en_cours' }))}>Prendre en charge</button>}
            {!i.buyer_id && (
              <button className="btn-primary btn-sm" disabled={busy} onClick={() => void run(async () => {
                const buyerId = await rpc<string>('convert_inquiry_to_buyer', { p_inquiry_id: id });
                navigate(`/admin/acheteurs/${buyerId}`);
              })}>Créer un prospect</button>
            )}
            {!i.buyer_id && buyerDups.map((d) => (
              <button key={d.id} className="btn-outline btn-sm" disabled={busy} onClick={() => void run(() => rpc('convert_inquiry_to_buyer', { p_inquiry_id: id, p_existing_buyer: d.id }))}>
                Rattacher à {d.full_name} ({d.reference})
              </button>
            ))}
            {i.buyer_id && i.property_id && <Link className="btn-outline btn-sm" to={`/admin/visites/nouveau?property_id=${i.property_id}&buyer_id=${i.buyer_id}`}>Programmer une visite</Link>}
            {!['traite', 'converti'].includes(i.status) && <button className="btn-outline btn-sm" disabled={busy} onClick={() => void run(() => updateRow('inquiries', id, { status: 'traite' }))}>Marquer traitée</button>}
            {i.status !== 'sans_suite' && <button className="btn-ghost btn-sm" disabled={busy} onClick={() => void run(() => updateRow('inquiries', id, { status: 'sans_suite' }))}>Sans suite</button>}
            {i.status !== 'spam' && <button className="btn-ghost btn-sm text-red-700" disabled={busy} onClick={() => void run(() => updateRow('inquiries', id, { status: 'spam' }))}>Indésirable</button>}
          </div>
          {buyerDups.length > 0 && !i.buyer_id && <p className="mt-2 text-xs text-amber-800">Un prospect existant a le même téléphone ou courriel : préférez le rattachement.</p>}
          <ErrorBox error={err} />
        </Section>
      )}
      <StatusHistory entityType="inquiries" entityId={id} map={INQUIRY_STATUS} />
    </div>
  );
}
