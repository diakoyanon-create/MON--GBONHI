/**
 * Lit un montant saisi en FCFA. Accepte « 150000 », « 150 000 », « 150.000 », « 1.500.000 »,
 * « 1,500,000 » (séparateurs de milliers). Refuse les décimales et les formats ambigus
 * (« 150.5 », « 1.50.000 ») au lieu de diviser silencieusement par 1000.
 */
export function parseXOF(input: string | number | null | undefined): number {
  if (input === null || input === undefined) return Number.NaN;
  if (typeof input === 'number') return Number.isInteger(input) ? input : Number.NaN;
  const s = input.replace(/[\s\u00a0\u202f]/g, '').replace(/(F|FCFA|XOF)$/i, '');
  if (s === '') return Number.NaN;
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?\d{1,3}([.,]\d{3})+$/.test(s) && !/[.].*[,]|[,].*[.]/.test(s)) return Number(s.replace(/[.,]/g, ''));
  return Number.NaN;
}
