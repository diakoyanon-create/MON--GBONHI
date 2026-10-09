import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { insertRow, updateRow, type Row } from '@/api/crud';
import { ErrorBox, humanError } from '@/components/ui';
import { FieldInput } from './FieldInput';
import { fromFormValues, toFormValues, validate, type FormValues } from './values';
import type { FieldDef } from './types';
import { useAgencySettings } from '@/api/hooks';

type Props = {
  table: string;
  fields: FieldDef[];
  row?: Row | null;
  defaults?: Record<string, unknown>;
  /** Valeurs ajoutées à l'envoi (ex. clé étrangère du parent). */
  extra?: Row;
  submitLabel?: string;
  onSaved: (row: Row) => void;
  onCancel?: () => void;
  /** Affiché sous le formulaire en fonction des valeurs (avertissements, aperçu). */
  aside?: (values: FormValues) => ReactNode;
};

/**
 * Formulaire générique : les saisies sont conservées en cas d'erreur serveur
 * (réseau, contrainte) pour ne rien perdre sur mobile.
 */
export function ResourceForm({ table, fields, row, defaults, extra, submitLabel, onSaved, onCancel, aside }: Props) {
  const isEdit = Boolean(row?.id);
  const visibleFields = useMemo(() => fields.filter((f) => isEdit || !f.editOnly), [fields, isEdit]);
  const [values, setValues] = useState<FormValues>(() => toFormValues(fields, row ?? null, defaults));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { data: settings } = useAgencySettings();

  const set = (name: string, v: unknown) => {
    setValues((prev) => ({ ...prev, [name]: v }));
    if (errors[name]) setErrors((e) => ({ ...e, [name]: '' }));
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs = validate(visibleFields, values);
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) {
      setServerError('Veuillez corriger les champs signalés.');
      return;
    }
    setSaving(true);
    setServerError(null);
    try {
      const payload = { ...fromFormValues(visibleFields, values, isEdit), ...(extra ?? {}) };
      const saved = isEdit ? await updateRow(table, row!.id, payload) : await insertRow(table, payload);
      onSaved(saved);
    } catch (err) {
      setServerError(humanError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {visibleFields
          .filter((f) => !f.showIf || f.showIf(values))
          .map((f) => (
            <FieldInput key={f.name} field={f} value={values[f.name]} error={errors[f.name]} onChange={(v) => set(f.name, v)} settings={settings} />
          ))}
      </div>
      {aside?.(values)}
      <ErrorBox error={serverError} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Enregistrement…' : submitLabel ?? (isEdit ? 'Enregistrer' : 'Créer')}
        </button>
        {onCancel && <button type="button" className="btn-outline" onClick={onCancel}>Annuler</button>}
      </div>
    </form>
  );
}
