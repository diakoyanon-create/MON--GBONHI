import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { label as labelOf, statusTone } from '@/domain/labels';

export function Spinner({ label = 'Chargement…' }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-ink-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink-200 border-t-gold-500" aria-hidden />
      {label}
    </span>
  );
}

const TONES = {
  neutral: 'bg-ink-100 text-ink-700',
  info: 'bg-sky-100 text-sky-800',
  success: 'bg-emerald-100 text-emerald-800',
  warning: 'bg-amber-100 text-amber-800',
  danger: 'bg-red-100 text-red-800',
  gold: 'bg-gold-300/50 text-gold-700',
} as const;

export function Badge({ tone = 'neutral', children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return <span className={`badge ${TONES[tone]}`}>{children}</span>;
}

export function StatusBadge({ value, map }: { value: string | null | undefined; map: Record<string, string> }) {
  if (!value) return <span className="text-ink-300">—</span>;
  return <Badge tone={statusTone(value)}>{labelOf(map, value)}</Badge>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="font-display text-2xl text-ink-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-ink-200 p-8 text-center text-sm text-ink-500">{children}</div>;
}

export function ErrorBox({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      {error}
    </div>
  );
}

export function SuccessBox({ children }: { children: ReactNode }) {
  return <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{children}</div>;
}

export function Modal({ open, title, onClose, children, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    } else if (!open && d.open) {
      if (typeof d.close === 'function') d.close();
      else d.removeAttribute('open');
    }
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      className={`m-auto w-[calc(100%-1.5rem)] ${wide ? 'max-w-3xl' : 'max-w-lg'} rounded-xl p-0 shadow-xl backdrop:bg-ink-950/50`}
      aria-label={title}
    >
      {open && (
        <div className="max-h-[85vh] overflow-y-auto p-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button className="btn-ghost btn-sm" onClick={onClose} aria-label="Fermer">✕</button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

export function Stat({ label, value, hint, to }: { label: string; value: ReactNode; hint?: ReactNode; to?: string }) {
  const body = (
    <>
      <div className="text-xs font-medium tracking-wide text-ink-500 uppercase">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-ink-900 tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-500">{hint}</div>}
    </>
  );
  return to ? (
    <Link to={to} className="card block p-4 transition-colors hover:border-gold-300">{body}</Link>
  ) : (
    <div className="card p-4">{body}</div>
  );
}

export function DefinitionList({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs font-medium text-ink-500">{k}</dt>
          <dd className="mt-0.5 text-sm break-words text-ink-900">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="card p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-semibold text-ink-900">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Traduit les erreurs PostgREST/PostgreSQL en message lisible. */
export function humanError(err: unknown): string {
  const e = err as { message?: string; code?: string; details?: string } | null;
  const msg = e?.message ?? String(err ?? 'Erreur inconnue');
  if (e?.code === '23505' || /duplicate key/.test(msg)) return 'Cette référence ou cette valeur existe déjà.';
  if (/row-level security|permission denied/.test(msg)) return 'Action non autorisée pour votre rôle.';
  if (e?.code === '23503' || /foreign key/.test(msg)) return "Impossible : cet élément est lié à d'autres dossiers. Archivez-le plutôt.";
  if (e?.code === '23514' && /check constraint/.test(msg)) return 'Certaines valeurs ne respectent pas les règles (montants, dates ou champs obligatoires).';
  if (e?.code === 'PGRST103') return 'Cette page n’existe plus : revenez à la première page.';
  if (/JWT expired|invalid JWT|refresh_token/i.test(msg)) return 'Votre session a expiré : reconnectez-vous.';
  if (/Failed to fetch|NetworkError|Load failed/.test(msg)) return 'Connexion réseau indisponible. Vos saisies sont conservées, réessayez.';
  // Les autres messages (règles métier de la base) sont rédigés en français pour l'utilisateur.
  return msg;
}
