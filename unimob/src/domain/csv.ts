// Export CSV : uniquement les colonnes explicitement autorisées, protégé contre l'injection de formules.

export type CsvColumn<T> = { key: string; header: string; value?: (row: T) => unknown };

const FORBIDDEN = /(password|mot_de_passe|token|secret|api_key|jwt|service_role|fingerprint)/i;

export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = Array.isArray(value) ? value.join(' | ') : typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Neutralise les formules Excel/Sheets (=, +, -, @, tab, CR).
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[";\n\r,]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv<T extends Record<string, unknown>>(rows: T[], columns: CsvColumn<T>[]): string {
  for (const c of columns) {
    if (FORBIDDEN.test(c.key)) throw new Error(`Colonne interdite à l'export : ${c.key}`);
  }
  const header = columns.map((c) => csvEscape(c.header)).join(';');
  const lines = rows.map((r) => columns.map((c) => csvEscape(c.value ? c.value(r) : r[c.key])).join(';'));
  // BOM UTF-8 pour une ouverture correcte des accents dans Excel.
  return '﻿' + [header, ...lines].join('\r\n');
}

export function downloadText(filename: string, content: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
