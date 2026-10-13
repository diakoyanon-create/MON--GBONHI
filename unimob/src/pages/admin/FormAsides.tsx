import { COMMISSION_DISCLAIMER, estimateCommission, type CommissionCalc } from '@/domain/commission';
import { formatXOF } from '@/lib/format';
import type { FormValues } from '@/resources/values';

const num = (v: unknown) => (v === '' || v === null || v === undefined ? null : Number(String(v).replace(/\s/g, '')));

/** Aperçu de la commission convenue dans le formulaire de mandat. */
export function MandateAside(v: FormValues) {
  if (!v.commission_calc) return null;
  return (
    <p className="rounded-lg bg-cream-200 px-3 py-2 text-xs text-ink-700">
      {v.commission_calc === 'pourcentage' && v.commission_rate_percent
        ? `Exemple : pour une vente à 50 000 000 FCFA, ${formatXOF(estimateCommission(50_000_000, 'pourcentage', num(v.commission_rate_percent)))}. `
        : null}
      {COMMISSION_DISCLAIMER}
    </p>
  );
}

/** Rappels métier dans le formulaire de transaction. */
export function TransactionAside(v: FormValues) {
  const base = num(v.agreed_price) ?? num(v.initial_asking_price);
  return (
    <div className="space-y-2 text-xs">
      {v.status === 'vente_conclue' && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">
          « Vente conclue » retire le bien du site, clôture le mandat actif et crée la commission exigible (montant convenu). Prix convenu et date de conclusion obligatoires.
        </p>
      )}
      {v.status === 'offre_acceptee_sous_conditions' && <p className="rounded-lg bg-cream-200 px-3 py-2">Une offre acceptée ne signifie pas que la vente est conclue.</p>}
      {base && v.commission_agreed === '' && (
        <p className="text-ink-500">Base de calcul : {formatXOF(base)}. Exemple à 5 % : {formatXOF(estimateCommission(base, 'pourcentage' as CommissionCalc, 5))} (indicatif).</p>
      )}
    </div>
  );
}
