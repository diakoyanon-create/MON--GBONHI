import { useState } from 'react';
import { listRows, logEvent } from '@/api/crud';
import { useQuery } from '@/api/hooks';
import { storagePath, validateFile } from '@/domain/files';
import { formatDateTime } from '@/lib/format';
import { openPrivateFile, PRIVATE_UPLOAD_OPTIONS } from '@/lib/photos';
import { useAuth } from '@/auth/AuthContext';
import { DOCS_BUCKET, supabase } from '@/lib/supabase';
import { ErrorBox, Section, Spinner, humanError } from './ui';

const DOC_TYPES = ['Titre foncier', 'ACD', 'Attestation villageoise', 'Plan', 'Pièce d’identité', 'Mandat signé', 'Autre'];

/** Documents confidentiels (bucket privé, accès par lien signé de 5 minutes). */
export function PrivateDocuments({ propertyId, ownerId }: { propertyId?: string; ownerId?: string }) {
  const { can } = useAuth();
  const [title, setTitle] = useState('');
  const [docType, setDocType] = useState(DOC_TYPES[0]);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const eq = propertyId ? { property_id: propertyId } : { owner_id: ownerId };
  const { data, loading, reload } = useQuery(() => listRows('property_documents', { eq, order: { column: 'created_at' } }), [propertyId, ownerId]);

  async function upload() {
    if (!file) return;
    const problem = validateFile(file, 'document');
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    const path = storagePath(propertyId ? `biens/${propertyId}` : `proprietaires/${ownerId}`, file.type);
    try {
      const { error: e1 } = await supabase.storage.from(DOCS_BUCKET).upload(path, file, { contentType: file.type, ...PRIVATE_UPLOAD_OPTIONS });
      if (e1) throw e1;
      const { error: e2 } = await supabase.from('property_documents').insert({
        property_id: propertyId ?? null, owner_id: ownerId ?? null, title: title.trim() || docType, doc_type: docType,
        storage_path: path, mime_type: file.type, file_size: file.size,
      });
      if (e2) {
        await supabase.storage.from(DOCS_BUCKET).remove([path]);
        throw e2;
      }
      setTitle('');
      setFile(null);
      reload();
    } catch (e) {
      setError(humanError(e));
    } finally {
      setBusy(false);
    }
  }

  async function open(doc: { id: string; storage_path: string; title: string }) {
    setError(null);
    try {
      await logEvent('consultation_document', 'property_documents', doc.title, doc.id);
      await openPrivateFile(DOCS_BUCKET, doc.storage_path);
    } catch (e) {
      setError(humanError(e));
    }
  }

  /** Suppression (administrateur) : la ligne puis le fichier. Tracée par la base. */
  async function remove(doc: { id: string; storage_path: string; title: string }) {
    if (!window.confirm(`Supprimer définitivement « ${doc.title} » ?`)) return;
    setError(null);
    try {
      const { error: e1 } = await supabase.from('property_documents').delete().eq('id', doc.id);
      if (e1) throw e1;
      const { error: e2 } = await supabase.storage.from(DOCS_BUCKET).remove([doc.storage_path]);
      if (e2) throw e2;
      reload();
    } catch (e) {
      setError(humanError(e));
    }
  }

  return (
    <Section title="Documents confidentiels">
      <p className="mb-3 text-xs text-ink-500">
        Stockage privé. L’enregistrement d’un document ne vaut pas vérification foncière : mettez à jour le statut de vérification après contrôle réel.
      </p>
      {loading ? <Spinner /> : data?.rows.length ? (
        <ul className="mb-4 divide-y divide-ink-100 text-sm">
          {data.rows.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <div className="truncate font-medium">{d.title}</div>
                <div className="text-xs text-ink-500">{d.doc_type} · {formatDateTime(d.created_at)}</div>
              </div>
              <span className="flex gap-1">
                <button className="btn-outline btn-sm" onClick={() => void open(d as never)}>Ouvrir</button>
                {can.admin && <button className="btn-ghost btn-sm text-red-700" onClick={() => void remove(d as never)}>Supprimer</button>}
              </span>
            </li>
          ))}
        </ul>
      ) : <p className="mb-4 text-sm text-ink-500">Aucun document.</p>}
      <div className="grid gap-2 sm:grid-cols-3">
        <select className="input" aria-label="Type de document" value={docType} onChange={(e) => setDocType(e.target.value)}>
          {DOC_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
        <input className="input" placeholder="Intitulé (facultatif)" aria-label="Intitulé" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
        <input className="input" type="file" aria-label="Fichier" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </div>
      <ErrorBox error={error} />
      <button className="btn-primary btn-sm mt-2" disabled={!file || busy} onClick={() => void upload()}>{busy ? 'Envoi…' : 'Ajouter le document'}</button>
    </Section>
  );
}
