import { useEffect, useState } from 'react';
import { getRow, listRows, type Row } from '@/api/crud';
import type { FieldDef } from './types';
import type { Option } from '@/domain/labels';

type Props = {
  field: FieldDef;
  value: any;
  error?: string;
  onChange: (value: any) => void;
  settings?: Record<string, any> | null;
};

export function useRelationOptions(field: FieldDef, current?: string): Option[] {
  const [opts, setOpts] = useState<Option[]>([]);
  const [extra, setExtra] = useState<Option | null>(null);
  const rel = field.relation;
  // La valeur enregistrée peut être absente de la liste (élément archivé, inactif, hors des 500 premiers) :
  // on la charge pour l'afficher au lieu de « — Choisir — ».
  useEffect(() => {
    if (!rel || !current || opts.some((o) => o.value === current)) {
      setExtra(null);
      return;
    }
    let alive = true;
    getRow(rel.table, current, rel.select)
      .then((r) => alive && setExtra({ value: current, label: r ? `${rel.label(r)} (non listé : archivé ou inactif)` : 'Élément actuel (non accessible)' }))
      .catch(() => alive && setExtra({ value: current, label: 'Élément actuel (non accessible)' }));
    return () => {
      alive = false;
    };
  }, [rel, current, opts]);
  useEffect(() => {
    if (!rel) return;
    let alive = true;
    listRows(rel.table, { select: rel.select, eq: rel.eq, order: { column: rel.order ?? 'created_at', ascending: false }, pageSize: 500 })
      .then(({ rows }) => {
        if (!alive) return;
        const filtered = rel.notIn ? rows.filter((r: Row) => !rel.notIn!.values.includes(r[rel.notIn!.column])) : rows;
        setOpts(filtered.map((r: Row) => ({ value: r.id, label: rel.label(r) })));
      })
      .catch(() => alive && setOpts([]));
    return () => {
      alive = false;
    };
  }, [rel]);
  return extra ? [extra, ...opts] : opts;
}

export function FieldInput({ field, value, error, onChange, settings }: Props) {
  const id = `f-${field.name}`;
  const relOptions = useRelationOptions(field, field.relation && typeof value === 'string' ? value : undefined);
  const describedBy = error ? `${id}-err` : field.help ? `${id}-help` : undefined;
  const common = {
    id,
    name: field.name,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy,
    required: field.required,
  } as const;

  let options: Option[] = field.options ?? [];
  if (field.settingsOptions) {
    const list = (settings?.[field.settingsOptions] as string[] | undefined) ?? [];
    options = list.map((s) => ({ value: s, label: s }));
    if (value && typeof value === 'string' && !list.includes(value)) options = [{ value, label: value }, ...options];
  }
  if (field.relation) options = relOptions;
  if ((field.type === 'select') && value && !options.some((o) => o.value === value)) {
    options = [{ value, label: value }, ...options];
  }

  let input;
  switch (field.type) {
    case 'textarea':
      input = <textarea {...common} className="input min-h-28" value={value} maxLength={field.maxLength} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'select':
    case 'relation':
      input = (
        <select {...common} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{field.required ? '— Choisir —' : '— Aucun —'}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      );
      break;
    case 'boolean':
      return (
        <div className={field.full ? 'sm:col-span-2' : ''}>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <input type="checkbox" id={id} name={field.name} className="h-5 w-5 accent-gold-600" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
            <span>{field.label}</span>
          </label>
          {field.help && <p id={`${id}-help`} className="mt-1 text-xs text-ink-500">{field.help}</p>}
        </div>
      );
    case 'multiselect':
      input = (
        <div className="flex flex-wrap gap-2" role="group" aria-labelledby={`${id}-label`}>
          {options.map((o) => {
            const checked = (value as string[]).includes(o.value);
            return (
              <label key={o.value} className={`badge min-h-9 cursor-pointer border px-3 ${checked ? 'border-gold-500 bg-gold-300/40' : 'border-ink-200 bg-white'}`}>
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={checked}
                  onChange={() => onChange(checked ? (value as string[]).filter((v) => v !== o.value) : [...value, o.value])}
                />
                {o.label}
              </label>
            );
          })}
        </div>
      );
      break;
    case 'tags':
      input = <TagsInput id={id} value={value as string[]} onChange={onChange} placeholder={field.placeholder} suggestions={options.map((o) => o.value)} />;
      break;
    default: {
      const type =
        field.type === 'money' || field.type === 'number' ? 'text'
          : field.type === 'datetime' ? 'datetime-local'
          : field.type;
      input = (
        <input
          {...common}
          type={type}
          className="input"
          value={value}
          maxLength={field.maxLength}
          placeholder={field.placeholder ?? (field.type === 'money' ? 'Montant en FCFA' : undefined)}
          inputMode={field.type === 'money' ? 'numeric' : field.type === 'number' ? 'decimal' : field.type === 'tel' ? 'tel' : undefined}
          autoComplete={field.type === 'tel' ? 'tel' : field.type === 'email' ? 'email' : 'off'}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    }
  }

  return (
    <div className={field.full || field.type === 'textarea' || field.type === 'multiselect' ? 'sm:col-span-2' : ''}>
      <label htmlFor={id} id={`${id}-label`} className="label">
        {field.label}
        {field.required && <span className="text-red-700"> *</span>}
      </label>
      {input}
      {field.help && !error && <p id={`${id}-help`} className="mt-1 text-xs text-ink-500">{field.help}</p>}
      {error && <p id={`${id}-err`} className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}

function TagsInput({ id, value, onChange, placeholder, suggestions }: { id: string; value: string[]; onChange: (v: string[]) => void; placeholder?: string; suggestions: string[] }) {
  const [draft, setDraft] = useState('');
  const add = (s: string) => {
    const t = s.trim();
    if (t && !value.includes(t)) onChange([...value, t]);
    setDraft('');
  };
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {value.map((t) => (
          <span key={t} className="badge bg-cream-200 text-ink-700">
            {t}
            <button type="button" className="ml-1 text-ink-500 hover:text-red-700" aria-label={`Retirer ${t}`} onClick={() => onChange(value.filter((v) => v !== t))}>×</button>
          </span>
        ))}
      </div>
      <input
        id={id}
        className="input"
        value={draft}
        list={suggestions.length ? `${id}-list` : undefined}
        placeholder={placeholder ?? 'Saisir puis Entrée'}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add(draft);
          }
        }}
        onBlur={() => draft && add(draft)}
      />
      {suggestions.length > 0 && (
        <datalist id={`${id}-list`}>
          {suggestions.map((s) => <option key={s} value={s} />)}
        </datalist>
      )}
    </div>
  );
}
