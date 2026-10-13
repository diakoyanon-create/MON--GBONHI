// Tests unitaires de la revue adversariale (espace privé) : tri des lectures par tranches,
// champs masqués, filtre « contient », liens du tableau de bord, rechargement des fiches,
// journal, offres d'un dossier clôturé, canal des demandes.
// Le client Supabase est réel ; seul fetch est simulé : on vérifie les requêtes PostgREST émises.
import { createElement as h, type ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, permissionsFor, type AppRole } from '@/auth/AuthContext';
import { listAllRows, listRows, pgArrayLiteral } from '@/api/crud';
import { fromFormValues, toFormValues } from '@/resources/values';
import { buyersConfig, inquiryFields, propertyFields, revenuesConfig, tasksConfig, transactionFields, transactionsConfig } from '@/resources/configs';
import { ResourceList, dateParam } from '@/resources/ResourceList';
import { ResourceForm } from '@/resources/ResourceForm';
import { ACTIVE_BUYER_STATUSES, tileLinks } from '@/pages/admin/DashboardPage';
import { TransactionDetailPage, VisitsPage } from '@/pages/admin/DealPages';
import { OwnerDetailPage } from '@/pages/admin/ContactPages';
import { ActivityLogPage } from '@/pages/admin/AdminPages';
import { BUYER_STATUS } from '@/domain/labels';

type Req = { method: string; url: URL; table: string; body: any; accept: string };
type Reply = { rows?: unknown; total?: number } | undefined;

const srv = vi.hoisted(() => ({
  requests: [] as Req[],
  handler: (() => undefined) as (r: Req) => Reply | Promise<Reply>,
}));

vi.mock('@/lib/supabase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/supabase')>();
  const { createClient } = await import('@supabase/supabase-js');
  // Faux serveur PostgREST : enregistre la requête, répond avec les lignes fournies par le test.
  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const accept = new Headers(init?.headers).get('accept') ?? '';
    const req: Req = {
      method: (init?.method ?? 'GET').toUpperCase(),
      url,
      table: url.pathname.replace(/^\/rest\/v1\/(rpc\/)?/, ''),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      accept,
    };
    srv.requests.push(req);
    const reply = (await srv.handler(req)) ?? {};
    let rows = reply.rows ?? [];
    if (accept.includes('vnd.pgrst.object') && Array.isArray(rows)) rows = rows[0] ?? null;
    const n = Array.isArray(rows) ? rows.length : 1;
    const offset = Number(url.searchParams.get('offset') ?? 0);
    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: { 'content-type': 'application/json', 'content-range': n ? `${offset}-${offset + n - 1}/${reply.total ?? n}` : `*/${reply.total ?? 0}` },
    });
  };
  const supabase = createClient('http://supabase.test', 'eyJ.cle-de-test.fictive', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fakeFetch },
  });
  return { ...actual, supabase };
});

// Composants annexes des fiches remplacés par des doublures simples.
vi.mock('@/components/PrivateDocuments', async () => {
  const { createElement } = await import('react');
  return { PrivateDocuments: () => createElement('input', { 'aria-label': 'Intitulé (test)' }) };
});
vi.mock('@/components/PersonalDataActions', async () => {
  const { createElement } = await import('react');
  return { PersonalDataActions: ({ onDone }: { onDone: () => void }) => createElement('button', { type: 'button', onClick: onDone }, 'Archiver (test)') };
});
vi.mock('@/components/InteractionsPanel', () => ({ InteractionsPanel: () => null }));

const reqs = (table: string) => srv.requests.filter((r) => r.table === table);
async function lastReq(table: string): Promise<Req> {
  await waitFor(() => expect(reqs(table).length).toBeGreaterThan(0));
  return reqs(table).at(-1)!;
}

function renderAt(role: AppRole, path: string, route: string, element: ReactNode) {
  const profile = { id: 'u-test', full_name: 'Test', email: 'test@agence.test', role, is_active: true };
  const value = {
    loading: false, profileError: false, session: { user: { id: 'u-test' } } as never, profile, can: permissionsFor(profile),
    signIn: async () => null, signOut: async () => {}, refreshProfile: async () => {},
  };
  return render(h(AuthContext.Provider, { value }, h(MemoryRouter, { initialEntries: [path] }, h(Routes, null, h(Route, { path: route, element })))));
}

