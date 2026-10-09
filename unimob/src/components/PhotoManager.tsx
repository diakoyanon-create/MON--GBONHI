import { useRef, useState } from 'react';
import { listRows, updateRow } from '@/api/crud';
import { useQuery } from '@/api/hooks';
import { compressImage, storagePath, validateFile } from '@/domain/files';
import { photoUrl } from '@/lib/photos';
import { PHOTO_BUCKET, supabase } from '@/lib/supabase';
import { ErrorBox, Section, Spinner, humanError } from './ui';

/** Galerie : ajout depuis la galerie ou l'appareil photo, photo principale, ordre, suppression. */
export function PhotoManager({ propertyId, editable, onChange }: { propertyId: string; editable: boolean; onChange?: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const { data, loading, reload } = useQuery(
    () => listRows('property_photos', { eq: { property_id: propertyId }, order: { column: 'position', ascending: true }, pageSize: 100 }),
    [propertyId],
  );
  const photos = data?.rows ?? [];
  const refresh = () => {
    reload();
    onChange?.();
  };

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    const list = Array.from(files);
    let position = photos.length ? Math.max(...photos.map((p) => p.position)) + 1 : 0;
    for (const [i, original] of list.entries()) {
      setProgress(`Envoi ${i + 1} / ${list.length}…`);
      const file = await compressImage(original);
      const problem = validateFile(file, 'photo');
      if (problem) {
        setError(`${original.name} : ${problem}`);
        continue;
      }
      const path = storagePath(propertyId, file.type);
      const { error: upErr } = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) {
        setError(`${original.name} : ${humanError(upErr)}`);
        continue;
      }
      const { error: dbErr } = await supabase.from('property_photos').insert({ property_id: propertyId, storage_path: path, position: position++ });
      if (dbErr) {
        await supabase.storage.from(PHOTO_BUCKET).remove([path]);
        setError(humanError(dbErr));
      }
    }
    setProgress(null);
    if (input.current) input.current.value = '';
    refresh();
  }

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      refresh();
    } catch (e) {
      setError(humanError(e));
    }
  }

  const move = (idx: number, dir: -1 | 1) =>
    act(async () => {
      const a = photos[idx];
      const b = photos[idx + dir];
      if (!a || !b) return;
      await updateRow('property_photos', a.id, { position: b.position === a.position ? a.position + dir : b.position });
      await updateRow('property_photos', b.id, { position: a.position });
    });

  const remove = (photo: (typeof photos)[number]) =>
    act(async () => {
      if (!window.confirm('Supprimer cette photo ?')) return;
      const { error: e1 } = await supabase.from('property_photos').delete().eq('id', photo.id);
      if (e1) throw e1;
      if (!photo.storage_path.startsWith('demo/')) await supabase.storage.from(PHOTO_BUCKET).remove([photo.storage_path]);
    });

  return (
    <Section
      title={`Photos (${photos.length})`}
      actions={
        editable && (
          <>
            <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" id="photo-upload" onChange={(e) => void upload(e.target.files)} />
            <label htmlFor="photo-upload" className="btn-outline btn-sm cursor-pointer">+ Ajouter des photos</label>
          </>
        )
      }
    >
      <p className="mb-3 text-xs text-ink-500">Les photos sont publiques une fois l’annonce publiée. Formats JPEG, PNG, WebP — 5 Mo max. (réduites automatiquement).</p>
      {progress && <Spinner label={progress} />}
      <ErrorBox error={error} />
      {loading ? <Spinner /> : photos.length === 0 ? <p className="text-sm text-ink-500">Aucune photo.</p> : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((ph, i) => (
            <li key={ph.id} className="overflow-hidden rounded-lg border border-ink-100 bg-white">
              <div className="relative aspect-[4/3] bg-cream-200">
                <img src={photoUrl(ph.storage_path) ?? ''} alt={ph.caption ?? `Photo ${i + 1}`} loading="lazy" className="h-full w-full object-cover" />
                {ph.is_primary && <span className="badge absolute top-1.5 left-1.5 bg-gold-500 text-ink-950">Principale</span>}
              </div>
              {editable && (
                <div className="flex flex-wrap gap-1 p-1.5">
                  {!ph.is_primary && <button className="btn-ghost btn-sm" onClick={() => void act(() => updateRow('property_photos', ph.id, { is_primary: true }))}>★ Principale</button>}
                  <button className="btn-ghost btn-sm" aria-label="Déplacer avant" disabled={i === 0} onClick={() => void move(i, -1)}>←</button>
                  <button className="btn-ghost btn-sm" aria-label="Déplacer après" disabled={i === photos.length - 1} onClick={() => void move(i, 1)}>→</button>
                  <button className="btn-ghost btn-sm text-red-700" onClick={() => void remove(ph)}>Suppr.</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
