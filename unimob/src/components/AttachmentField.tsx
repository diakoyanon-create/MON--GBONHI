import { useState } from 'react';
import { updateRow } from '@/api/crud';
import { storagePath, validateFile } from '@/domain/files';
import { openPrivateFile, PRIVATE_UPLOAD_OPTIONS } from '@/lib/photos';
import { supabase } from '@/lib/supabase';
import { ErrorBox, Section, SuccessBox, humanError } from './ui';

type Props = {
  table: string;
  id: string;
  bucket: 'private-documents' | 'finance-receipts';
  column: string;
  label: string;
  folder: string;
  currentPath: string | null;
  editable: boolean;
  onSaved: () => void;
};

/** Pièce jointe privée (justificatif de dépense, mandat signé…), ouverte sans lien réutilisable. */
export function AttachmentField({ table, id, bucket, column, label, folder, currentPath, editable, onSaved }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function upload() {
    if (!file) return;
    const problem = validateFile(file, bucket === 'finance-receipts' ? 'receipt' : 'document');
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    setOk(false);
    try {
      const path = storagePath(`${folder}/${id}`, file.type);
      const { error: upErr } = await supabase.storage.from(bucket).upload(path, file, { contentType: file.type, ...PRIVATE_UPLOAD_OPTIONS });
      if (upErr) throw upErr;
      await updateRow(table, id, { [column]: path });
      setFile(null);
      setOk(true);
      onSaved();
    } catch (e) {
      setError(humanError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={label}>
      {currentPath ? (
        <button className="btn-outline btn-sm" onClick={() => openPrivateFile(bucket, currentPath).catch((e) => setError(humanError(e)))}>Ouvrir le fichier joint</button>
      ) : (
        <p className="text-sm text-ink-500">Aucun fichier joint.</p>
      )}
      {editable && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input className="input" type="file" aria-label={label} accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <button className="btn-primary btn-sm" disabled={!file || busy} onClick={() => void upload()}>{busy ? 'Envoi…' : currentPath ? 'Remplacer' : 'Joindre'}</button>
        </div>
      )}
      <p className="mt-2 text-xs text-ink-500">Stockage privé. PDF ou image, {bucket === 'finance-receipts' ? '10' : '15'} Mo maximum.</p>
      <ErrorBox error={error} />
      {ok && <SuccessBox>Fichier enregistré.</SuccessBox>}
    </Section>
  );
}
