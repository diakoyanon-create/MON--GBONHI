import { useState } from 'react';
import { Link } from 'react-router-dom';
import { listRows, rpc } from '@/api/crud';
import { useQuery } from '@/api/hooks';
import { useAuth } from '@/auth/AuthContext';
import { ErrorBox, PageHeader, Section, Spinner, Stat, StatusBadge } from '@/components/ui';
import { MANDATE_STATUS, TASK_STATUS, VISIT_STATUS } from '@/domain/labels';
import { formatDate, formatDateTime, formatXOF, fullName, todayISO } from '@/lib/format';

export type DashboardStats = {
  period: { from: string; to: string };
  properties: Record<'total' | 'disponibles' | 'publies' | 'a_verifier' | 'en_negociation' | 'vendus' | 'archives' | 'brouillons', number>;
  owners?: number;
  prospects?: number;
  inquiries_new?: number;
  visits_upcoming?: number;
  follow_ups_due?: number;
  mandate_reminders?: number;
  visit_follow_ups?: number;
  tasks_overdue: number;
  tasks_today: number;
  transactions_open?: number;
  negotiations_pending?: number;
  sales?: { count: number; volume: number };
  finance?: Record<
    'commissions_estimated' | 'commissions_agreed_open' | 'commissions_due_balance' | 'commissions_agreed' | 'commissions_received' | 'revenue_received' | 'expenses' | 'result',
    number
  >;
};

/** Prospects actifs : miroir de dashboard_stats (status not in converti, sans_suite, archive). */
export const ACTIVE_BUYER_STATUSES = ['nouveau', 'a_contacter', 'contact_etabli', 'besoin_qualifie', 'visite_programmee', 'en_negociation'];

/**
 * Liens des tuiles : la liste ouverte reprend exactement le filtre du compteur (dashboard_stats).
 * `at` : instant du calcul (visites à venir, tâches en retard).
 */
export function tileLinks(period: { from: string; to: string }, at: string) {
  return {
    prospects: `/admin/acheteurs?status=${ACTIVE_BUYER_STATUSES.join(',')}`,
    visitsUpcoming: `/admin/visites?vue=liste&status=a_confirmer,confirmee&scheduled_at_min=${at}`,
    transactionsOpen: '/admin/transactions?status=negociation,offre_en_attente,offre_acceptee_sous_conditions,dossier_en_cours',
    sales: `/admin/transactions?status=vente_conclue&concluded_date_min=${period.from}&concluded_date_max=${period.to}`,
    tasksOverdue: `/admin/taches?status=a_faire,en_cours,reportee&due_at_max=${at}`,
    commissionsDue: '/admin/finances/recettes?status=exigible,partiel&entry_type=commission',
  };
}

function monthStart() {
  return `${todayISO().slice(0, 8)}01`;
}

