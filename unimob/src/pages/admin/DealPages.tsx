import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getRow, listRows, rpc, type Row } from '@/api/crud';
import { useAgencySettings, useQuery } from '@/api/hooks';
import { useAuth } from '@/auth/AuthContext';
import { StatusHistory } from '@/components/StatusHistory';
import { DefinitionList, ErrorBox, Modal, PageHeader, Section, Spinner, Stat, StatusBadge, humanError } from '@/components/ui';
import { COMMISSION_DISCLAIMER } from '@/domain/commission';
import { storagePath, validateFile } from '@/domain/files';
import { OFFER_STATUS, PAYMENT_METHODS, REVENUE_STATUS, REVENUE_TYPES, TRANSACTION_STATUS, VISIT_STATUS, label, options } from '@/domain/labels';
import { formatDate, formatDateTime, formatXOF, fullName, todayISO } from '@/lib/format';
import { openPrivateFile, PRIVATE_UPLOAD_OPTIONS } from '@/lib/photos';
import { parseXOF } from '@/lib/money';
import { RECEIPTS_BUCKET, supabase } from '@/lib/supabase';
import { ResourceForm } from '@/resources/ResourceForm';
import { ResourceList } from '@/resources/ResourceList';
import { visitsConfig } from '@/resources/configs';
import type { FieldDef } from '@/resources/types';
import { commissionStatementPdf, financialReportPdf, revenueStatementPdf, transactionSheetPdf, visitReportPdf } from './pdfDocs';

// ---------------------------------------------------------------------------
// Transaction (dossier de vente) + offres
// ---------------------------------------------------------------------------
const offerFields: FieldDef[] = [
  { name: 'offer_kind', label: 'Type', type: 'select', required: true, options: [{ value: 'offre', label: 'Offre' }, { value: 'contre_offre', label: 'Contre-offre' }] },
  { name: 'from_party', label: 'Émise par', type: 'select', required: true, options: [{ value: 'acheteur', label: 'Acheteur' }, { value: 'vendeur', label: 'Vendeur' }] },
  { name: 'amount', label: 'Montant (FCFA)', type: 'money', required: true, min: 1 },
  { name: 'offered_at', label: 'Date', type: 'datetime', required: true },
  { name: 'valid_until', label: 'Valable jusqu’au', type: 'date' },
  { name: 'status', label: 'Statut', type: 'select', required: true, options: options.offerStatus },
  { name: 'conditions', label: 'Conditions', type: 'text', full: true },
  { name: 'notes', label: 'Notes', type: 'textarea' },
];

