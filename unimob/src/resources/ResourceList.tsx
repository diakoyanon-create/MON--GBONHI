import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { listAllRows, listRows, logEvent, type Row } from '@/api/crud';
import { label as labelOf } from '@/domain/labels';
import { useAgencySettings, useQuery } from '@/api/hooks';
import { useAuth } from '@/auth/AuthContext';
import { EmptyState, ErrorBox, PageHeader, Spinner, humanError } from '@/components/ui';
import { downloadText, toCsv } from '@/domain/csv';
import { todayISO } from '@/lib/format';
import type { ResourceConfig } from './types';

const PAGE_SIZE = 25;

/** Lit un numéro de page sûr depuis l'URL. */
export function pageFromParam(v: string | null): number {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/** Montant entier positif lu depuis l'URL (sinon ignoré). */
const amountParam = (v: string | null) => (v && /^\d+$/.test(v) ? v : '');

export function ResourceList({ config }: { config: ResourceConfig }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data: settings } = useAgencySettings();
  const term = params.get('q') ?? '';
  const page = pageFromParam(params.get('page'));
  const showHidden = params.get('tous') === '1';
  const [draft, setDraft] = useState(term);
  const rangeKeys = [
    ...(config.rangeFilters ?? []).flatMap((r) => [`${r.name}_min`, `${r.name}_max`]),
    ...(config.coverFilter ? [config.coverFilter.param] : []),
  ];
  const [rangeDraft, setRangeDraft] = useState<Record<string, string>>({});
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  useEffect(() => setDraft(term), [term]);
  const rangeSig = rangeKeys.map((k) => params.get(k) ?? '').join('|');
  useEffect(() => setRangeDraft(Object.fromEntries(rangeKeys.map((k) => [k, params.get(k) ?? '']))), [rangeSig]); // eslint-disable-line react-hooks/exhaustive-deps

  const filterValues = Object.fromEntries((config.filters ?? []).map((f) => [f.name, params.get(f.name) ?? '']));
  // Une valeur « a,b » filtre sur plusieurs statuts (liens du tableau de bord).
  const eq: Record<string, string | null> = {};
  const inList: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(filterValues)) {
    if (!v) continue;
    if (v.includes(',')) inList[k] = v.split(',').filter(Boolean);
    else eq[k] = v;
  }
  if (config.archivedColumn && !showHidden) eq[config.archivedColumn] = null;
  const gte: Record<string, string> = {};
  const lte: Record<string, string> = {};
  for (const r of config.rangeFilters ?? []) {
    const min = amountParam(params.get(`${r.name}_min`));
    const max = amountParam(params.get(`${r.name}_max`));
    if (min) gte[r.name] = min;
    if (max) lte[r.name] = max;
  }
  const orFilters: string[] = [];
  const cover = config.coverFilter ? amountParam(params.get(config.coverFilter.param)) : '';
  if (config.coverFilter && cover) {
    orFilters.push(`${config.coverFilter.minCol}.is.null,${config.coverFilter.minCol}.lte.${cover}`);
    orFilters.push(`${config.coverFilter.maxCol}.is.null,${config.coverFilter.maxCol}.gte.${cover}`);
  }
  const containsValue = config.containsFilter ? params.get(config.containsFilter.name) ?? '' : '';

  const hide =
    config.hiddenStatuses && !showHidden && !filterValues[config.hiddenStatuses.column]
      ? { [config.hiddenStatuses.column]: config.hiddenStatuses.values }
      : undefined;
  const listParams = {
    select: config.listSelect,
    search: config.search ? { columns: config.search, term } : undefined,
    eq,
    inList,
    gte,
    lte,
    orFilters,
    contains: config.containsFilter && containsValue ? { [config.containsFilter.name]: [containsValue] } : undefined,
    notIn: hide,
    order: config.order,
  };

  const { data, error, loading } = useQuery(
    () => listRows(config.table, { ...listParams, page, pageSize: PAGE_SIZE }),
    [config.key, term, page, showHidden, JSON.stringify(filterValues), rangeSig, containsValue],
  );

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  async function exportCsv() {
    setExportError(null);
    setExporting(true);
    try {
      const rows = await listAllRows(config.table, listParams);
      const csv = toCsv(rows, config.columns.map((c) => ({
        key: c.key,
        header: c.label,
        value: (r: Row) => {
          const v = c.render ? c.render(r) : r[c.key];
          return typeof v === 'string' || typeof v === 'number' ? v : nodeText(v) ?? r[c.key];
        },
      })));
      // Journalisation d'abord : pas d'export sans trace.
      await logEvent('export_csv', config.table, `Export CSV ${config.title} (${rows.length} lignes)`);
      downloadText(`${config.exportName ?? config.key}-${todayISO()}.csv`, csv);
    } catch (e) {
      setExportError(humanError(e));
    } finally {
      setExporting(false);
    }
  }

  const rows = data?.rows ?? [];
  const count = data?.count ?? 0;
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  return (
    <div>
      <PageHeader
        title={config.title}
        subtitle={loading ? undefined : `${count} élément${count > 1 ? 's' : ''}`}
        actions={
          <>
            <button className="btn-outline btn-sm" onClick={exportCsv} disabled={!rows.length || exporting}>{exporting ? 'Export…' : 'Export CSV'}</button>
            {can[config.canCreate] && (
              <Link to={`${config.basePath}/nouveau`} className="btn-primary btn-sm">+ {config.singular}</Link>
            )}
          </>
        }
      />
      {config.notice && <div className="mb-4 rounded-lg bg-cream-200 px-3 py-2 text-xs text-ink-700">{config.notice}</div>}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {config.search && (
          <form
            className="flex flex-1 gap-2"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              update({ q: draft });
            }}
          >
            <input className="input" type="search" placeholder={config.searchPlaceholder ?? 'Rechercher…'} aria-label="Rechercher" value={draft} onChange={(e) => setDraft(e.target.value)} />
            <button className="btn-outline" type="submit">OK</button>
          </form>
        )}
        {(config.filters ?? []).map((f) => {
          const v = filterValues[f.name];
          const multi = v.includes(',') ? v.split(',').map((x) => f.options.find((o) => o.value === x)?.label ?? x).join(' + ') : null;
          return (
            <select key={f.name} className="input sm:w-auto" aria-label={f.label} value={v} onChange={(e) => update({ [f.name]: e.target.value })}>
              <option value="">{f.label} : tous</option>
              {multi && <option value={v}>{multi}</option>}
              {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          );
        })}
        {config.containsFilter && (
          <select className="input sm:w-auto" aria-label={config.containsFilter.label} value={containsValue} onChange={(e) => update({ [config.containsFilter!.name]: e.target.value })}>
            <option value="">{config.containsFilter.label} : toutes</option>
            {((settings?.[config.containsFilter.settingsOptions] as string[] | undefined) ?? []).map((z) => <option key={z} value={z}>{z}</option>)}
            {containsValue && !((settings?.[config.containsFilter.settingsOptions] as string[] | undefined) ?? []).includes(containsValue) && <option value={containsValue}>{containsValue}</option>}
          </select>
        )}
        {(config.hiddenStatuses || config.archivedColumn) && (
          <label className="flex min-h-11 items-center gap-2 text-sm text-ink-700">
            <input type="checkbox" className="h-4 w-4 accent-gold-600" checked={showHidden} onChange={(e) => update({ tous: e.target.checked ? '1' : null })} />
            {config.hiddenStatuses?.label ?? 'Afficher les archivés'}
          </label>
        )}
      </div>
      {rangeKeys.length > 0 && (
        <form
          className="mb-4 flex flex-wrap items-end gap-2"
          aria-label="Filtres de montant"
          onSubmit={(e) => {
            e.preventDefault();
            update(Object.fromEntries(rangeKeys.map((k) => [k, (rangeDraft[k] ?? '').replace(/\D/g, '')])));
          }}
        >
          {(config.rangeFilters ?? []).map((r) => (
            <div key={r.name} className="flex gap-2">
              <label className="flex flex-col text-xs text-ink-500">{r.label} min.
                <input className="input w-36" inputMode="numeric" value={rangeDraft[`${r.name}_min`] ?? ''} onChange={(e) => setRangeDraft((d) => ({ ...d, [`${r.name}_min`]: e.target.value }))} />
              </label>
              <label className="flex flex-col text-xs text-ink-500">{r.label} max.
                <input className="input w-36" inputMode="numeric" value={rangeDraft[`${r.name}_max`] ?? ''} onChange={(e) => setRangeDraft((d) => ({ ...d, [`${r.name}_max`]: e.target.value }))} />
              </label>
            </div>
          ))}
          {config.coverFilter && (
            <label className="flex flex-col text-xs text-ink-500">{config.coverFilter.label}
              <input className="input w-44" inputMode="numeric" value={rangeDraft[config.coverFilter.param] ?? ''} onChange={(e) => setRangeDraft((d) => ({ ...d, [config.coverFilter!.param]: e.target.value }))} />
            </label>
          )}
          <button className="btn-outline" type="submit">Appliquer</button>
        </form>
      )}
      <ErrorBox error={error ?? exportError} />
      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        page > 0 && count > 0 ? (
          <EmptyState>Cette page n’existe plus. <button className="underline" onClick={() => update({ page: null })}>Revenir à la première page</button></EmptyState>
        ) : (
          <EmptyState>Aucun résultat.</EmptyState>
        )
      ) : (
        <>
          {/* Tableau (tablette/ordinateur) */}
          <div className="table-wrap hidden md:block">
            <table className="table">
              <thead>
                <tr>{config.columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="cursor-pointer hover:bg-cream"
                    onClick={() => navigate(config.hasDetail ? `${config.basePath}/${r.id}` : `${config.basePath}/${r.id}/modifier`)}
                  >
                    {config.columns.map((c, i) => (
                      <td key={c.key} className={c.className}>
                        {i === 0 ? (
                          <Link className="font-medium text-ink-900 underline-offset-2 hover:underline" to={config.hasDetail ? `${config.basePath}/${r.id}` : `${config.basePath}/${r.id}/modifier`} onClick={(e) => e.stopPropagation()}>
                            {c.render ? c.render(r) : (r[c.key] ?? '—')}
                          </Link>
                        ) : c.render ? c.render(r) : (r[c.key] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Cartes (mobile) */}
          <ul className="space-y-2 md:hidden">
            {rows.map((r) => (
              <li key={r.id}>
                <Link to={config.hasDetail ? `${config.basePath}/${r.id}` : `${config.basePath}/${r.id}/modifier`} className="card block p-3 active:bg-cream">
                  <div className="font-medium">{config.columns[0].render ? config.columns[0].render(r) : r[config.columns[0].key]}</div>
                  <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    {config.columns.slice(1, 5).map((c) => (
                      <div key={c.key} className="min-w-0">
                        <dt className="text-ink-500">{c.label}</dt>
                        <dd className="truncate">{c.render ? c.render(r) : (r[c.key] ?? '—')}</dd>
                      </div>
                    ))}
                  </dl>
                </Link>
              </li>
            ))}
          </ul>
          {pages > 1 && (
            <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pagination">
              <button className="btn-outline btn-sm" disabled={page === 0} onClick={() => update({ page: String(page - 1) })}>← Précédent</button>
              <span className="text-ink-500">Page {page + 1} / {pages}</span>
              <button className="btn-outline btn-sm" disabled={page + 1 >= pages} onClick={() => update({ page: String(page + 1) })}>Suivant →</button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}

/** Texte brut d'un rendu React simple (pour l'export). */
function nodeText(node: unknown): string | null {
  if (node === null || node === undefined || typeof node === 'boolean') return null;
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).filter(Boolean).join(' ');
  const props = (node as { props?: { children?: unknown; value?: string; map?: Record<string, string> } }).props;
  if (!props) return null;
  if (props.map && props.value !== undefined) return labelOf(props.map, props.value);
  return nodeText(props.children);
}
