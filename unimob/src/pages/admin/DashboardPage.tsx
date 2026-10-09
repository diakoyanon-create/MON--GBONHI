import { useState } from 'react';
import { Link } from 'react-router-dom';
import { listRows, rpc } from '@/api/crud';
import { useQuery } from '@/api/hooks';
import { useAuth } from '@/auth/AuthContext';
import { ErrorBox, PageHeader, Section, Spinner, Stat, StatusBadge } from '@/components/ui';
import { TASK_STATUS, VISIT_STATUS } from '@/domain/labels';
import { formatDateTime, formatXOF, fullName, todayISO } from '@/lib/format';

export type DashboardStats = {
  properties: Record<'total' | 'disponibles' | 'publies' | 'a_verifier' | 'en_negociation' | 'vendus' | 'archives' | 'brouillons', number>;
  owners?: number;
  prospects?: number;
  inquiries_new?: number;
  visits_upcoming?: number;
  follow_ups_due?: number;
  tasks_overdue: number;
  tasks_today: number;
  transactions_open?: number;
  negotiations_pending?: number;
  sales?: { count: number; volume: number };
  finance?: Record<'commissions_estimated' | 'commissions_agreed' | 'commissions_due_balance' | 'commissions_received' | 'revenue_received' | 'expenses' | 'result', number>;
};

function monthStart() {
  const t = todayISO();
  return `${t.slice(0, 8)}01`;
}

