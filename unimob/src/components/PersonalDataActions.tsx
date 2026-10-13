import { useState } from 'react';
import { rpc, updateRow } from '@/api/crud';
import { useAuth } from '@/auth/AuthContext';
import { ErrorBox, Section, humanError } from './ui';

type Props = {
  kind: 'owner' | 'buyer';
  id: string;
  archivedAt?: string | null;
  anonymized: boolean;
  onDone: () => void;
};

/**
 * Archivage (propriétaires) et anonymisation (droit à l'effacement) — l'anonymisation conserve
 * références, montants et historique des statuts, mais efface nom, coordonnées et textes libres.
 */
export function PersonalDataActions({ kind, id, archivedAt, anonymized, onDone }: Props) {
  const { can } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!can.sales) return null;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onDone();
    } catch (e) {
      setError(humanError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Archivage et données personnelles">
      <div className="flex flex-wrap gap-2">
        {kind === 'owner' && (
          <button
            className="btn-outline btn-sm"
            disabled={busy || anonymized}
            onClick={() => void run(() => updateRow('owners', id, { archived_at: archivedAt ? null : new Date().toISOString() }))}
          >
            {archivedAt ? 'Désarchiver' : 'Archiver'}
          </button>
        )}
        {can.admin && !anonymized && (
          <button
            className="btn-danger btn-sm"
            disabled={busy}
            onClick={() => {
              if (!window.confirm('Anonymiser définitivement cette personne ? Nom, coordonnées, notes et textes des échanges seront effacés. Cette action est irréversible.')) return;
              void run(() => rpc(kind === 'owner' ? 'anonymize_owner' : 'anonymize_buyer', kind === 'owner' ? { p_owner_id: id } : { p_buyer_id: id }));
            }}
          >
            Anonymiser (droit à l’effacement)
          </button>
        )}
      </div>
      <p className="mt-2 text-xs text-ink-500">
        {kind === 'owner' ? 'Un propriétaire archivé est masqué des listes sans rien perdre. ' : 'Pour archiver un prospect, passez son statut à « Archivé ». '}
        L’anonymisation (administrateur) conserve les références et les montants pour la comptabilité. Supprimez aussi ses documents confidentiels si nécessaire.
      </p>
      <ErrorBox error={error} />
    </Section>
  );
}
