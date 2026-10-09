import { useState, type FormEvent } from 'react';
import { submitInquiry } from '@/api/publicApi';
import { usePublicAgency } from '@/api/hooks';
import { inquirySchema, firstErrors } from '@/domain/validation';
import { CONTACT_PREF } from '@/domain/labels';
import { ErrorBox, SuccessBox } from './ui';
import { Link } from 'react-router-dom';

type Props = { propertyReference?: string; compact?: boolean };

/** Formulaire public de demande. Envoi via submit_inquiry() : validé, limité, champ piège anti-robot. */
export function InquiryForm({ propertyReference, compact }: Props) {
  const { data: agency } = usePublicAgency();
  const [v, setV] = useState({
    full_name: '', phone: '', email: '', property_reference: propertyReference ?? '', message: propertyReference ? `Bonjour, je suis intéressé(e) par le bien ${propertyReference}.` : '',
    contact_preference: 'whatsapp', consent: false, website: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, val: unknown) => setV((p) => ({ ...p, [k]: val }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setServerError(null);
    const parsed = inquirySchema.safeParse(v);
    if (!parsed.success) {
      setErrors(firstErrors(parsed.error));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const res = await submitInquiry({ ...parsed.data, consent: true });
      setDone(res.reference ?? 'ok');
    } catch (err) {
      const msg = (err as { message?: string }).message ?? '';
      // Les messages de validation du serveur sont rédigés pour le public ; le reste est masqué.
      setServerError(/invalide|Trop de demandes|consentement|caractères/i.test(msg) ? msg : 'L’envoi a échoué. Vérifiez votre connexion puis réessayez : votre saisie est conservée.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <SuccessBox>
        Merci, votre demande a bien été envoyée{done !== 'ok' ? ` (n° ${done})` : ''}. Nous vous recontacterons rapidement selon votre préférence.
      </SuccessBox>
    );
  }

  const field = (k: keyof typeof v, lbl: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label htmlFor={`inq-${k}`} className="label">{lbl}</label>
      <input id={`inq-${k}`} className="input" value={String(v[k])} onChange={(e) => set(k, e.target.value)} aria-invalid={errors[k] ? true : undefined} aria-describedby={errors[k] ? `inq-${k}-err` : undefined} {...props} />
      {errors[k] && <p id={`inq-${k}-err`} className="mt-1 text-xs text-red-700">{errors[k]}</p>}
    </div>
  );

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className={`grid gap-4 ${compact ? '' : 'sm:grid-cols-2'}`}>
        {field('full_name', 'Nom complet *', { autoComplete: 'name', maxLength: 120 })}
        {field('phone', 'Téléphone *', { type: 'tel', autoComplete: 'tel', inputMode: 'tel', placeholder: '+225 …' })}
        {field('email', 'Courriel (facultatif)', { type: 'email', autoComplete: 'email' })}
        {!propertyReference && field('property_reference', 'Référence du bien (facultatif)', { placeholder: 'BIEN-2026-00001' })}
      </div>
      <div>
        <label htmlFor="inq-message" className="label">Message *</label>
        <textarea id="inq-message" className="input min-h-28" maxLength={2000} value={v.message} onChange={(e) => set('message', e.target.value)} aria-invalid={errors.message ? true : undefined} />
        {errors.message && <p className="mt-1 text-xs text-red-700">{errors.message}</p>}
      </div>
      <fieldset>
        <legend className="label">Comment préférez-vous être contacté(e) ?</legend>
        <div className="flex flex-wrap gap-2">
          {Object.entries(CONTACT_PREF).map(([value, l]) => (
            <label key={value} className={`badge min-h-10 cursor-pointer border px-3 text-sm ${v.contact_preference === value ? 'border-gold-500 bg-gold-300/40' : 'border-ink-200 bg-white'}`}>
              <input type="radio" name="contact_preference" value={value} className="sr-only" checked={v.contact_preference === value} onChange={() => set('contact_preference', value)} />
              {l}
            </label>
          ))}
        </div>
      </fieldset>
      {/* Champ piège : invisible pour les humains, rempli par les robots. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="inq-website">Site web</label>
        <input id="inq-website" tabIndex={-1} autoComplete="off" value={v.website} onChange={(e) => set('website', e.target.value)} />
      </div>
      <div>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-gold-600" checked={v.consent} onChange={(e) => set('consent', e.target.checked)} />
          <span>
            {agency?.inquiry_consent_text ?? 'J’accepte que l’agence utilise ces informations pour répondre à ma demande.'}{' '}
            <Link to="/confidentialite" className="underline">En savoir plus</Link>
          </span>
        </label>
        {errors.consent && <p className="mt-1 text-xs text-red-700">{errors.consent}</p>}
      </div>
      <ErrorBox error={serverError} />
      <button className="btn-gold w-full sm:w-auto" disabled={busy}>{busy ? 'Envoi…' : 'Envoyer ma demande'}</button>
    </form>
  );
}