export function DashboardPage() {
  const { can, profile } = useAuth();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayISO());
  const { data: s, error, loading } = useQuery(() => rpc<DashboardStats>('dashboard_stats', { p_from: from, p_to: to }), [from, to]);
  const visits = useQuery(
    () => (can.sales
      ? listRows('visits', {
          select: 'id, reference, scheduled_at, status, property:properties!visits_property_id_fkey(reference, title), buyer:buyers!visits_buyer_id_fkey(last_name, first_names)',
          inList: { status: ['a_confirmer', 'confirmee'] },
          gte: { scheduled_at: new Date().toISOString() },
          order: { column: 'scheduled_at', ascending: true },
          pageSize: 5,
        })
      : Promise.resolve({ rows: [], count: 0 })),
    [can.sales],
  );
  const tasks = useQuery(
    () => listRows('tasks', { select: 'id, title, due_at, status, priority', inList: { status: ['a_faire', 'en_cours', 'reportee'] }, order: { column: 'due_at', ascending: true }, pageSize: 6 }),
    [],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Bonjour${profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}`}
        subtitle="Vue d’ensemble de l’activité de l’agence"
        actions={
          <div className="flex flex-wrap items-end gap-2 text-sm">
            <label className="flex flex-col"><span className="text-xs text-ink-500">Du</span><input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="flex flex-col"><span className="text-xs text-ink-500">Au</span><input type="date" className="input" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
          </div>
        }
      />
      <ErrorBox error={error} />
      {loading || !s ? (
        <Spinner />
      ) : (
        <>
          <section aria-labelledby="h-biens">
            <h2 id="h-biens" className="mb-2 text-sm font-semibold text-ink-700">Portefeuille</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
              <Stat label="Biens référencés" value={s.properties.total} to="/admin/biens" />
              <Stat label="Disponibles" value={s.properties.disponibles} hint={`${s.properties.publies} en ligne`} to="/admin/biens?commercial_status=disponible" />
              <Stat label="À vérifier" value={s.properties.a_verifier} to="/admin/biens?verification_status=a_verifier" />
              <Stat label="En négociation" value={s.properties.en_negociation} to="/admin/biens?commercial_status=sous_negociation" />
              <Stat label="Vendus" value={s.properties.vendus} to="/admin/biens?commercial_status=vendu" />
              <Stat label="Brouillons" value={s.properties.brouillons} to="/admin/biens?commercial_status=brouillon" />
              <Stat label="Archivés" value={s.properties.archives} to="/admin/biens?commercial_status=archive" />
            </div>
          </section>

          <section aria-labelledby="h-com">
            <h2 id="h-com" className="mb-2 text-sm font-semibold text-ink-700">Activité commerciale</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {s.owners !== undefined && <Stat label="Propriétaires" value={s.owners} to="/admin/proprietaires" />}
              {s.prospects !== undefined && <Stat label="Prospects actifs" value={s.prospects} hint={s.follow_ups_due ? `${s.follow_ups_due} relance(s) dues` : undefined} to="/admin/acheteurs" />}
              {s.inquiries_new !== undefined && <Stat label="Demandes non traitées" value={s.inquiries_new} to="/admin/demandes?status=nouveau" />}
              {s.visits_upcoming !== undefined && <Stat label="Visites à venir" value={s.visits_upcoming} to="/admin/visites" />}
              {s.transactions_open !== undefined && <Stat label="Négociations / dossiers en cours" value={s.transactions_open} hint={s.negotiations_pending ? `${s.negotiations_pending} offre(s) en attente` : undefined} to="/admin/transactions" />}
              {s.sales && <Stat label="Ventes conclues (période)" value={s.sales.count} hint={`Montant des ventes : ${formatXOF(s.sales.volume)}`} />}
              <Stat label="Tâches en retard" value={<span className={s.tasks_overdue ? 'text-red-700' : ''}>{s.tasks_overdue}</span>} hint={`${s.tasks_today} pour aujourd’hui`} to="/admin/taches" />
            </div>
          </section>

          {s.finance && (
            <section aria-labelledby="h-fin">
              <h2 id="h-fin" className="mb-2 text-sm font-semibold text-ink-700">Finances (période sélectionnée)</h2>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="Commissions estimées" value={formatXOF(s.finance.commissions_estimated)} hint="Dossiers en cours, selon les règles" />
                <Stat label="Commissions convenues" value={formatXOF(s.finance.commissions_agreed)} hint="Dossiers non annulés" />
                <Stat label="Commissions dues (solde)" value={formatXOF(s.finance.commissions_due_balance)} hint="Exigibles non encaissées" />
                <Stat label="Commissions encaissées" value={formatXOF(s.finance.commissions_received)} />
                <Stat label="Chiffre d’affaires encaissé" value={formatXOF(s.finance.revenue_received)} />
                <Stat label="Dépenses" value={formatXOF(s.finance.expenses)} />
                <Stat label="Résultat de gestion" value={formatXOF(s.finance.result)} hint="Encaissé − dépenses (simplifié)" />
              </div>
              <p className="mt-2 text-xs text-ink-500">
                Le montant des ventes (prix des biens) n’est pas le chiffre d’affaires de l’agence : seuls les encaissements réels sont comptés.
              </p>
            </section>
          )}
        </>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {can.sales && (
          <Section title="Prochaines visites" actions={<Link to="/admin/visites" className="text-sm text-gold-700 underline">Toutes</Link>}>
            {visits.loading ? <Spinner /> : visits.data?.rows.length ? (
              <ul className="divide-y divide-ink-100">
                {visits.data.rows.map((v) => (
                  <li key={v.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="font-medium">{formatDateTime(v.scheduled_at)}</div>
                      <div className="truncate text-ink-500">{v.property?.title} — {fullName(v.buyer)}</div>
                    </div>
                    <StatusBadge value={v.status} map={VISIT_STATUS} />
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-ink-500">Aucune visite programmée.</p>}
          </Section>
        )}
        <Section title="Prochaines actions" actions={<Link to="/admin/taches" className="text-sm text-gold-700 underline">Toutes</Link>}>
          {tasks.loading ? <Spinner /> : tasks.data?.rows.length ? (
            <ul className="divide-y divide-ink-100">
              {tasks.data.rows.map((t) => {
                const late = t.due_at && new Date(t.due_at) < new Date();
                return (
                  <li key={t.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                    <Link to={`/admin/taches/${t.id}/modifier`} className="min-w-0">
                      <div className="truncate font-medium">{t.title}</div>
                      <div className={late ? 'text-red-700' : 'text-ink-500'}>{late ? 'En retard — ' : ''}{formatDateTime(t.due_at)}</div>
                    </Link>
                    <StatusBadge value={t.status} map={TASK_STATUS} />
                  </li>
                );
              })}
            </ul>
          ) : <p className="text-sm text-ink-500">Aucune tâche ouverte.</p>}
        </Section>
      </div>
    </div>
  );
}