export function TransactionDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const { data: settings } = useAgencySettings();
  const [offer, setOffer] = useState<Row | 'new' | null>(null);
  const { data: t, error, loading } = useQuery(
    () => getRow('transactions', id, '*, property:properties!transactions_property_id_fkey(id, reference, title), buyer:buyers!transactions_buyer_id_fkey(id, reference, last_name, first_names), owner:owners!transactions_owner_id_fkey(id, reference, last_name, first_names)'),
    [id],
  );
  const offers = useQuery(() => listRows('negotiations', { eq: { transaction_id: id }, order: { column: 'offered_at', ascending: true }, pageSize: 200 }), [id]);
  const commissionRow = useQuery(async () => {
    const { data } = await supabase.from('transaction_commissions').select('*').eq('transaction_id', id).maybeSingle();
    return data as Row | null;
  }, [id, t?.updated_at]);

  if (loading) return <Spinner />;
  if (error || !t) return <ErrorBox error={error ?? 'Dossier introuvable.'} />;
  const c = commissionRow.data;

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Dossier ${t.reference}`}
        subtitle={<StatusBadge value={t.status} map={TRANSACTION_STATUS} />}
        actions={
          <>
            {can.negotiate && <Link className="btn-outline btn-sm" to={`/admin/transactions/${id}/modifier`}>Modifier / changer le statut</Link>}
            {settings && <button className="btn-outline btn-sm" onClick={() => void transactionSheetPdf(settings, t, offers.data?.rows ?? [], c)}>Fiche PDF</button>}
          </>
        }
      />
      {t.status === 'offre_acceptee_sous_conditions' && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Offre acceptée sous conditions : la vente n’est pas conclue tant que les étapes de validation ne sont pas terminées.</p>
      )}
      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Section title="Parties et prix">
            <DefinitionList items={[
              ['Bien', <Link className="underline" to={`/admin/biens/${t.property?.id}`}>{t.property?.reference} — {t.property?.title}</Link>],
              ['Acheteur', <Link className="underline" to={`/admin/acheteurs/${t.buyer?.id}`}>{fullName(t.buyer)}</Link>],
              ['Vendeur', <Link className="underline" to={`/admin/proprietaires/${t.owner?.id}`}>{fullName(t.owner)}</Link>],
              ['Prix demandé initial', formatXOF(t.initial_asking_price)],
              ['Prix convenu', formatXOF(t.agreed_price)],
              ['Frais', formatXOF(t.fees)],
              ['Offre acceptée le', formatDate(t.offer_accepted_date)],
              ['Promesse / compromis', formatDate(t.compromise_date)],
              ['Acte', formatDate(t.deed_date)],
              ['Conclusion', formatDate(t.concluded_date)],
              ['Motif d’abandon', t.abandon_reason],
              ['Justificatifs', t.supporting_docs_note],
            ]} />
            {t.conditions && <p className="mt-4 text-sm whitespace-pre-line"><strong>Conditions : </strong>{t.conditions}</p>}
          </Section>
          <Section title="Offres et contre-offres" actions={can.negotiate && <button className="btn-outline btn-sm" onClick={() => setOffer('new')}>+ Offre</button>}>
            {offers.loading ? <Spinner /> : !offers.data?.rows.length ? <p className="text-sm text-ink-500">Aucune offre enregistrée.</p> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Date</th><th>Type</th><th>De</th><th>Montant</th><th>Statut</th><th /></tr></thead>
                  <tbody>
                    {offers.data.rows.map((o) => (
                      <tr key={o.id}>
                        <td>{formatDateTime(o.offered_at)}</td>
                        <td>{o.offer_kind === 'offre' ? 'Offre' : 'Contre-offre'}</td>
                        <td>{o.from_party}</td>
                        <td className="tabular-nums">{formatXOF(o.amount)}</td>
                        <td><StatusBadge value={o.status} map={OFFER_STATUS} /></td>
                        <td>{can.negotiate && <button className="btn-ghost btn-sm" onClick={() => setOffer(o)}>Modifier</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </div>
        <div className="space-y-5">
          {c && (
            <Section title="Commission">
              <dl className="space-y-1.5 text-sm">
                {[
                  ['Estimée (règle)', c.commission_estimated], ['Convenue', c.commission_agreed],
                  // Les montants exigibles/encaissés relèvent des finances (non visibles pour l'équipe commerciale).
                  ...(can.finance ? [['Exigible', c.commission_due], ['Encaissée', c.commission_received], ['Solde restant', c.commission_balance]] : []),
                ].map(([k, v]) => (
                  <div key={k as string} className="flex justify-between gap-3"><dt className="text-ink-500">{k}</dt><dd className="tabular-nums">{formatXOF(v as string)}</dd></div>
                ))}
              </dl>
              <p className="mt-3 text-xs text-ink-500">{COMMISSION_DISCLAIMER}</p>
            </Section>
          )}
          <StatusHistory entityType="transactions" entityId={id} map={TRANSACTION_STATUS} />
        </div>
      </div>
      <Modal open={offer !== null} title={offer === 'new' ? 'Nouvelle offre' : 'Modifier l’offre'} onClose={() => setOffer(null)}>
        {offer !== null && (
          <ResourceForm
            table="negotiations"
            fields={offerFields}
            row={offer === 'new' ? null : offer}
            defaults={{ offer_kind: 'offre', from_party: 'acheteur', status: 'en_attente', offered_at: new Date().toISOString() }}
            extra={{ transaction_id: id }}
            onSaved={() => { setOffer(null); offers.reload(); }}
            onCancel={() => setOffer(null)}
          />
        )}
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recette + encaissements
// ---------------------------------------------------------------------------
export function RevenueDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const { data: settings } = useAgencySettings();
  const [form, setForm] = useState<'payment' | 'correction' | null>(null);
  const { data: e, error, loading, reload } = useQuery(() => getRow('financial_entries', id, '*, transaction:transactions!financial_entries_transaction_id_fkey(id, reference)'), [id]);
  const payments = useQuery(() => listRows('payments', { eq: { financial_entry_id: id }, order: { column: 'created_at', ascending: true }, pageSize: 500 }), [id, e?.updated_at]);

  if (loading) return <Spinner />;
  if (error || !e) return <ErrorBox error={error ?? 'Recette introuvable.'} />;

  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader
        title={`Recette ${e.reference}`}
        subtitle={<span className="flex items-center gap-2">{label(REVENUE_TYPES, e.entry_type)} <StatusBadge value={e.status} map={REVENUE_STATUS} /></span>}
        actions={
          <>
            {can.finance && <Link className="btn-outline btn-sm" to={`/admin/finances/recettes/${id}/modifier`}>Modifier</Link>}
            {settings && <button className="btn-outline btn-sm" onClick={() => void revenueStatementPdf(settings, e, payments.data?.rows ?? [])}>Relevé PDF</button>}
          </>
        }
      />
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Attendu" value={formatXOF(e.amount_expected)} />
        <Stat label="Encaissé" value={formatXOF(e.amount_received)} />
        <Stat label="Solde" value={formatXOF(e.balance)} />
      </div>
      <Section title="Détails">
        <DefinitionList items={[
          ['Date', formatDate(e.entry_date)],
          ['Transaction', e.transaction ? <Link className="underline" to={`/admin/transactions/${e.transaction.id}`}>{e.transaction.reference}</Link> : '—'],
          ['Description', e.description], ['Dernier encaissement', formatDate(e.last_payment_date)], ['Notes', e.notes],
        ]} />
      </Section>
      <Section
        title="Encaissements"
        actions={can.finance && e.status !== 'annule' && (
          <div className="flex gap-2">
            <button className="btn-primary btn-sm" onClick={() => setForm('payment')} disabled={Number(e.balance) <= 0}>+ Encaissement</button>
            <button className="btn-outline btn-sm" onClick={() => setForm('correction')} disabled={Number(e.amount_received) <= 0}>Correction</button>
          </div>
        )}
      >
        <p className="mb-3 text-xs text-ink-500">Les encaissements ne sont jamais modifiés ni supprimés. Une erreur se corrige par une ligne de correction (montant négatif) motivée.</p>
        {payments.loading ? <Spinner /> : !payments.data?.rows.length ? <p className="text-sm text-ink-500">Aucun encaissement.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Date</th><th>Montant</th><th>Mode</th><th>Référence</th><th>Note</th><th>Justificatif</th></tr></thead>
              <tbody>
                {payments.data.rows.map((p) => (
                  <tr key={p.id} className={p.is_correction ? 'bg-red-50/50' : ''}>
                    <td>{formatDate(p.paid_on)}</td>
                    <td className="tabular-nums">{formatXOF(p.amount)}</td>
                    <td>{label(PAYMENT_METHODS, p.method)}</td>
                    <td>{p.payment_reference ?? '—'}</td>
                    <td>{p.is_correction ? <strong>Correction : </strong> : null}{p.note ?? ''}</td>
                    <td>{p.receipt_path ? <button className="btn-ghost btn-sm" onClick={() => openPrivateFile(RECEIPTS_BUCKET, p.receipt_path).catch(() => window.alert('Justificatif indisponible.'))}>Voir</button> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      <StatusHistory entityType="financial_entries" entityId={id} map={REVENUE_STATUS} />
      <Modal open={form !== null} title={form === 'correction' ? 'Correction d’encaissement' : 'Nouvel encaissement'} onClose={() => setForm(null)}>
        {form && <PaymentForm entryId={id} correction={form === 'correction'} max={form === 'correction' ? Number(e.amount_received) : Number(e.balance)} onDone={() => { setForm(null); reload(); }} />}
      </Modal>
    </div>
  );
}

function PaymentForm({ entryId, correction, max, onDone }: { entryId: string; correction: boolean; max: number; onDone: () => void }) {
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState(todayISO());
  const [method, setMethod] = useState('mobile_money');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    const n = parseXOF(amount);
    if (!Number.isInteger(n) || n <= 0) return setError('Montant entier positif en FCFA.');
    if (n > max) return setError(`Montant supérieur au maximum autorisé (${formatXOF(max)}).`);
    if (correction && note.trim().length < 5) return setError('Le motif de la correction est obligatoire.');
    setBusy(true);
    setError(null);
    let receiptPath: string | null = null;
    try {
      if (file) {
        const problem = validateFile(file, 'receipt');
        if (problem) throw new Error(problem);
        receiptPath = storagePath(entryId, file.type);
        const { error: upErr } = await supabase.storage.from(RECEIPTS_BUCKET).upload(receiptPath, file, { contentType: file.type, ...PRIVATE_UPLOAD_OPTIONS });
        if (upErr) throw upErr;
      }
      const { error: dbErr } = await supabase.from('payments').insert({
        financial_entry_id: entryId, paid_on: paidOn, amount: correction ? -n : n, method,
        payment_reference: reference.trim() || null, note: note.trim() || null, is_correction: correction, receipt_path: receiptPath,
      });
      if (dbErr) throw dbErr;
      onDone();
    } catch (e) {
      setError(humanError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <div><label className="label" htmlFor="pay-amount">{correction ? 'Montant à retirer (FCFA)' : 'Montant encaissé (FCFA)'} *</label><input id="pay-amount" className="input" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
      <div><label className="label" htmlFor="pay-date">Date *</label><input id="pay-date" type="date" className="input" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></div>
      <div><label className="label" htmlFor="pay-method">Mode de paiement *</label>
        <select id="pay-method" className="input" value={method} onChange={(e) => setMethod(e.target.value)}>{options.paymentMethods.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
      </div>
      <div><label className="label" htmlFor="pay-ref">Référence (reçu, transaction…)</label><input id="pay-ref" className="input" value={reference} onChange={(e) => setReference(e.target.value)} /></div>
      <div className="sm:col-span-2"><label className="label" htmlFor="pay-note">{correction ? 'Motif de la correction *' : 'Note'}</label><input id="pay-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <div className="sm:col-span-2"><label className="label" htmlFor="pay-file">Justificatif (PDF ou image, 10 Mo max.)</label><input id="pay-file" type="file" className="input" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
      <div className="sm:col-span-2"><ErrorBox error={error} /></div>
      <div className="sm:col-span-2"><button className="btn-primary" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button></div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Finances : accueil + rapport
// ---------------------------------------------------------------------------
export function FinancesPage() {
  const { data: settings } = useAgencySettings();
  const [from, setFrom] = useState(`${todayISO().slice(0, 4)}-01-01`);
  const [to, setTo] = useState(todayISO());
  const [err, setErr] = useState<string | null>(null);
  const report = useQuery(() => rpc<Row>('finance_report', { p_from: from, p_to: to }), [from, to]);
  const r = report.data;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Finances et commissions"
        actions={
          <>
            <Link className="btn-outline btn-sm" to="/admin/finances/recettes">Recettes</Link>
            <Link className="btn-outline btn-sm" to="/admin/finances/depenses">Dépenses</Link>
            <Link className="btn-outline btn-sm" to="/admin/finances/regles">Règles de commission</Link>
          </>
        }
      />
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-sm"><span className="text-xs text-ink-500">Du</span><input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="flex flex-col text-sm"><span className="text-xs text-ink-500">Au</span><input type="date" className="input" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        {settings && (
          <>
            <button className="btn-outline" onClick={() => financialReportPdf(settings, from, to).catch((e) => setErr(humanError(e)))}>Rapport financier PDF</button>
            <button className="btn-outline" onClick={() => commissionStatementPdf(settings).catch((e) => setErr(humanError(e)))}>Relevé des commissions PDF</button>
          </>
        )}
      </div>
      <ErrorBox error={report.error ?? err} />
      {report.loading || !r ? <Spinner /> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Recettes attendues" value={formatXOF(r.revenues_expected)} />
            <Stat label="Recettes encaissées" value={formatXOF(r.revenues_received)} />
            <Stat label="Commissions dues (solde)" value={formatXOF(r.commissions_due)} hint="Toutes périodes" />
            <Stat label="Commissions encaissées" value={formatXOF(r.commissions_received)} />
            <Stat label="Dépenses" value={formatXOF(r.expenses_total)} />
            <Stat label="Résultat simplifié" value={formatXOF(r.result)} hint="Encaissé − dépenses" />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <Section title="Recettes par type">
              <table className="table">
                <thead><tr><th>Type</th><th>Attendu</th><th>Encaissé</th><th>Solde</th></tr></thead>
                <tbody>{(r.revenues_by_type as Row[]).map((x) => <tr key={x.entry_type}><td>{label(REVENUE_TYPES, x.entry_type)}</td><td>{formatXOF(x.expected)}</td><td>{formatXOF(x.received)}</td><td>{formatXOF(x.balance)}</td></tr>)}</tbody>
              </table>
            </Section>
            <Section title="Dépenses par catégorie">
              <table className="table">
                <thead><tr><th>Catégorie</th><th>Nb</th><th>Total</th></tr></thead>
                <tbody>{(r.expenses_by_category as Row[]).map((x) => <tr key={x.category}><td>{x.category}</td><td>{x.count}</td><td>{formatXOF(x.total)}</td></tr>)}</tbody>
              </table>
            </Section>
          </div>
        </>
      )}
      <p className="text-xs text-ink-500">{COMMISSION_DISCLAIMER} Les montants attendus ne sont jamais confondus avec les montants encaissés.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Visites : liste + calendrier simple
// ---------------------------------------------------------------------------
export function VisitsPage() {
  const [view, setView] = useState<'calendrier' | 'liste'>('calendrier');
  return (
    <div>
      <div className="mb-3 flex gap-2" role="tablist">
        <button role="tab" aria-selected={view === 'calendrier'} className={view === 'calendrier' ? 'btn-primary btn-sm' : 'btn-outline btn-sm'} onClick={() => setView('calendrier')}>Calendrier</button>
        <button role="tab" aria-selected={view === 'liste'} className={view === 'liste' ? 'btn-primary btn-sm' : 'btn-outline btn-sm'} onClick={() => setView('liste')}>Liste</button>
      </div>
      {view === 'liste' ? <ResourceList config={visitsConfig} /> : <VisitsCalendar />}
    </div>
  );
}

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function VisitsCalendar() {
  const { data: settings } = useAgencySettings();
  const [start, setStart] = useState(() => {
    const t = todayISO();
    const dow = (new Date(`${t}T00:00:00Z`).getUTCDay() + 6) % 7; // lundi = 0
    return addDays(t, -dow);
  });
  const end = addDays(start, 7);
  const { data, loading, error } = useQuery(
    () => listRows('visits', {
      select: 'id, reference, scheduled_at, status, location, report, interest_level, objections, next_action, follow_up_at, property:properties!visits_property_id_fkey(reference, title), buyer:buyers!visits_buyer_id_fkey(last_name, first_names)',
      gte: { scheduled_at: `${start}T00:00:00Z` }, lte: { scheduled_at: `${end}T00:00:00Z` },
      order: { column: 'scheduled_at', ascending: true }, pageSize: 500,
    }),
    [start],
  );
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const today = todayISO();
  return (
    <div>
      <PageHeader
        title="Calendrier des visites"
        subtitle={`Semaine du ${formatDate(start)} au ${formatDate(addDays(start, 6))}`}
        actions={
          <>
            <button className="btn-outline btn-sm" onClick={() => setStart(addDays(start, -7))}>← Semaine préc.</button>
            <button className="btn-outline btn-sm" onClick={() => setStart(addDays(start, 7))}>Semaine suiv. →</button>
            <Link className="btn-primary btn-sm" to="/admin/visites/nouveau">+ Visite</Link>
          </>
        }
      />
      <ErrorBox error={error} />
      {loading ? <Spinner /> : (
        <div className="grid gap-2 md:grid-cols-7">
          {days.map((d) => {
            const items = (data?.rows ?? []).filter((v) => v.scheduled_at.slice(0, 10) === d);
            return (
              <div key={d} className={`card min-h-24 p-2 ${d === today ? 'border-gold-500' : ''}`}>
                <div className="mb-1 text-xs font-semibold text-ink-500 capitalize">
                  {new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`))}
                </div>
                <ul className="space-y-1.5">
                  {items.map((v) => (
                    <li key={v.id} className="rounded-md bg-cream-200 p-1.5 text-xs">
                      <Link to={`/admin/visites/${v.id}/modifier`} className="block">
                        <span className="font-semibold">{formatDateTime(v.scheduled_at).slice(-5)}</span> {v.property?.reference}
                        <span className="block truncate">{fullName(v.buyer)}</span>
                      </Link>
                      <div className="mt-1 flex items-center justify-between gap-1">
                        <StatusBadge value={v.status} map={VISIT_STATUS} />
                        {settings && <button className="text-[10px] underline" onClick={() => void visitReportPdf(settings, v)}>PDF</button>}
                      </div>
                    </li>
                  ))}
                  {!items.length && <li className="text-xs text-ink-300">—</li>}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