function addDaysISO(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function DashboardPage() {
  const { can, profile } = useAuth();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayISO());
  // Maintenance quotidienne : mandats échus → « Expiré », annonces non conformes dépubliées.
  const maintenance = useQuery(() => rpc<{ mandates_expired: number; properties_unpublished: number }>('run_maintenance').catch(() => null), []);
  const { data: s, error, loading } = useQuery(
    () => rpc<DashboardStats>('dashboard_stats', { p_from: from, p_to: to }).then((st) => ({ ...st, at: new Date().toISOString() })),
    [from, to, maintenance.data?.mandates_expired, maintenance.data?.properties_unpublished],
  );
  const today = todayISO();
  const links = s ? tileLinks(s.period, s.at) : null;
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
  const reminders = useQuery(async () => {
    if (!can.sales) return { mandates: [], followUps: [] };
    const [mandates, followUps] = await Promise.all([
      listRows('mandates', {
        select: 'id, reference, status, end_date, reminder_date, property:properties!mandates_property_id_fkey(reference, title)',
        inList: { status: ['actif', 'en_attente_signature'] },
        orFilters: [`reminder_date.lte.${today},end_date.lte.${addDaysISO(today, 30)}`],
        order: { column: 'end_date', ascending: true },
        pageSize: 8,
      }),
      listRows('visits', {
        select: 'id, reference, follow_up_at, next_action, status, buyer:buyers!visits_buyer_id_fkey(last_name, first_names), property:properties!visits_property_id_fkey(reference)',
        notIn: { status: ['annulee', 'sans_suite'] },
        lte: { follow_up_at: new Date().toISOString() },
        gte: { follow_up_at: new Date(Date.now() - 30 * 86400_000).toISOString() },
        order: { column: 'follow_up_at', ascending: true },
        pageSize: 8,
      }),
    ]);
    return { mandates: mandates.rows, followUps: followUps.rows };
  }, [can.sales, today]);
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
            <label className="flex flex-col"><span className="text-xs text-ink-500">Du</span><input type="date" className="input" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>
            <label className="flex flex-col"><span className="text-xs text-ink-500">Au</span><input type="date" className="input" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} /></label>
          </div>
        }
      />
      {maintenance.data && (maintenance.data.mandates_expired > 0 || maintenance.data.properties_unpublished > 0) && (
        <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Mise à jour automatique : {maintenance.data.mandates_expired} mandat(s) échu(s) passé(s) en « Expiré »,{' '}
          {maintenance.data.properties_unpublished} annonce(s) retirée(s) du site (conditions de publication non remplies).
        </p>
      )}
      <ErrorBox error={error} />
      {loading && !s ? (
        <Spinner />
      ) : s ? (
        <>
          <section aria-labelledby="h-biens">
            <h2 id="h-biens" className="mb-2 text-sm font-semibold text-ink-700">Portefeuille (situation actuelle)</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
              <Stat label="Biens référencés" value={s.properties.total} to="/admin/biens" />
              <Stat label="Disponibles" value={s.properties.disponibles} hint={`${s.properties.publies} en ligne`} to="/admin/biens?commercial_status=disponible,publie" />
              <Stat label="À vérifier" value={s.properties.a_verifier} hint="Vérification non terminée" to="/admin/biens?verification_status=a_verifier,en_cours,non_conforme" />
              <Stat label="En négociation" value={s.properties.en_negociation} to="/admin/biens?commercial_status=sous_negociation,reserve" />
              <Stat label="Vendus" value={s.properties.vendus} to="/admin/biens?commercial_status=vendu" />
              <Stat label="Brouillons" value={s.properties.brouillons} to="/admin/biens?commercial_status=brouillon" />
              <Stat label="Archivés" value={s.properties.archives} to="/admin/biens?commercial_status=archive" />
            </div>
          </section>

          <section aria-labelledby="h-com">
            <h2 id="h-com" className="mb-2 text-sm font-semibold text-ink-700">Activité commerciale</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {s.owners !== undefined && <Stat label="Propriétaires" value={s.owners} to="/admin/proprietaires" />}
              {s.prospects !== undefined && <Stat label="Prospects actifs" value={s.prospects} hint={s.follow_ups_due ? `${s.follow_ups_due} relance(s) dues` : undefined} to={links?.prospects} />}
              {s.inquiries_new !== undefined && <Stat label="Demandes non traitées" value={s.inquiries_new} to="/admin/demandes?status=nouveau" />}
              {s.visits_upcoming !== undefined && <Stat label="Visites à venir" value={s.visits_upcoming} to={links?.visitsUpcoming} />}
              {s.transactions_open !== undefined && <Stat label="Négociations / dossiers en cours" value={s.transactions_open} hint={s.negotiations_pending ? `${s.negotiations_pending} offre(s) en attente` : undefined} to={links?.transactionsOpen} />}
              {s.sales && <Stat label="Ventes conclues (période)" value={s.sales.count} hint={`Montant des ventes : ${formatXOF(s.sales.volume)}`} to={links?.sales} />}
              <Stat label="Tâches en retard" value={<span className={s.tasks_overdue ? 'text-red-700' : ''}>{s.tasks_overdue}</span>} hint={`${s.tasks_today} pour aujourd’hui`} to={links?.tasksOverdue} />
              {s.mandate_reminders !== undefined && <Stat label="Rappels mandats" value={s.mandate_reminders} hint="Rappel dû ou expiration sous 30 jours (voir « Rappels »)" />}
            </div>
          </section>

          {s.finance && (
            <section aria-labelledby="h-fin" className="space-y-3">
              <h2 id="h-fin" className="text-sm font-semibold text-ink-700">Finances — période du {formatDate(s.period.from)} au {formatDate(s.period.to)}</h2>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                <Stat label="Commissions convenues" value={formatXOF(s.finance.commissions_agreed)} hint="Ventes conclues sur la période" />
                <Stat label="Commissions encaissées" value={formatXOF(s.finance.commissions_received)} />
                <Stat label="Chiffre d’affaires encaissé" value={formatXOF(s.finance.revenue_received)} />
                <Stat label="Dépenses" value={formatXOF(s.finance.expenses)} />
                <Stat label="Résultat de gestion" value={formatXOF(s.finance.result)} hint="Encaissé − dépenses (simplifié)" />
              </div>
              <h2 className="pt-2 text-sm font-semibold text-ink-700">Finances — situation actuelle (toutes périodes)</h2>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <Stat label="Commissions estimées" value={formatXOF(s.finance.commissions_estimated)} hint="Dossiers en cours, une estimation par bien" />
                <Stat label="Commissions convenues (en cours)" value={formatXOF(s.finance.commissions_agreed_open)} hint="Dossiers non conclus" />
                <Stat label="Commissions dues (solde)" value={formatXOF(s.finance.commissions_due_balance)} hint="Exigibles non encaissées" to={links?.commissionsDue} />
              </div>
              <p className="text-xs text-ink-500">
                Le montant des ventes (prix des biens) n’est pas le chiffre d’affaires de l’agence : seuls les encaissements réels sont comptés.
              </p>
            </section>
          )}
        </>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {can.sales && (
          <Section title="Prochaines visites" actions={<Link to="/admin/visites" className="text-sm text-gold-700 underline">Toutes</Link>}>
            {visits.loading ? <Spinner /> : visits.data?.rows.length ? (
              <ul className="divide-y divide-ink-100">
                {visits.data.rows.map((v) => (
                  <li key={v.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                    <Link to={`/admin/visites/${v.id}/modifier`} className="min-w-0">
                      <div className="font-medium">{formatDateTime(v.scheduled_at)}</div>
                      <div className="truncate text-ink-500">{v.property?.title} — {fullName(v.buyer)}</div>
                    </Link>
                    <StatusBadge value={v.status} map={VISIT_STATUS} />
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-ink-500">Aucune visite programmée.</p>}
          </Section>
        )}
        {can.sales && (
          <Section title="Rappels">
            {reminders.loading ? <Spinner /> : !reminders.data?.mandates.length && !reminders.data?.followUps.length ? (
              <p className="text-sm text-ink-500">Aucun rappel de mandat ni relance de visite en attente.</p>
            ) : (
              <ul className="divide-y divide-ink-100 text-sm">
                {reminders.data?.mandates.map((m) => (
                  <li key={m.id} className="flex items-start justify-between gap-3 py-2">
                    <Link to={`/admin/mandats/${m.id}/modifier`} className="min-w-0">
                      <div className="font-medium">Mandat {m.reference} — {m.property?.reference}</div>
                      <div className={m.end_date && m.end_date < today ? 'text-red-700' : 'text-ink-500'}>
                        {m.reminder_date && m.reminder_date <= today ? `Rappel du ${formatDate(m.reminder_date)}` : ''}
                        {m.reminder_date && m.reminder_date <= today && m.end_date ? ' · ' : ''}
                        {m.end_date ? `Expire le ${formatDate(m.end_date)}` : ''}
                      </div>
                    </Link>
                    <StatusBadge value={m.status} map={MANDATE_STATUS} />
                  </li>
                ))}
                {reminders.data?.followUps.map((v) => (
                  <li key={v.id} className="py-2">
                    <Link to={`/admin/visites/${v.id}/modifier`}>
                      <div className="font-medium">Relance après visite — {fullName(v.buyer)} ({v.property?.reference})</div>
                      <div className="text-ink-500">{formatDateTime(v.follow_up_at)}{v.next_action ? ` · ${v.next_action}` : ''}</div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
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
