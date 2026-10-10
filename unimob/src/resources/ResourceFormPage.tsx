import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { deleteRow, getRow, type Row } from '@/api/crud';
import { useQuery } from '@/api/hooks';
import { useAuth } from '@/auth/AuthContext';
import { ErrorBox, PageHeader, Spinner, humanError } from '@/components/ui';
import { ResourceForm } from './ResourceForm';
import { AttachmentField } from '@/components/AttachmentField';
import type { ResourceConfig } from './types';
import type { FormValues } from './values';
import type { ReactNode } from 'react';

/** Page de création / modification générique (route …/nouveau et …/:id/modifier). */
export function ResourceFormPage({ config, aside }: { config: ResourceConfig; aside?: (v: FormValues) => ReactNode }) {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [delError, setDelError] = useState<string | null>(null);
  const { data: row, error, loading, reload } = useQuery(() => (id ? getRow(config.table, id) : Promise.resolve(null)), [id, config.table]);

  // Préremplissage depuis l'URL (?property_id=…&buyer_id=…) pour enchaîner les actions.
  const prefill: Record<string, unknown> = { ...(typeof config.defaults === 'function' ? config.defaults() : config.defaults ?? {}) };
  for (const f of config.fields) {
    const v = params.get(f.name);
    if (v) prefill[f.name] = v;
  }

  const back = (saved?: Row) => {
    const ret = params.get('retour');
    if (ret && ret.startsWith('/admin')) navigate(ret);
    else if (saved && config.hasDetail) navigate(`${config.basePath}/${saved.id}`);
    else navigate(config.basePath);
  };

  if (!can[id ? config.canEdit : config.canCreate]) {
    return <ErrorBox error="Votre rôle ne permet pas cette action." />;
  }
  if (id && loading && !row) return <Spinner />;
  if (id && (error || !row)) return <ErrorBox error={error ?? 'Élément introuvable ou accès refusé.'} />;

  return (
    <div className="max-w-4xl">
      <PageHeader
        title={id ? `Modifier — ${row?.reference ?? row?.title ?? row?.name ?? config.singular}` : `Nouveau : ${config.singular.toLowerCase()}`}
        actions={<Link to={config.basePath} className="btn-outline btn-sm">← {config.title}</Link>}
      />
      {config.notice && <div className="mb-4 rounded-lg bg-cream-200 px-3 py-2 text-xs text-ink-700">{config.notice}</div>}
      <div className="card p-4 sm:p-6">
        <ResourceForm
          key={row?.id ?? 'new'}
          table={config.table}
          fields={config.fields}
          row={row}
          defaults={prefill}
          onSaved={back}
          onCancel={() => back()}
          aside={aside}
        />
      </div>
      {id && row && config.attachment && (
        <div className="mt-5">
          <AttachmentField
            table={config.table}
            id={id}
            {...config.attachment}
            currentPath={row[config.attachment.column] ?? null}
            editable={can[config.canEdit]}
            onSaved={reload}
          />
        </div>
      )}
      {id && can.admin && config.canDelete !== false && (
        <div className="mt-6 rounded-xl border border-red-200 p-4">
          <h2 className="text-sm font-semibold text-red-800">Zone sensible</h2>
          <p className="mt-1 text-xs text-ink-500">
            La suppression est définitive et refusée si l’élément est lié à d’autres dossiers. Préférez l’archivage pour conserver l’historique.
          </p>
          <ErrorBox error={delError} />
          <button
            className="btn-danger btn-sm mt-3"
            onClick={async () => {
              if (!window.confirm('Supprimer définitivement cet élément ?')) return;
              try {
                await deleteRow(config.table, id);
                navigate(config.basePath);
              } catch (e) {
                setDelError(humanError(e));
              }
            }}
          >
            Supprimer
          </button>
        </div>
      )}
    </div>
  );
}
