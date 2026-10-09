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
  order?: { column: string; ascending?: boolean };
  page?: number;
  pageSize?: number;
};

/** Échappe une saisie utilisateur pour un filtre PostgREST or(... ilike ...). */
export function sanitizeSearch(term: string): string {
  return term.replace(/[%_,()*\\:"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

export async function listRows(table: string, p: ListParams = {}): Promise<{ rows: Row[]; count: number }> {
  const pageSize = p.pageSize ?? 25;
  const page = p.page ?? 0;
  let q = supabase.from(table).select(p.select ?? '*', { count: 'exact' });
  for (const [k, v] of Object.entries(p.eq ?? {})) {
    if (v === undefined || v === '') continue;
    q = v === null ? q.is(k, null) : q.eq(k, v);
  }
  for (const [k, v] of Object.entries(p.inList ?? {})) if (v.length) q = q.in(k, v);
  for (const [k, v] of Object.entries(p.notIn ?? {})) if (v.length) q = q.not(k, 'in', `(${v.join(',')})`);
  for (const [k, v] of Object.entries(p.gte ?? {})) if (v !== undefined && v !== '') q = q.gte(k, v);
  for (const [k, v] of Object.entries(p.lte ?? {})) if (v !== undefined && v !== '') q = q.lte(k, v);
  const term = p.search ? sanitizeSearch(p.search.term) : '';
  if (p.search && term) {
    q = q.or(p.search.columns.map((c) => `${c}.ilike.*${term}*`).join(','));
  }
  if (p.order) q = q.order(p.order.column, { ascending: p.order.ascending ?? false, nullsFirst: false });
  q = q.range(page * pageSize, page * pageSize + pageSize - 1);
  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: (data ?? []) as unknown as Row[], count: count ?? 0 };
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

/** Trace un export ou une action sensible dans le journal d'activité. */
export async function logEvent(action: string, entityType: string, summary: string, entityId: string | null = null) {
  await supabase.rpc('log_event', { p_action: action, p_entity_type: entityType, p_entity_id: entityId, p_summary: summary });
}
