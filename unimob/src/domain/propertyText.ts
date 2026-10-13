import { PROPERTY_TYPES, label } from './labels';
import { formatXOF } from '../lib/format'; // chemin relatif : aussi utilisé par les Pages Functions

type P = { property_type: string; title: string; reference: string; price_xof: string | number | null; district?: string | null; city: string; region?: string | null; is_demo?: boolean };

/** Description courte d'un bien (méta-description, aperçus WhatsApp/Facebook). */
export function propertyDescription(p: P): string {
  const where = [p.district, p.city].filter(Boolean).join(', ');
  const price = p.price_xof !== null && p.price_xof !== undefined && p.price_xof !== '' ? ` : ${formatXOF(p.price_xof)}` : '';
  const demo = p.is_demo ? ' Exemple fictif, non disponible.' : '';
  return `${label(PROPERTY_TYPES, p.property_type)} à vendre à ${where}${price}. Réf. ${p.reference}.${demo}`;
}
