import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { listAllRows, listRows, logEvent, rpc, updateRow, type Row } from '@/api/crud';
import { resetPublicAgencyCache, useAgencySettings, useQuery } from '@/api/hooks';
import { useAuth } from '@/auth/AuthContext';
import { ErrorBox, PageHeader, Section, Spinner, StatusBadge, SuccessBox, humanError } from '@/components/ui';
import { downloadText, toCsv, type CsvColumn } from '@/domain/csv';
import {
  BUYER_STATUS, MANDATE_STATUS, OFFER_STATUS, PROPERTY_STATUS, PROPERTY_TYPES, REVENUE_STATUS, ROLES, TASK_PRIORITY, TASK_STATUS, TRANSACTION_STATUS,
  VERIFICATION_STATUS, VISIT_STATUS, label, options,
} from '@/domain/labels';
import { formatDate, formatDateTime, fullName, todayISO } from '@/lib/format';
import { activityReportPdf, commissionStatementPdf, financialReportPdf, inventoryPdf, mandateTemplatePdf, tasksPdf } from './pdfDocs';
import type { DashboardStats } from './DashboardPage';

// ---------------------------------------------------------------------------
// Documents générés
// ---------------------------------------------------------------------------
export function DocumentsPage() {
  const { can } = useAuth();
  const { data: settings } = useAgencySettings();
  const [err, setErr] = useState<string | null>(null);
  const docs = useQuery(() => listRows('documents', { order: { column: 'generated_at' }, pageSize: 100 }), []);
  const mandates = useQuery(
    () => (can.sales ? listRows('mandates', { select: '*, property:properties!mandates_property_id_fkey(reference, title), owner:owners!mandates_owner_id_fkey(last_name, first_names)', notIn: { status: ['cloture', 'resilie'] }, order: { column: 'created_at' }, pageSize: 100 }) : Promise.resolve({ rows: [], count: 0 })),
    [can.sales],
  );
  const run = (fn: () => Promise<unknown>) => fn().then(() => docs.reload()).catch((e) => setErr(humanError(e)));

  return (
    <div className="space-y-5">
      <PageHeader title="Documents et PDF" subtitle="Les PDF sont générés dans votre navigateur ; seules leurs métadonnées sont conservées." />
      <ErrorBox error={err} />
      {settings && (
        <Section title="Générer">
          <div className="flex flex-wrap gap-2">
            {can.sales && <button className="btn-outline btn-sm" onClick={() => run(() => inventoryPdf(settings))}>Inventaire des biens</button>}
            <button className="btn-outline btn-sm" onClick={() => run(() => tasksPdf(settings))}>Liste des tâches</button>
            {can.finance && <button className="btn-outline btn-sm" onClick={() => run(() => commissionStatementPdf(settings))}>Relevé des commissions</button>}
            {can.finance && <button className="btn-outline btn-sm" onClick={() => run(() => financialReportPdf(settings, `${todayISO().slice(0, 4)}-01-01`, todayISO()))}>Rapport financier (année)</button>}
          </div>
          <p className="mt-3 text-xs text-ink-500">Fiches bien, propriétaire, prospect, visite et transaction : bouton « PDF » sur chaque fiche.</p>
        </Section>
      )}
      {can.sales && settings && (
        <Section title="Modèles de mandat (à faire valider avant utilisation)">
          <p className="mb-3 text-xs text-amber-800">Ces modèles ne sont pas validés juridiquement. Faites-les relire par un professionnel compétent avant toute signature.</p>
          {mandates.loading ? <Spinner /> : !mandates.data?.rows.length ? <p className="text-sm text-ink-500">Aucun mandat en cours.</p> : (
            <ul className="divide-y divide-ink-100 text-sm">
              {mandates.data.rows.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span><span className="font-mono text-xs">{m.reference}</span> — {m.property?.title} — {fullName(m.owner)} <StatusBadge value={m.status} map={MANDATE_STATUS} /></span>
                  <button className="btn-outline btn-sm" onClick={() => run(() => mandateTemplatePdf(settings, m))}>Modèle PDF</button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
      <Section title="Historique des documents générés">
        {docs.loading ? <Spinner /> : !docs.data?.rows.length ? <p className="text-sm text-ink-500">Aucun document généré.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Référence</th><th>Document</th><th>Type</th><th>Date</th><th>Données perso.</th></tr></thead>
              <tbody>
                {docs.data.rows.map((d) => (
                  <tr key={d.id}><td className="font-mono text-xs">{d.reference}</td><td>{d.title}</td><td>{d.doc_type}</td><td>{formatDateTime(d.generated_at)}</td><td>{d.contains_personal_data ? 'Oui' : 'Non'}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rapports et exports
// ---------------------------------------------------------------------------
type ReportDef = {
  key: string;
  title: string;
  need: 'sales' | 'finance' | 'staff' | 'negotiate';
  table: string;
  select: string;
  dateColumn?: string;
  columns: CsvColumn<Row>[];
};

const REPORTS: ReportDef[] = [
  { key: 'inventaire', title: 'Inventaire des biens (état actuel)', need: 'staff', table: 'properties', select: 'reference, title, property_type, region, city, district, price_xof, area, area_unit, commercial_status, verification_status, published_at',
    columns: [{ key: 'reference', header: 'Référence' }, { key: 'title', header: 'Titre' }, { key: 'property_type', header: 'Type', value: (r) => label(PROPERTY_TYPES, r.property_type) }, { key: 'region', header: 'Région' }, { key: 'city', header: 'Ville' }, { key: 'district', header: 'Quartier' }, { key: 'price_xof', header: 'Prix XOF' }, { key: 'area', header: 'Superficie' }, { key: 'area_unit', header: 'Unité' }, { key: 'commercial_status', header: 'Statut', value: (r) => label(PROPERTY_STATUS, r.commercial_status) }, { key: 'verification_status', header: 'Vérification', value: (r) => label(VERIFICATION_STATUS, r.verification_status) }, { key: 'published_at', header: 'Publié le', value: (r) => formatDate(r.published_at) }] },
  { key: 'prospects', title: 'Prospects', need: 'sales', table: 'buyers', select: 'reference, last_name, first_names, phone, email, budget_min, budget_max, zones, status, source, last_contact_at, next_follow_up_at, consent_marketing', dateColumn: 'created_at',
    columns: [{ key: 'reference', header: 'Référence' }, { key: 'last_name', header: 'Nom' }, { key: 'first_names', header: 'Prénoms' }, { key: 'phone', header: 'Téléphone' }, { key: 'email', header: 'Courriel' }, { key: 'budget_min', header: 'Budget min' }, { key: 'budget_max', header: 'Budget max' }, { key: 'zones', header: 'Zones' }, { key: 'status', header: 'Statut', value: (r) => label(BUYER_STATUS, r.status) }, { key: 'source', header: 'Source' }, { key: 'last_contact_at', header: 'Dernier contact', value: (r) => formatDateTime(r.last_contact_at) }, { key: 'next_follow_up_at', header: 'Relance', value: (r) => formatDateTime(r.next_follow_up_at) }, { key: 'consent_marketing', header: 'Accepte offres', value: (r) => (r.consent_marketing ? 'oui' : 'non') }] },
  { key: 'visites', title: 'Visites', need: 'sales', table: 'visits', select: 'reference, scheduled_at, status, interest_level, location, next_action, property:properties!visits_property_id_fkey(reference), buyer:buyers!visits_buyer_id_fkey(reference)', dateColumn: 'scheduled_at',
    columns: [{ key: 'reference', header: 'Référence' }, { key: 'scheduled_at', header: 'Date', value: (r) => formatDateTime(r.scheduled_at) }, { key: 'property', header: 'Bien', value: (r) => r.property?.reference }, { key: 'buyer', header: 'Prospect', value: (r) => r.buyer?.reference }, { key: 'status', header: 'Statut', value: (r) => label(VISIT_STATUS, r.status) }, { key: 'interest_level', header: 'Intérêt' }, { key: 'location', header: 'Lieu' }, { key: 'next_action', header: 'Prochaine action' }] },
  { key: 'transactions', title: 'Négociations et transactions', need: 'sales', table: 'transactions', select: 'reference, status, initial_asking_price, agreed_price, commission_agreed, concluded_date, abandon_reason, property:properties!transactions_property_id_fkey(reference)', dateColumn: 'created_at',
    columns: [{ key: 'reference', header: 'Dossier' }, { key: 'property', header: 'Bien', value: (r) => r.property?.reference }, { key: 'status', header: 'Statut', value: (r) => label(TRANSACTION_STATUS, r.status) }, { key: 'initial_asking_price', header: 'Prix demandé' }, { key: 'agreed_price', header: 'Prix convenu' }, { key: 'commission_agreed', header: 'Commission convenue' }, { key: 'concluded_date', header: 'Conclusion', value: (r) => formatDate(r.concluded_date) }, { key: 'abandon_reason', header: 'Motif abandon' }] },
  { key: 'offres', title: 'Offres et contre-offres', need: 'sales', table: 'negotiations', select: 'offer_kind, from_party, amount, offered_at, valid_until, status, conditions, transaction:transactions!negotiations_transaction_id_fkey(reference)', dateColumn: 'offered_at',
    columns: [{ key: 'transaction', header: 'Dossier', value: (r) => r.transaction?.reference }, { key: 'offered_at', header: 'Date', value: (r) => formatDateTime(r.offered_at) }, { key: 'offer_kind', header: 'Type', value: (r) => (r.offer_kind === 'offre' ? 'Offre' : 'Contre-offre') }, { key: 'from_party', header: 'Émise par' }, { key: 'amount', header: 'Montant XOF' }, { key: 'status', header: 'Statut', value: (r) => label(OFFER_STATUS, r.status) }, { key: 'valid_until', header: 'Valable jusqu’au', value: (r) => formatDate(r.valid_until) }, { key: 'conditions', header: 'Conditions' }] },
  { key: 'commissions', title: 'Commissions (état actuel)', need: 'finance', table: 'transaction_commissions', select: 'reference, status, base_price, commission_estimated, commission_agreed, commission_due, commission_received, commission_balance',
    columns: [{ key: 'reference', header: 'Dossier' }, { key: 'status', header: 'Statut', value: (r) => label(TRANSACTION_STATUS, r.status) }, { key: 'base_price', header: 'Base' }, { key: 'commission_estimated', header: 'Estimée' }, { key: 'commission_agreed', header: 'Convenue' }, { key: 'commission_due', header: 'Exigible' }, { key: 'commission_received', header: 'Encaissée' }, { key: 'commission_balance', header: 'Solde' }] },
  { key: 'recettes', title: 'Recettes', need: 'finance', table: 'financial_entries', select: 'reference, entry_date, entry_type, amount_expected, amount_received, balance, status, description', dateColumn: 'entry_date',
    columns: [{ key: 'reference', header: 'Référence' }, { key: 'entry_date', header: 'Date', value: (r) => formatDate(r.entry_date) }, { key: 'entry_type', header: 'Type' }, { key: 'amount_expected', header: 'Attendu' }, { key: 'amount_received', header: 'Encaissé' }, { key: 'balance', header: 'Solde' }, { key: 'status', header: 'Statut', value: (r) => label(REVENUE_STATUS, r.status) }, { key: 'description', header: 'Description' }] },
  { key: 'depenses', title: 'Dépenses', need: 'finance', table: 'expenses', select: 'reference, expense_date, category, description, amount, payment_method', dateColumn: 'expense_date',
    columns: [{ key: 'reference', header: 'Référence' }, { key: 'expense_date', header: 'Date', value: (r) => formatDate(r.expense_date) }, { key: 'category', header: 'Catégorie' }, { key: 'description', header: 'Description' }, { key: 'amount', header: 'Montant XOF' }, { key: 'payment_method', header: 'Paiement' }] },
  { key: 'taches', title: 'Tâches', need: 'staff', table: 'tasks', select: 'title, category, priority, due_at, status, result', dateColumn: 'created_at',
    columns: [{ key: 'title', header: 'Tâche' }, { key: 'category', header: 'Catégorie' }, { key: 'priority', header: 'Priorité', value: (r) => label(TASK_PRIORITY, r.priority) }, { key: 'due_at', header: 'Échéance', value: (r) => formatDateTime(r.due_at) }, { key: 'status', header: 'Statut', value: (r) => label(TASK_STATUS, r.status) }, { key: 'result', header: 'Résultat' }] },
];

export function ReportsPage() {
  const { can } = useAuth();
  const { data: settings } = useAgencySettings();
  const [from, setFrom] = useState(`${todayISO().slice(0, 7)}-01`);
  const [to, setTo] = useState(todayISO());
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const zones = useQuery(async () => {
    const rows = await listAllRows('properties', { select: 'city, district, commercial_status', notIn: { commercial_status: ['archive'] } });
    const map = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const k = r.city ?? '—';
      const m = map.get(k) ?? { total: 0, enLigne: 0, vendus: 0 };
      m.total++;
      if (['publie', 'sous_negociation', 'reserve'].includes(r.commercial_status)) m.enLigne++;
      if (r.commercial_status === 'vendu') m.vendus++;
      map.set(k, m);
    }
    return [...map.entries()].sort((a, b) => b[1].total - a[1].total);
  }, []);

  async function exportReport(r: ReportDef) {
    setErr(null);
    setMsg(null);
    try {
      const rows = await listAllRows(r.table, {
        select: r.select,
        gte: r.dateColumn ? { [r.dateColumn]: from } : undefined,
        lte: r.dateColumn ? { [r.dateColumn]: `${to}T23:59:59Z` } : undefined,
        order: r.dateColumn ? { column: r.dateColumn } : { column: 'reference', ascending: true },
      });
      const csv = toCsv(rows, r.columns);
      // Journalisation d'abord : pas d'export sensible sans trace.
      await logEvent('export_csv', r.table, `Rapport ${r.title}${r.dateColumn ? ` du ${from} au ${to}` : ''} (${rows.length} lignes)`);
      downloadText(`${r.key}-${r.dateColumn ? `${from}-${to}` : todayISO()}.csv`, csv);
      setMsg(`${rows.length} ligne(s) exportée(s).`);
    } catch (e) {
      setErr(humanError(e));
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Rapports et exports" subtitle="Exports limités aux données autorisées pour votre rôle. Chaque export est journalisé." />
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-sm"><span className="text-xs text-ink-500">Du</span><input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="flex flex-col text-sm"><span className="text-xs text-ink-500">Au</span><input type="date" className="input" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        {settings && <button className="btn-outline" onClick={() => rpc<DashboardStats>('dashboard_stats', { p_from: from, p_to: to }).then((s) => activityReportPdf(settings, from, to, s)).catch((e) => setErr(humanError(e)))}>Rapport d’activité PDF</button>}
      </div>
      <ErrorBox error={err} />
      {msg && <SuccessBox>{msg}</SuccessBox>}
      <Section title="Exports CSV">
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {REPORTS.filter((r) => can[r.need]).map((r) => (
            <li key={r.key}><button className="btn-outline w-full justify-between" onClick={() => void exportReport(r)}>{r.title}{r.dateColumn ? ' (période)' : ''} <span aria-hidden>↓</span></button></li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-ink-500">Les mots de passe, clés, jetons et données d’authentification ne sont jamais exportés.</p>
      </Section>
      <Section
        title="Biens par zone"
        actions={zones.data?.length ? (
          <button className="btn-outline btn-sm" onClick={() => {
            const rows = zones.data!.map(([city, m]) => ({ city, ...m }));
            logEvent('export_csv', 'properties', `Biens par zone (${rows.length} zones)`)
              .then(() => downloadText(`biens-par-zone-${todayISO()}.csv`, toCsv(rows, [{ key: 'city', header: 'Ville / commune' }, { key: 'total', header: 'Biens' }, { key: 'enLigne', header: 'En ligne' }, { key: 'vendus', header: 'Vendus' }])))
              .catch((e) => setErr(humanError(e)));
          }}>Export CSV</button>
        ) : null}
      >
        {zones.loading ? <Spinner /> : (
          <table className="table">
            <thead><tr><th>Ville / commune</th><th>Biens</th><th>En ligne</th><th>Vendus</th></tr></thead>
            <tbody>{zones.data?.map(([city, m]) => <tr key={city}><td>{city}</td><td>{m.total}</td><td>{m.enLigne}</td><td>{m.vendus}</td></tr>)}</tbody>
          </table>
        )}
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Paramètres de l'agence
// ---------------------------------------------------------------------------
const LIST_KEYS: Array<[string, string]> = [
  ['zones_served', 'Zones desservies'], ['contact_sources', 'Sources de contacts'], ['expense_categories', 'Catégories de dépenses'], ['task_categories', 'Catégories de tâches'],
];

export function SettingsPage() {
  const { data, loading, error, reload } = useAgencySettings();
  const [saved, setSaved] = useState(false);
  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorBox error={error ?? 'Paramètres indisponibles.'} />;
  return <SettingsForm key={data.updated_at} initial={data} saved={saved} onSaved={() => { setSaved(true); reload(); }} />;
}

function SettingsForm({ initial, saved, onSaved }: { initial: Row; saved: boolean; onSaved: () => void }) {
  const [v, setV] = useState<Row>(() => ({ ...initial, ...Object.fromEntries(LIST_KEYS.map(([k]) => [k, (initial[k] ?? []).join('\n')])) }));
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(saved);
  const [busy, setBusy] = useState(false);
  const set = (k: string, val: unknown) => setV((p) => ({ ...p, [k]: val }));
  const text = (k: string, l: string, type = 'text', help?: string) => (
    <div>
      <label className="label" htmlFor={`s-${k}`}>{l}</label>
      <input id={`s-${k}`} type={type} className="input" value={v[k] ?? ''} onChange={(e) => set(k, e.target.value)} />
      {help && <p className="mt-1 text-xs text-ink-500">{help}</p>}
    </div>
  );
  const area = (k: string, l: string, help?: string) => (
    <div className="sm:col-span-2">
      <label className="label" htmlFor={`s-${k}`}>{l}</label>
      <textarea id={`s-${k}`} className="input min-h-24" value={v[k] ?? ''} onChange={(e) => set(k, e.target.value)} />
      {help && <p className="mt-1 text-xs text-ink-500">{help}</p>}
    </div>
  );
  const bool = (k: string, l: string) => (
    <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5 accent-gold-600" checked={Boolean(v[k])} onChange={(e) => set(k, e.target.checked)} />{l}</label>
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setOk(false);
    const wa = String(v.whatsapp_number ?? '').replace(/\D/g, '');
    try {
      const payload: Row = {
        agency_name: v.agency_name, tagline: v.tagline || null, logo_url: v.logo_url || null, phone: v.phone || null,
        whatsapp_number: wa || null, whatsapp_message_template: v.whatsapp_message_template, email: v.email || null,
        address: v.address || null, about: v.about || null, document_footer: v.document_footer || null,
        privacy_policy: v.privacy_policy || null, legal_notice: v.legal_notice || null, inquiry_consent_text: v.inquiry_consent_text,
        data_retention_months: Number(v.data_retention_months) || 36,
        publication_requires_verification: Boolean(v.publication_requires_verification),
        publication_requires_active_mandate: Boolean(v.publication_requires_active_mandate),
        publication_requires_photo: Boolean(v.publication_requires_photo),
      };
      for (const [k] of LIST_KEYS) payload[k] = String(v[k] ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
      const { supabase } = await import('@/lib/supabase');
      const { error } = await supabase.from('agency_settings').update(payload).eq('id', 1);
      if (error) throw error;
      resetPublicAgencyCache();
      setOk(true);
      onSaved();
    } catch (e2) {
      setErr(humanError(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="max-w-4xl space-y-5">
      <PageHeader title="Paramètres de l’agence" subtitle="Devise : XOF (franc CFA) · Fuseau : Africa/Abidjan" />
      <Section title="Identité et coordonnées">
        <div className="grid gap-4 sm:grid-cols-2">
          {text('agency_name', 'Nom de l’agence *')}
          {text('tagline', 'Accroche')}
          {text('logo_url', 'URL du logo', 'url', 'Image hébergée (ex. dans le bucket photos). Facultatif.')}
          {text('phone', 'Téléphone', 'tel')}
          {text('whatsapp_number', 'Numéro WhatsApp', 'tel', 'Format international sans + ni espaces, ex. 2250700000000.')}
          {text('email', 'Courriel', 'email')}
          {text('address', 'Adresse')}
          {text('whatsapp_message_template', 'Message WhatsApp prérempli', 'text', '{reference} est remplacé par la référence du bien.')}
          {area('about', 'Présentation de l’agence (page À propos)')}
          {text('document_footer', 'Pied de page des documents PDF')}
        </div>
      </Section>
      <Section title="Listes paramétrables (une valeur par ligne)">
        <div className="grid gap-4 sm:grid-cols-2">
          {LIST_KEYS.map(([k, l]) => (
            <div key={k}>
              <label className="label" htmlFor={`s-${k}`}>{l}</label>
              <textarea id={`s-${k}`} className="input min-h-32" value={v[k]} onChange={(e) => set(k, e.target.value)} />
            </div>
          ))}
        </div>
      </Section>
      <Section title="Règles de publication">
        <p className="mb-2 text-xs text-ink-500">Appliquées par la base de données : une annonce ne peut pas être publiée sans les respecter.</p>
        {bool('publication_requires_verification', 'Exiger un bien « vérifié »')}
        {bool('publication_requires_active_mandate', 'Exiger un mandat actif')}
        {bool('publication_requires_photo', 'Exiger au moins une photo')}
      </Section>
      <Section title="Données personnelles et mentions">
        <div className="grid gap-4 sm:grid-cols-2">
          {text('data_retention_months', 'Durée de conservation des données (mois)', 'number', 'À définir selon les obligations applicables vérifiées.')}
          {text('inquiry_consent_text', 'Texte de consentement du formulaire')}
          {area('privacy_policy', 'Politique de confidentialité', 'Affichée sur le site. Faites valider le texte selon la réglementation ivoirienne en vigueur.')}
          {area('legal_notice', 'Mentions légales')}
        </div>
      </Section>
      <ErrorBox error={err} />
      {ok && <SuccessBox>Paramètres enregistrés.</SuccessBox>}
      <button className="btn-primary" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer les paramètres'}</button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Utilisateurs et rôles
// ---------------------------------------------------------------------------
export function UsersPage() {
  const { profile: me } = useAuth();
  const [err, setErr] = useState<string | null>(null);
  const { data, loading, reload } = useQuery(() => listRows('profiles', { order: { column: 'created_at' }, pageSize: 200 }), []);
  const save = async (id: string, patch: Row) => {
    setErr(null);
    try {
      // Le changement est journalisé automatiquement par la base (déclencheur sur profiles).
      await updateRow('profiles', id, patch);
      reload();
    } catch (e) {
      setErr(humanError(e));
    }
  };
  return (
    <div className="space-y-5">
      <PageHeader title="Utilisateurs et permissions" />
      <Section title="Ajouter un membre de l’équipe">
        <ol className="list-inside list-decimal space-y-1 text-sm text-ink-700">
          <li>Dans le tableau de bord Supabase : <em>Authentication → Users → Invite user</em> (l’inscription publique doit rester désactivée).</li>
          <li>La personne reçoit un courriel : le lien ouvre la page « Choisir un mot de passe » du site (Site URL configurée dans Supabase).</li>
          <li>Son compte apparaît ci-dessous <strong>sans aucun accès</strong> : attribuez un rôle puis activez-le.</li>
        </ol>
        <p className="mt-2 text-xs text-ink-500">Rôles : Administrateur (tout), Agent (commercial + négociations), Assistant (commercial sans négociation), Comptable (finances). Principe du moindre privilège.</p>
      </Section>
      <ErrorBox error={err} />
      {loading ? <Spinner /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Utilisateur</th><th>Rôle</th><th>Actif</th><th>Créé le</th></tr></thead>
            <tbody>
              {data?.rows.map((u) => (
                <tr key={u.id}>
                  <td><div className="font-medium">{u.full_name || '—'}</div><div className="text-xs text-ink-500">{u.email}</div></td>
                  <td>
                    <select className="input" aria-label={`Rôle de ${u.email}`} value={u.role ?? ''} disabled={u.id === me?.id} onChange={(e) => void save(u.id, { role: e.target.value || null })}>
                      <option value="">Aucun accès</option>
                      {options.roles.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </td>
                  <td>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" className="h-5 w-5 accent-gold-600" checked={u.is_active} disabled={u.id === me?.id} onChange={(e) => void save(u.id, { is_active: e.target.checked })} />
                      {u.is_active ? 'Actif' : 'Inactif'}
                    </label>
                  </td>
                  <td>{formatDate(u.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-ink-500">Vous ne pouvez pas modifier votre propre rôle (protection contre le verrouillage). {label(ROLES, me?.role)}.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Journal d'activité (lecture seule)
// ---------------------------------------------------------------------------
export function ActivityLogPage() {
  const [page, setPage] = useState(0);
  const [entity, setEntity] = useState('');
  const { data, loading, error } = useQuery(
    () => listRows('activity_logs', { select: '*, actor:profiles!activity_logs_actor_id_fkey(full_name, email)', eq: { entity_type: entity }, order: { column: 'occurred_at' }, page, pageSize: 50 }),
    [page, entity],
  );
  const pages = Math.ceil((data?.count ?? 0) / 50);
  return (
    <div className="space-y-4">
      <PageHeader title="Journal d’activité" subtitle="Lecture seule. Les journaux ne peuvent être modifiés par aucun utilisateur." />
      <select className="input sm:w-64" aria-label="Type d’élément" value={entity} onChange={(e) => { setEntity(e.target.value); setPage(0); }}>
        <option value="">Tous les éléments</option>
        {['properties', 'owners', 'buyers', 'mandates', 'visits', 'transactions', 'negotiations', 'financial_entries', 'payments', 'expenses', 'commission_rules', 'documents', 'profiles', 'property_documents', 'document_checks'].map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <ErrorBox error={error} />
      {loading ? <Spinner /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Date</th><th>Auteur</th><th>Action</th><th>Élément</th><th>Détail</th></tr></thead>
            <tbody>
              {data?.rows.map((l) => (
                <tr key={l.id}>
                  <td className="whitespace-nowrap">{formatDateTime(l.occurred_at)}</td>
                  <td>{l.actor?.full_name || l.actor?.email || 'Système'}</td>
                  <td>{l.action}</td>
                  <td>{l.entity_type} {l.summary && <span className="font-mono text-xs">{l.summary}</span>}</td>
                  <td className="max-w-md">
                    {l.action === 'update' && l.changes ? (
                      <details><summary className="cursor-pointer text-xs text-gold-700">{Object.keys(l.changes).length} champ(s)</summary>
                        <ul className="mt-1 space-y-0.5 text-xs">{Object.entries(l.changes as Record<string, { avant: unknown; apres: unknown }>).map(([k, d]) => <li key={k}><strong>{k}</strong> : {JSON.stringify(d.avant)} → {JSON.stringify(d.apres)}</li>)}</ul>
                      </details>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="flex justify-between text-sm">
          <button className="btn-outline btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>← Plus récents</button>
          <span>Page {page + 1} / {pages}</span>
          <button className="btn-outline btn-sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Plus anciens →</button>
        </div>
      )}
      <p className="text-xs text-ink-500">Voir aussi <Link className="underline" to="/admin/rapports">les rapports</Link>.</p>
    </div>
  );
}
