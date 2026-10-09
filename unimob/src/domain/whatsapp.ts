export const GENERIC_WHATSAPP_MESSAGE = 'Bonjour, je vous contacte depuis votre site.';

/** Construit un lien wa.me avec message prérempli. Renvoie null si le numéro n'est pas configuré. */
export function whatsappLink(number: string | null | undefined, template: string | null | undefined, reference?: string | null): string | null {
  const digits = (number ?? '').replace(/\D/g, '');
  if (digits.length < 8) return null;
  const text = reference && template ? template.replace(/\{reference\}/g, reference) : GENERIC_WHATSAPP_MESSAGE;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text.trim())}`;
}