beforeEach(() => {
  srv.requests = [];
  srv.handler = () => undefined;
});

// ---------------------------------------------------------------------------
// 1. Lecture par tranches : tri toujours départagé par une clé unique
// ---------------------------------------------------------------------------
describe('lectures paginées : départage unique du tri', () => {
  it('listAllRows : chaque tranche est triée par la date puis par id', async () => {
    const all = Array.from({ length: 2500 }, (_, i) => ({ id: `e-${String(i).padStart(4, '0')}`, expense_date: `2026-01-${String(1 + (i % 20)).padStart(2, '0')}` }));
    srv.handler = ({ url }) => {
      const offset = Number(url.searchParams.get('offset'));
      return { rows: all.slice(offset, offset + Number(url.searchParams.get('limit'))), total: all.length };
    };
    const rows = await listAllRows('expenses', { select: 'id, expense_date', gte: { expense_date: '2026-01-01' }, order: { column: 'expense_date' } });
    expect(rows).toHaveLength(2500);
    const pages = reqs('expenses');
    expect(pages.map((r) => r.url.searchParams.get('offset'))).toEqual(['0', '1000', '2000']);
    // Sans « ,id.asc », PostgreSQL ordonne librement les ex aequo d'une page à l'autre (doublons, lignes perdues).
    for (const r of pages) expect(r.url.searchParams.get('order')).toBe('expense_date.desc.nullslast,id.asc');
  });

  it('vue transaction_commissions (sans colonne id) : départage par transaction_id', async () => {
    await listAllRows('transaction_commissions', { order: { column: 'reference', ascending: true } });
    expect((await lastReq('transaction_commissions')).url.searchParams.get('order')).toBe('reference.asc.nullslast,transaction_id.asc');
  });

  it('sans tri demandé : ordre explicite par id', async () => {
    await listAllRows('properties', { select: 'city, commercial_status', notIn: { commercial_status: ['archive'] } });
    expect((await lastReq('properties')).url.searchParams.get('order')).toBe('id.asc');
  });

  it('listRows (pagination des listes) : même départage ; pas de doublon si le tri porte déjà sur la clé', async () => {
    await listRows('buyers', { order: { column: 'created_at' }, page: 2, pageSize: 25 });
    const r = await lastReq('buyers');
    expect(r.url.searchParams.get('order')).toBe('created_at.desc.nullslast,id.asc');
    expect(r.url.searchParams.get('offset')).toBe('50');
    await listRows('tasks', { order: { column: 'id', ascending: true } });
    expect((await lastReq('tasks')).url.searchParams.get('order')).toBe('id.asc.nullslast');
  });
});

