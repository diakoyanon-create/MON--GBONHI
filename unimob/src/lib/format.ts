export const TIMEZONE = 'Africa/Abidjan';
export const LOCALE = 'fr-FR';

const xof = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });

/** Formate un montant entier en francs CFA (XOF). Accepte les chaînes renvoyées par PostgreSQL (numeric). */
export function formatXOF(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '—';
  return `${xof.format(Math.round(n)).replace(/\u202f|\u00a0/g, ' ')} FCFA`;
}

export function formatNumber(value: number | string | null | undefined, digits = 0): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: digits }).format(n).replace(/\u202f|\u00a0/g, ' ');
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(LOCALE, { timeZone: TIMEZONE, day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: TIMEZONE, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(d);
}

/** Date du jour (AAAA-MM-JJ) dans le fuseau de l'agence. */
export function todayISO(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Convertit une valeur timestamptz en valeur pour <input type="datetime-local"> (heure d'Abidjan = UTC). */
export function toDateTimeInput(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/** Interprète une saisie datetime-local comme heure d'Abidjan (UTC+0, sans heure d'été). */
export function fromDateTimeInput(value: string): string | null {
  if (!value) return null;
  return new Date(`${value}:00Z`).toISOString();
}

export function fullName(p: { last_name?: string | null; first_names?: string | null } | null | undefined): string {
  if (!p) return '—';
  return [p.last_name, p.first_names].filter(Boolean).join(' ') || '—';
}
