import { z } from 'zod';

// Schémas de validation côté interface (les contraintes définitives sont en base).

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9 .-]{6,19}$/, 'Numéro de téléphone invalide');

export const optionalEmail = z
  .string()
  .trim()
  .max(160)
  .refine((v) => v === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), 'Adresse électronique invalide')
  .transform((v) => (v === '' ? null : v.toLowerCase()));

export const inquirySchema = z.object({
  full_name: z.string().trim().min(2, 'Indiquez votre nom').max(120),
  phone: phoneSchema,
  email: optionalEmail,
  property_reference: z
    .string()
    .trim()
    .max(40)
    .refine((v) => v === '' || /^[A-Za-z0-9-]+$/.test(v), 'Référence invalide')
    .transform((v) => (v === '' ? null : v.toUpperCase())),
  message: z.string().trim().min(5, 'Votre message est trop court').max(2000, 'Message trop long (2000 caractères max.)'),
  contact_preference: z.enum(['telephone', 'whatsapp', 'email', 'sms']),
  consent: z.literal(true, { message: 'Votre accord est nécessaire pour traiter la demande' }),
  website: z.string().optional(), // champ piège
});
export type InquiryInput = z.input<typeof inquirySchema>;

export function firstErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const k = String(issue.path[0] ?? '_');
    out[k] ??= issue.message;
  }
  return out;
}
