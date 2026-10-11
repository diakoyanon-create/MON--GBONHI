import { useState, type FormEvent } from 'react';
import { submitInquiry } from '@/api/publicApi';
import { usePublicAgency } from '@/api/hooks';
import { inquirySchema, firstErrors } from '@/domain/validation';
import { CONTACT_PREF } from '@/domain/labels';
import { ErrorBox, SuccessBox } from './ui';
import { Link } from 'react-router-dom';

type Props = { propertyReference?: string; compact?: boolean };

type Draft = { full_name: string; phone: string; email: string; property_reference: string; message: string; contact_preference: string; consent: boolean; website: string };
const DRAFT_FIELDS = ['full_name', 'phone', 'email', 'property_reference', 'message', 'contact_preference'] as const;
const draftKey = (ref?: string) => `inq-draft-${ref ?? 'general'}`;

/** Brouillon conservé dans l'onglet (rechargement, connexion instable). Jamais le consentement. */
function loadDraft(ref?: string): Partial<Draft> {
  try {
    const raw = sessionStorage.getItem(draftKey(ref));
    if (!raw) return {};
    const d = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(DRAFT_FIELDS.filter((k) => typeof d[k] === 'string').map((k) => [k, d[k]])) as Partial<Draft>;
  } catch {
    return {};
  }
}
function saveDraft(ref: string | undefined, v: Draft) {
  try {
    sessionStorage.setItem(draftKey(ref), JSON.stringify(Object.fromEntries(DRAFT_FIELDS.map((k) => [k, v[k]]))));
  } catch {
    /* stockage indisponible : sans conséquence */
  }
}
function clearDraft(ref?: string) {
  try {
    sessionStorage.removeItem(draftKey(ref));
  } catch {
    /* ignoré */
  }
}

/** Formulaire public de demande. Envoi via submit_inquiry() : validé, limité, champ piège anti-robot. */
export function InquiryForm({ propertyReference, compact }: Props) {
  const { data: agency } = usePublicAgency();
  const [v, setV] = useState<Draft>(() => ({
    full_name: '', phone: '', email: '', property_reference: propertyReference ?? '', message: propertyReference ? `Bonjour, je suis intéressé(e) par le bien ${propertyReference}.` : '',
    contact_preference: 'whatsapp', consent: false, website: '',
    ...loadDraft(propertyReference),
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Draft, val: unknown) =>
    setV((p) => {
      const next = { ...p, [k]: val } as Draft;
      saveDraft(propertyReference, next);
      return next;
    });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setServerError(null);
    const parsed = inquirySchema.safeParse(v);
    if (!parsed.success) {
      const errs = firstErrors(parsed.error);
      setErrors(errs);
      // Amène l'utilisateur (et le lecteur d'écran) au premier champ à corriger.
      const order = ['full_name', 'phone', 'email', 'property_reference', 'message', 'consent'];
      const first = order.find((k) => errs[k]);
      requestAnimationFrame(() => {
        const el = document.getElementById(`inq-${first}`);
        if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el?.focus({ preventScroll: true });
      });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const res = await submitInquiry({ ...parsed.data, consent: true });
      clearDraft(propertyReference);
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

  const field = (k: 'full_name' | 'phone' | 'email' | 'property_reference', lbl: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label htmlFor={`inq-${k}`} className="label">{lbl}</label>
      <input id={`inq-${k}`} className="input scroll-mt-24" value={String(v[k])} onChange={(e) => set(k, e.target.value)} aria-invalid={errors[k] ? true : undefined} aria-describedby={errors[k] ? `inq-${k}-err` : undefined} {...props} />
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
        <textarea id="inq-message" className="input min-h-28 scroll-mt-24" maxLength={2000} value={v.message} onChange={(e) => set('message', e.target.value)} aria-invalid={errors.message ? true : undefined} aria-describedby={errors.message ? 'inq-message-err' : undefined} />
        {errors.message && <p id="inq-message-err" className="mt-1 text-xs text-red-700">{errors.message}</p>}
      </div>
      <fieldset>
        <legend className="label">Comment préférez-vous être contacté(e) ?</legend>
        <div className="flex flex-wrap gap-2">
          {Object.entries(CONTACT_PREF).map(([value, l]) => (
            <label key={value} className={`badge min-h-10 cursor-pointer border px-3 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-gold-700 ${v.contact_preference === value ? 'border-gold-500 bg-gold-300/40' : 'border-ink-200 bg-white'}`}>
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
          <input id="inq-consent" type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 scroll-mt-24 accent-gold-600" checked={v.consent} onChange={(e) => set('consent', e.target.checked)} aria-invalid={errors.consent ? true : undefined} aria-describedby={errors.consent ? 'inq-consent-err' : undefined} />
          <span>
            {agency?.inquiry_consent_text ?? 'J’accepte que l’agence utilise ces informations pour répondre à ma demande.'}{' '}
            {/* Nouvel onglet : la saisie en cours n'est pas perdue. */}
            <Link to="/confidentialite" target="_blank" rel="noopener noreferrer" className="underline">En savoir plus (nouvel onglet)</Link>
          </span>
        </label>
        {errors.consent && <p id="inq-consent-err" className="mt-1 text-xs text-red-700">{errors.consent}</p>}
      </div>
      {Object.keys(errors).length > 0 && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {Object.keys(errors).length === 1 ? 'Un champ est à corriger.' : `${Object.keys(errors).length} champs sont à corriger.`}
        </p>
      )}
      <ErrorBox error={serverError} />
      <button className="btn-gold w-full sm:w-auto" disabled={busy}>{busy ? 'Envoi…' : 'Envoyer ma demande'}</button>
    </form>
  );
}
