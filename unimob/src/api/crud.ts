import { supabase } from '@/lib/supabase';

export type Row = Record<string, any>;
export type ListParams = {
  select?: string;
  search?: { columns: string[]; term: string };
  eq?: Record<string, string | number | boolean | null | undefined>;
  inList?: Record<string, string[]>;
  notIn?: Record<string, string[]>;
  gte?: Record<string, string | number | undefined>;
  lte?: Record<string, string | number | undefined>;
  /** Colonne tableau contenant toutes les valeurs (opérateur PostgREST cs). */
  contains?: Record<string, string[]>;
  /** Conditions « ou » PostgREST supplémentaires (combinées entre elles par « et »). */
  orFilters?: string[];
  order?: { column: string; ascending?: boolean };
  page?: number;
  pageSize?: number;
};

/** Échappe une saisie utilisateur pour un filtre PostgREST or(... ilike ...). */
export function sanitizeSearch(term: string): string {
  return term.replace(/[%_,()*\\:"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

/** Taille maximale d'une réponse de l'API Supabase (réglage « Max rows », 1000 par défaut). */
export const API_MAX_ROWS = 1000;

/** Erreur PostgREST « page hors limites » (offset au-delà du total). */
export const isRangeError = (e: unknown) => (e as { code?: string } | null)?.code === 'PGRST103';

function buildQuery(table: string, p: ListParams) {
  let q = supabase.from(table).select(p.select ?? '*', { count: 'exact' });
  for (const [k, v] of Object.entries(p.eq ?? {})) {
    if (v === undefined || v === '') continue;
    q = v === null ? q.is(k, null) : q.eq(k, v);
  }
  for (const [k, v] of Object.entries(p.inList ?? {})) if (v.length) q = q.in(k, v);
  for (const [k, v] of Object.entries(p.notIn ?? {})) if (v.length) q = q.not(k, 'in', `(${v.join(',')})`);
  for (const [k, v] of Object.entries(p.gte ?? {})) if (v !== undefined && v !== '') q = q.gte(k, v);
  for (const [k, v] of Object.entries(p.lte ?? {})) if (v !== undefined && v !== '') q = q.lte(k, v);
  for (const [k, v] of Object.entries(p.contains ?? {})) if (v.length) q = q.contains(k, v);
  for (const f of p.orFilters ?? []) q = q.or(f);
  const term = p.search ? sanitizeSearch(p.search.term) : '';
  if (p.search && term) {
    q = q.or(p.search.columns.map((c) => `${c}.ilike.*${term}*`).join(','));
  }
  if (p.order) q = q.order(p.order.column, { ascending: p.order.ascending ?? false, nullsFirst: false });
  return q;
}

/** Une page de résultats. Une page au-delà du total renvoie une liste vide (et le total réel). */
export async function listRows(table: string, p: ListParams = {}): Promise<{ rows: Row[]; count: number }> {
  const pageSize = Math.min(p.pageSize ?? 25, API_MAX_ROWS);
  const page = Number.isInteger(p.page) && (p.page ?? 0) > 0 ? (p.page as number) : 0;
  const { data, error, count } = await buildQuery(table, p).range(page * pageSize, page * pageSize + pageSize - 1);
  if (error) {
    if (isRangeError(error) && page > 0) {
      const { count: total, error: e2 } = await buildQuery(table, p).range(0, 0);
      if (e2) throw e2;
      return { rows: [], count: total ?? 0 };
    }
    throw error;
  }
  return { rows: (data ?? []) as unknown as Row[], count: count ?? 0 };
}

/**
 * Toutes les lignes (exports, PDF, statistiques), par tranches de 1000 pour respecter
 * le plafond de l'API. Lève une erreur plutôt que de renvoyer un résultat tronqué.
 */
export async function listAllRows(table: string, p: ListParams = {}, max = 50_000): Promise<Row[]> {
  const rows: Row[] = [];
  for (let page = 0; ; page++) {
    const { data, error, count } = await buildQuery(table, p).range(page * API_MAX_ROWS, page * API_MAX_ROWS + API_MAX_ROWS - 1);
    if (error) {
      if (isRangeError(error)) break;
      throw error;
    }
    rows.push(...((data ?? []) as unknown as Row[]));
    const total = count ?? rows.length;
    if (rows.length >= total || !data?.length) {
      if (rows.length < total) throw new Error(`Lecture incomplète (${rows.length}/${total} lignes). Réessayez.`);
      break;
    }
    if (rows.length >= max) throw new Error(`Trop de lignes (${total}). Affinez la période ou les filtres.`);
  }
  return rows;
}

export async function getRow(table: string, id: string, select = '*'): Promise<Row | null> {
  const { data, error } = await supabase.from(table).select(select).eq('id', id).maybeSingle();
  if (error) throw error;
  return data as Row | null;
}

export async function insertRow(table: string, values: Row): Promise<Row> {
  const { data, error } = await supabase.from(table).insert(values).select().single();
  if (error) throw error;
  return data as Row;
}

export async function updateRow(table: string, id: string, values: Row): Promise<Row> {
  const { data, error } = await supabase.from(table).update(values).eq('id', id).select().single();
  if (error) throw error;
  return data as Row;
}

export async function deleteRow(table: string, id: string): Promise<void> {
  const { error, count } = await supabase.from(table).delete({ count: 'exact' }).eq('id', id);
  if (error) throw error;
  if (count === 0) throw new Error('Suppression refusée (droits insuffisants).');
}

export async function rpc<T = unknown>(fn: string, args: Row = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export type LoggedAction = 'export_csv' | 'export_pdf' | 'consultation_document' | 'publication' | 'depublication';

/** Trace un export ou une action sensible dans le journal d'activité (erreur levée si impossible). */
export async function logEvent(action: LoggedAction, entityType: string, summary: string, entityId: string | null = null) {
  const { error } = await supabase.rpc('log_event', { p_action: action, p_entity_type: entityType, p_entity_id: entityId, p_summary: summary });
  if (error) throw error;
}
