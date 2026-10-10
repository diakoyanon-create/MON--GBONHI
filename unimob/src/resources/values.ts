import { parseXOF } from '@/lib/money';
import { fromDateTimeInput, toDateTimeInput } from '@/lib/format';
import type { FieldDef } from './types';
import type { Row } from '@/api/crud';

export type FormValues = Record<string, any>;

/** Ligne de base → valeurs de formulaire (chaînes pour les champs texte). */
export function toFormValues(fields: FieldDef[], row: Row | null, defaults: Record<string, unknown> = {}): FormValues {
  const out: FormValues = {};
  for (const f of fields) {
    const v = row ? row[f.name] : defaults[f.name];
    switch (f.type) {
      case 'boolean':
        out[f.name] = Boolean(v ?? false);
        break;
      case 'tags':
      case 'multiselect':
        out[f.name] = Array.isArray(v) ? v : [];
        break;
      case 'datetime':
        out[f.name] = typeof v === 'string' ? toDateTimeInput(v) : '';
        break;
      default:
        out[f.name] = v === null || v === undefined ? '' : String(v);
    }
  }
  return out;
}

/** Valeurs de formulaire → données à envoyer (null pour vide, nombres, dates ISO). */
export function fromFormValues(fields: FieldDef[], values: FormValues, isEdit: boolean): Row {
  const out: Row = {};
  for (const f of fields) {
    if (f.editOnly && !isEdit) continue;
    if (f.showIf && !f.showIf(values)) {
      // En modification, un champ masqué n'est pas envoyé : sa valeur enregistrée est conservée
      // (ex. motif « Vendu (TRX-…) » posé par la base). À la création, il reste vide.
      if (!isEdit) out[f.name] = f.type === 'boolean' ? false : f.type === 'tags' || f.type === 'multiselect' ? [] : null;
      continue;
    }
    const v = values[f.name];
    switch (f.type) {
      case 'boolean':
        out[f.name] = Boolean(v);
        break;
      case 'tags':
      case 'multiselect':
        out[f.name] = Array.isArray(v) ? v.map((s: string) => s.trim()).filter(Boolean) : [];
        break;
      case 'money': {
        const s = String(v ?? '').trim();
        out[f.name] = s === '' ? null : parseXOF(s);
        break;
      }
      case 'number': {
        const s = String(v ?? '').replace(/\s/g, '').replace(',', '.');
        out[f.name] = s === '' ? null : Number(s);
        break;
      }
      case 'datetime':
        out[f.name] = fromDateTimeInput(String(v ?? ''));
        break;
      default: {
        const s = typeof v === 'string' ? v.trim() : v;
        out[f.name] = s === '' || s === undefined ? null : s;
      }
    }
  }
  return out;
}

/** Validation côté interface (la base revalide tout). */
export function validate(fields: FieldDef[], values: FormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of fields) {
    if (f.showIf && !f.showIf(values)) continue;
    const v = values[f.name];
    const empty = v === '' || v === null || v === undefined || (Array.isArray(v) && v.length === 0);
    if (f.required && empty && f.type !== 'boolean') {
      errors[f.name] = 'Champ obligatoire';
      continue;
    }
    if (empty) continue;
    if (f.type === 'number' || f.type === 'money') {
      const n = f.type === 'money' ? parseXOF(String(v)) : Number(String(v).replace(/\s/g, '').replace(',', '.'));
      if (!Number.isFinite(n)) errors[f.name] = f.type === 'money' ? 'Montant invalide (ex. 150000 ou 150 000)' : 'Nombre invalide';
      else if (f.min !== undefined && n < f.min) errors[f.name] = `Minimum ${f.min}`;
      else if (f.max !== undefined && n > f.max) errors[f.name] = `Maximum ${f.max}`;
      else if (f.type === 'money' && !Number.isInteger(n)) errors[f.name] = 'Montant entier en FCFA';
    }
    if (f.type === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v))) errors[f.name] = 'Adresse électronique invalide';
    if (f.type === 'tel' && !/^\+?[0-9][0-9 .-]{5,29}$/.test(String(v).trim())) errors[f.name] = 'Numéro invalide';
    if (f.maxLength && String(v).length > f.maxLength) errors[f.name] = `${f.maxLength} caractères maximum`;
  }
  return errors;
}
