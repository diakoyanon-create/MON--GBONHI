// Miroir côté interface de public.estimate_commission() — utilisé pour l'aperçu en saisie.
// Les montants de référence restent ceux calculés en base.
export type CommissionCalc = 'fixe' | 'pourcentage' | 'autre';

export function estimateCommission(
  base: number | null | undefined,
  calc: CommissionCalc | null | undefined,
  ratePercent?: number | null,
  fixedAmount?: number | null,
  minAmount?: number | null,
): number | null {
  if (base === null || base === undefined || !calc) return null;
  if (calc === 'fixe') return fixedAmount ?? null;
  if (calc === 'pourcentage') {
    // Arrondi « half away from zero » comme PostgreSQL round(numeric).
    const raw = (base * (ratePercent ?? 0)) / 100;
    const rounded = Math.sign(raw) * Math.round(Math.abs(raw));
    return Math.max(rounded, minAmount ?? 0);
  }
  return null;
}

export const COMMISSION_DISCLAIMER =
  'Les taux et montants de commission sont configurés par l’agence. Ils ne constituent pas une obligation légale et doivent être vérifiés selon les accords applicables.';
