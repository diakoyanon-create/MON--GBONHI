import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { listRows, logEvent, type Row } from '@/api/crud';
import { label as labelOf } from '@/domain/labels';
import { useQuery } from '@/api/hooks';
import { useAuth } from '@/auth/AuthContext';
import { EmptyState, ErrorBox, PageHeader, Spinner, humanError } from '@/components/ui';
import { downloadText, toCsv } from '@/domain/csv';
import { todayISO } from '@/lib/format';
import type { ResourceConfig } from './types';

const PAGE_SIZE = 25;

export function ResourceList({ config }: { config: ResourceConfig }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const term = params.get('q') ?? '';
  const page = Number(params.get('page') ?? 0);
  const showHidden = params.get('tous') === '1';
  const [draft, setDraft] = useState(term);
  const [exportError, setExportError] = useState<string | null>(null);
  useEffect(() => setDraft(term), [term]);

  const filterValues = Object.fromEntries((config.filters ?? []).map((f) => [f.name, params.get(f.name) ?? '']));

  const hide =
    config.hiddenStatuses && !showHidden && !filterValues[config.hiddenStatuses.column]
      ? { [config.hiddenStatuses.column]: config.hiddenStatuses.values }
      : undefined;
  const listParams = {
    select: config.listSelect,
    search: config.search ? { columns: config.search, term } : undefined,
    eq: filterValues,
    notIn: hide,
    order: config.order,
  };

  const { data, error, loading } = useQuery(
    () => listRows(config.table, { ...listParams, page, pageSize: PAGE_SIZE }),
    [config.key, term, page, showHidden, JSON.stringify(filterValues)],
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
    try {
      const { rows } = await listRows(config.table, { ...listParams, pageSize: 5000 });
      const csv = toCsv(rows, config.columns.map((c) => ({
        key: c.key,
        header: c.label,
        value: (r: Row) => {
          const v = c.render ? c.render(r) : r[c.key];
          return typeof v === 'string' || typeof v === 'number' ? v : nodeText(v) ?? r[c.key];
        },
      })));
      downloadText(`${config.exportName ?? config.key}-${todayISO()}.csv`, csv);
      await logEvent('export_csv', config.table, `Export CSV ${config.title} (${rows.length} lignes)`);
    } catch (e) {
      setExportError(humanError(e));
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
            <button className="btn-outline btn-sm" onClick={exportCsv} disabled={!rows.length}>Export CSV</button>
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
        {(config.filters ?? []).map((f) => (
          <select key={f.name} className="input sm:w-auto" aria-label={f.label} value={filterValues[f.name]} onChange={(e) => update({ [f.name]: e.target.value })}>
            <option value="">{f.label} : tous</option>
            {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ))}
        {config.hiddenStatuses && (
          <label className="flex min-h-11 items-center gap-2 text-sm text-ink-700">
            <input type="checkbox" className="h-4 w-4 accent-gold-600" checked={showHidden} onChange={(e) => update({ tous: e.target.checked ? '1' : null })} />
            {config.hiddenStatuses.label}
          </label>
        )}
      </div>
      <ErrorBox error={error ?? exportError} />
      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState>Aucun résultat.</EmptyState>
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