// ---------------------------------------------------------------------------
// 2. Champs masqués par showIf en modification
// ---------------------------------------------------------------------------
describe('formulaires : champs masqués en modification', () => {
  const house = {
    id: 'p1', title: 'Maison de test', property_type: 'maison', city: 'Abidjan', area_unit: 'm2', bedrooms: 4, bathrooms: 2,
    verification_status: 'verifie', commercial_status: 'disponible', unavailability_reason: null, negotiable: true, features: [],
  };
  const submit = (fields: typeof propertyFields, row: Record<string, unknown>, patch: Record<string, unknown>) =>
    fromFormValues(fields, { ...toFormValues(fields, row), ...patch }, true, row);

  it('maison → terrain : chambres et salles d’eau effacées', () => {
    const out = submit(propertyFields, house, { property_type: 'terrain' });
    expect(out).toMatchObject({ property_type: 'terrain', bedrooms: null, bathrooms: null });
  });

  it('retiré → disponible : motif d’indisponibilité effacé', () => {
    const out = submit(propertyFields, { ...house, commercial_status: 'retire', unavailability_reason: 'Travaux' }, { commercial_status: 'disponible' });
    expect(out.unavailability_reason).toBeNull();
  });

  it('bien vendu : motif « Vendu (TRX-…) » renvoyé tel quel', () => {
    const sold = { ...house, commercial_status: 'vendu', unavailability_reason: 'Vendu (TRX-2026-00001)' };
    expect(submit(propertyFields, sold, { title: 'Maison vendue' }).unavailability_reason).toBe('Vendu (TRX-2026-00001)');
  });

  it('champ déjà masqué sur la ligne d’origine : non envoyé (valeur posée par la base conservée)', () => {
    const row = { ...house, unavailability_reason: 'Vendu (TRX-2026-00001)' };
    const out = submit(propertyFields, row, { title: 'Nouveau titre' });
    expect(out).not.toHaveProperty('unavailability_reason');
    expect(out.bedrooms).toBe(4);
  });

  it('dossier annulé puis rouvert : motif d’abandon effacé', () => {
    const deal = { id: 't1', property_id: 'p1', buyer_id: 'b1', owner_id: 'o1', status: 'annulee', abandon_reason: 'Financement refusé' };
    expect(submit(transactionFields, deal, { status: 'negociation' }).abandon_reason).toBeNull();
    expect(submit(transactionFields, deal, { notes: 'Relance' }).abandon_reason).toBe('Financement refusé');
  });

  it('création : un champ masqué reste vide', () => {
    expect(fromFormValues(propertyFields, { ...toFormValues(propertyFields, null), property_type: 'terrain', bedrooms: '3' }, false).bedrooms).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Filtre « contient » : littéral tableau PostgreSQL échappé
// ---------------------------------------------------------------------------
describe('filtre « contient » (cs)', () => {
  it('met chaque élément entre guillemets et échappe « " » et « \\ »', () => {
    expect(pgArrayLiteral(['Cocody, Riviera 3'])).toBe('{"Cocody, Riviera 3"}');
    expect(pgArrayLiteral(['Quartier "Les Rosiers"'])).toBe('{"Quartier \\"Les Rosiers\\""}');
    expect(pgArrayLiteral(['Zone\\Nord', '{Plateau}', 'NULL'])).toBe('{"Zone\\\\Nord","{Plateau}","NULL"}');
  });

  it('une zone avec virgule reste un seul élément dans la requête', async () => {
    await listRows('buyers', { contains: { zones: ['Cocody, Riviera 3'] } });
    expect((await lastReq('buyers')).url.searchParams.get('zones')).toBe('cs.{"Cocody, Riviera 3"}');
  });

  it('liste des prospects filtrée par une zone contenant des guillemets', async () => {
    renderAt('agent', `/admin/acheteurs?zones=${encodeURIComponent('Quartier "Les Rosiers"')}`, '/admin/acheteurs', h(ResourceList, { config: buyersConfig }));
    expect((await lastReq('buyers')).url.searchParams.get('zones')).toBe('cs.{"Quartier \\"Les Rosiers\\""}');
  });
});

// ---------------------------------------------------------------------------
// 4. Tableau de bord : chaque tuile ouvre une liste qui correspond à son compteur
// ---------------------------------------------------------------------------
describe('tableau de bord : liens des tuiles', () => {
  const at = '2026-10-11T14:03:12.345Z';
  const links = tileLinks({ from: '2026-10-01', to: '2026-10-31' }, at);
  const listOpenedBy = async (link: string, route: string, element: ReactNode, table: string) => {
    renderAt('admin', link, route, element);
    return (await lastReq(table)).url.searchParams;
  };

  it('prospects actifs : statuts comptés par dashboard_stats (hors converti, sans suite, archivé)', async () => {
    expect(ACTIVE_BUYER_STATUSES).toEqual(Object.keys(BUYER_STATUS).filter((s) => !['converti', 'sans_suite', 'archive'].includes(s)));
    const q = await listOpenedBy(links.prospects, '/admin/acheteurs', h(ResourceList, { config: buyersConfig }), 'buyers');
    expect(q.getAll('status')).toEqual([`in.(${ACTIVE_BUYER_STATUSES.join(',')})`]);
  });

  it('ventes conclues : limitées à la période affichée (jour de fin inclus)', async () => {
    const q = await listOpenedBy(links.sales, '/admin/transactions', h(ResourceList, { config: transactionsConfig }), 'transactions');
    expect(q.getAll('status')).toEqual(['eq.vente_conclue']);
    expect(q.getAll('concluded_date')).toEqual(['gte.2026-10-01', 'lte.2026-10-31T23:59:59.999Z']);
  });

  it('commissions dues : écritures de type commission seulement', async () => {
    const q = await listOpenedBy(links.commissionsDue, '/admin/finances/recettes', h(ResourceList, { config: revenuesConfig }), 'financial_entries');
    expect(q.getAll('status')).toEqual(['in.(exigible,partiel)']);
    expect(q.getAll('entry_type')).toEqual(['eq.commission']);
  });

  it('tâches en retard : échéance passée à l’instant du calcul', async () => {
    const q = await listOpenedBy(links.tasksOverdue, '/admin/taches', h(ResourceList, { config: tasksConfig }), 'tasks');
    expect(q.getAll('status')).toEqual(['in.(a_faire,en_cours,reportee)']);
    expect(q.getAll('due_at')).toEqual([`lte.${at}`]);
  });

  it('visites à venir : la liste (et non le calendrier de la semaine) filtrée comme le compteur', async () => {
    const q = await listOpenedBy(links.visitsUpcoming, '/admin/visites', h(VisitsPage), 'visits');
    expect(screen.queryByText('Calendrier des visites')).not.toBeInTheDocument();
    expect(q.getAll('status')).toEqual(['in.(a_confirmer,confirmee)']);
    expect(q.getAll('scheduled_at')).toEqual([`gte.${at}`]);
  });

  it('dates lues depuis l’URL : format strict', () => {
    expect(dateParam('2026-10-01')).toBe('2026-10-01');
    expect(dateParam(at)).toBe(at);
    for (const bad of ['2026-13-45', '2026-02-30', '2026-04-31', '2026-02-29T10:00Z', '01/10/2026', '2026-10-01);drop', '', null]) expect(dateParam(bad), String(bad)).toBe('');
    expect(dateParam('2028-02-29')).toBe('2028-02-29');
  });
});

// ---------------------------------------------------------------------------
// 5. Fiche propriétaire : un rechargement ne démonte pas la page
// ---------------------------------------------------------------------------
describe('fiches : rechargement sans démontage', () => {
  it('l’archivage recharge la fiche sans perdre la saisie en cours', async () => {
    const owner = { id: 'o1', reference: 'PROP-2026-00001', last_name: 'KONAN', first_names: 'Awa', phone_primary: '0700000001', verification_status: 'a_verifier', contact_preference: 'telephone', archived_at: null };
    let release: () => void = () => {};
    let slow = false;
    srv.handler = ({ table }) => {
      if (table !== 'owners') return undefined;
      if (!slow) return { rows: [owner] };
      return new Promise((resolve) => { release = () => resolve({ rows: [{ ...owner, archived_at: '2026-10-11T10:00:00Z' }] }); });
    };
    const user = userEvent.setup();
    renderAt('agent', '/admin/proprietaires/o1', '/admin/proprietaires/:id', h(OwnerDetailPage));
    await screen.findByRole('heading', { name: 'KONAN Awa' });
    await user.type(screen.getByLabelText('Intitulé (test)'), 'Titre foncier');
    slow = true;
    await user.click(screen.getByRole('button', { name: 'Archiver (test)' }));
    await waitFor(() => expect(reqs('owners').length).toBe(2));
    // Pendant le rechargement : la fiche reste affichée, sans indicateur pleine page.
    expect(screen.getByRole('heading', { name: 'KONAN Awa' })).toBeInTheDocument();
    expect(screen.queryByText('Chargement…')).not.toBeInTheDocument();
    release();
    await screen.findByText(/Archivé le/);
    expect(screen.getByLabelText('Intitulé (test)')).toHaveValue('Titre foncier');
  });
});

// ---------------------------------------------------------------------------
// 6. Journal : l'auteur est affiché avec son email
// ---------------------------------------------------------------------------
describe('journal d’activité', () => {
  it('affiche l’email de l’auteur à côté de son nom (nom modifiable, donc usurpable)', async () => {
    srv.handler = ({ table }) => (table === 'activity_logs'
      ? { rows: [{ id: 1, occurred_at: '2026-10-11T10:00:00Z', action: 'publication', entity_type: 'properties', summary: 'BIEN-2026-00002 → publie', actor: { full_name: 'Kouassi Admin', email: 'compta@agence.test' } }] }
      : undefined);
    renderAt('admin', '/admin/journal', '/admin/journal', h(ActivityLogPage));
    const cell = (await screen.findByText('Kouassi Admin')).closest('td')!;
    expect(within(cell).getByText('compta@agence.test')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 7. Dossier clôturé : offres figées pour un non-administrateur
// ---------------------------------------------------------------------------
describe('offres d’un dossier clôturé', () => {
  const serve = (status: string) => {
    srv.handler = ({ table }) => {
      if (table === 'transactions') return { rows: [{ id: 't1', reference: 'TRX-2026-00001', status, property: { id: 'p1', reference: 'BIEN-2026-00001', title: 'Villa' }, buyer: null, owner: null }] };
      if (table === 'negotiations') return { rows: [{ id: 'n1', offer_kind: 'offre', from_party: 'acheteur', amount: 100000000, status: 'acceptee', offered_at: '2026-10-01T10:00:00Z' }] };
      return undefined;
    };
  };
  const open = async (role: AppRole) => {
    renderAt(role, '/admin/transactions/t1', '/admin/transactions/:id', h(TransactionDetailPage));
    await screen.findByRole('cell', { name: '100 000 000 FCFA' });
  };

  it('agent : ni « + Offre » ni « Modifier » sur une vente conclue', async () => {
    serve('vente_conclue');
    await open('agent');
    expect(screen.queryByRole('button', { name: '+ Offre' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Modifier' })).not.toBeInTheDocument();
    expect(screen.getByText(/Dossier clôturé : les offres ne peuvent plus/)).toBeInTheDocument();
  });

  it('administrateur : actions conservées', async () => {
    serve('abandonnee');
    await open('admin');
    expect(screen.getByRole('button', { name: '+ Offre' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Modifier' })).toBeInTheDocument();
  });

  it('agent : dossier en cours modifiable', async () => {
    serve('negociation');
    await open('agent');
    expect(screen.getByRole('button', { name: '+ Offre' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 8. Demandes saisies par l'équipe : pas de canal « Site web »
// ---------------------------------------------------------------------------
describe('formulaire interne des demandes : canal', () => {
  const optionsOf = () => within(screen.getByLabelText(/^Canal/)).getAllByRole('option').map((o) => o.textContent);

  it('« Site web » n’est pas proposé pour une nouvelle demande', () => {
    renderAt('agent', '/f', '/f', h(ResourceForm, { table: 'inquiries', fields: inquiryFields, defaults: { source: 'telephone' }, onSaved: () => {} }));
    expect(optionsOf()).not.toContain('Site web');
    expect(optionsOf()).toContain('Téléphone');
  });

  it('une demande venue du site garde sa source à la modification', async () => {
    const row = { id: 'i1', full_name: 'Awa Konan', phone: '0700000002', email: null, source: 'site_web', property_id: null, message: 'Bonjour', contact_preference: 'telephone', status: 'nouveau', consent: true };
    srv.handler = ({ table, method }) => (table === 'inquiries' && method === 'PATCH' ? { rows: [row] } : undefined);
    const onSaved = vi.fn();
    renderAt('agent', '/f', '/f', h(ResourceForm, { table: 'inquiries', fields: inquiryFields, row, onSaved }));
    expect(screen.getByLabelText(/^Canal/)).toHaveValue('site_web');
    expect(optionsOf()).toContain('Site web');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(reqs('inquiries').find((r) => r.method === 'PATCH')!.body).toMatchObject({ source: 'site_web' });
  });
});
