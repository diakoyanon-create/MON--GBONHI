// Contrôles des fichiers avant envoi (doublés par les limites du bucket côté serveur).

export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const DOC_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_DOC_BYTES = 15 * 1024 * 1024;
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

export function validateFile(file: { type: string; size: number; name: string }, kind: 'photo' | 'document' | 'receipt'): string | null {
  const types = kind === 'photo' ? PHOTO_TYPES : DOC_TYPES;
  const max = kind === 'photo' ? MAX_PHOTO_BYTES : kind === 'document' ? MAX_DOC_BYTES : MAX_RECEIPT_BYTES;
  if (!types.includes(file.type)) {
    return kind === 'photo' ? 'Format non accepté (JPEG, PNG ou WebP uniquement).' : 'Format non accepté (PDF, JPEG, PNG ou WebP).';
  }
  if (file.size > max) return `Fichier trop volumineux (maximum ${Math.round(max / 1024 / 1024)} Mo).`;
  if (file.size === 0) return 'Fichier vide.';
  return null;
}

export function extensionFor(mime: string): string {
  return ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' } as Record<string, string>)[mime] ?? 'bin';
}

/** Nom de fichier de stockage sûr : jamais le nom d'origine (peut contenir des données personnelles). */
export function storagePath(folder: string, mime: string, id: string = crypto.randomUUID()): string {
  const safeFolder = folder
    .split('/')
    .map((seg) => seg.replace(/[^a-zA-Z0-9_-]/g, ''))
    .filter(Boolean)
    .join('/');
  return `${safeFolder}/${id}.${extensionFor(mime)}`;
}

/**
 * Réduit une photo (max 1600 px, JPEG ~82 %) pour les connexions mobiles.
 * Retourne le fichier d'origine si le navigateur ne sait pas le faire.
 */
export async function compressImage(file: File, maxSize = 1600, quality = 0.82): Promise<File> {
  if (!file.type.startsWith('image/') || typeof createImageBitmap !== 'function') return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSize / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 600 * 1024) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' });
  } catch {
    return file;
  }
}
