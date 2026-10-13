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
 * Réencode TOUJOURS la photo (max 1600 px, JPEG ~82 %) : réduit le poids pour les connexions
 * mobiles et supprime les métadonnées EXIF (dont la position GPS) avant publication.
 * Si le navigateur ne sait pas réencoder, l'envoi est refusé plutôt que de publier l'original.
 */
export async function compressImage(file: File, maxSize = 1600, quality = 0.82): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  if (typeof createImageBitmap !== 'function') {
    throw new Error('Votre navigateur ne permet pas de préparer la photo. Mettez-le à jour puis réessayez.');
  }
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error('Image illisible ou format non pris en charge.');
  }
  const scale = Math.min(1, maxSize / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Préparation de la photo impossible sur cet appareil.');
  ctx.fillStyle = '#ffffff'; // fond blanc pour les PNG transparents
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
  if (!blob) throw new Error('Préparation de la photo impossible sur cet appareil.');
  return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
}
