// Libellés français des valeurs stockées en base (énumérations PostgreSQL).

export type Option = { value: string; label: string };
const toOptions = (m: Record<string, string>): Option[] => Object.entries(m).map(([value, label]) => ({ value, label }));

export const PROPERTY_TYPES: Record<string, string> = {
  terrain: 'Terrain', maison: 'Maison', appartement: 'Appartement', immeuble: 'Immeuble',
  local_commercial: 'Local commercial', autre: 'Autre',
};
export const PROPERTY_STATUS: Record<string, string> = {
  brouillon: 'Brouillon', a_verifier: 'À vérifier', disponible: 'Disponible', publie: 'Publié',
  sous_negociation: 'Sous négociation', reserve: 'Réservé', vendu: 'Vendu', retire: 'Retiré', archive: 'Archivé',
};
/** Libellé affiché au public (jamais « Publié »). */
export const PUBLIC_STATUS: Record<string, string> = {
  publie: 'Disponible', sous_negociation: 'Sous offre', reserve: 'Réservé',
};
export const PUBLIC_STATUSES = ['publie', 'sous_negociation', 'reserve'];
export const VERIFICATION_STATUS: Record<string, string> = {
  a_verifier: 'À vérifier', en_cours: 'Vérification en cours', verifie: 'Vérifié', non_conforme: 'Non conforme',
};
export const AREA_UNITS: Record<string, string> = { m2: 'm²', ha: 'ha', lot: 'lot' };
export const CONTACT_PREF: Record<string, string> = { telephone: 'Téléphone', whatsapp: 'WhatsApp', email: 'Courriel', sms: 'SMS' };
export const BUYER_STATUS: Record<string, string> = {
  nouveau: 'Nouveau', a_contacter: 'À contacter', contact_etabli: 'Contact établi', besoin_qualifie: 'Besoin qualifié',
  visite_programmee: 'Visite programmée', en_negociation: 'En négociation', converti: 'Converti en acheteur',
  sans_suite: 'Sans suite', archive: 'Archivé',
};
export const MANDATE_TYPES: Record<string, string> = { simple: 'Simple', exclusif: 'Exclusif', semi_exclusif: 'Semi-exclusif', autre: 'Autre' };
export const MANDATE_STATUS: Record<string, string> = {
  brouillon: 'Brouillon', en_attente_signature: 'En attente de signature', actif: 'Actif', expire: 'Expiré', resilie: 'Résilié', cloture: 'Clôturé',
};
export const COMMISSION_CALC: Record<string, string> = { fixe: 'Montant fixe', pourcentage: 'Pourcentage', autre: 'Autre modalité' };
export const INQUIRY_STATUS: Record<string, string> = {
  nouveau: 'Nouveau', en_cours: 'En cours', traite: 'Traité', converti: 'Converti en prospect', sans_suite: 'Sans suite', spam: 'Indésirable',
};
export const INQUIRY_SOURCE: Record<string, string> = { site_web: 'Site web', whatsapp: 'WhatsApp', telephone: 'Téléphone', autre: 'Autre' };
export const CHANNELS: Record<string, string> = {
  appel: 'Appel', whatsapp: 'WhatsApp', email: 'Courriel', sms: 'SMS', rencontre: 'Rencontre', visite: 'Visite', autre: 'Autre',
};
export const VISIT_STATUS: Record<string, string> = {
  a_confirmer: 'À confirmer', confirmee: 'Confirmée', effectuee: 'Effectuée', reportee: 'Reportée', annulee: 'Annulée', sans_suite: 'Sans suite',
};
export const TRANSACTION_STATUS: Record<string, string> = {
  negociation: 'Négociation', offre_en_attente: 'Offre en attente', offre_acceptee_sous_conditions: 'Offre acceptée sous conditions',
  dossier_en_cours: 'Dossier en cours', vente_conclue: 'Vente conclue', annulee: 'Annulée', abandonnee: 'Abandonnée',
};
export const OPEN_TRANSACTION_STATUSES = ['negociation', 'offre_en_attente', 'offre_acceptee_sous_conditions', 'dossier_en_cours'];
export const OFFER_STATUS: Record<string, string> = { en_attente: 'En attente', acceptee: 'Acceptée', refusee: 'Refusée', expiree: 'Expirée', retiree: 'Retirée' };
export const PAYMENT_METHODS: Record<string, string> = {
  especes: 'Espèces', virement: 'Virement', mobile_money: 'Mobile Money', cheque: 'Chèque', autre: 'Autre',
};
export const REVENUE_TYPES: Record<string, string> = { commission: 'Commission', honoraires: 'Honoraires', frais_dossier: 'Frais de dossier', autre: 'Autre' };
export const REVENUE_STATUS: Record<string, string> = { prevu: 'Prévu', exigible: 'Exigible', partiel: 'Partiellement encaissé', encaisse: 'Encaissé', annule: 'Annulé' };
export const TASK_PRIORITY: Record<string, string> = { basse: 'Basse', normale: 'Normale', haute: 'Haute', urgente: 'Urgente' };
export const TASK_STATUS: Record<string, string> = { a_faire: 'À faire', en_cours: 'En cours', terminee: 'Terminée', reportee: 'Reportée', annulee: 'Annulée' };
export const ROLES: Record<string, string> = { admin: 'Administrateur', agent: 'Agent', assistant: 'Assistant', comptable: 'Comptable' };

export const options = {
  propertyTypes: toOptions(PROPERTY_TYPES), propertyStatus: toOptions(PROPERTY_STATUS),
  verification: toOptions(VERIFICATION_STATUS), areaUnits: toOptions(AREA_UNITS), contactPref: toOptions(CONTACT_PREF),
  buyerStatus: toOptions(BUYER_STATUS), mandateTypes: toOptions(MANDATE_TYPES), mandateStatus: toOptions(MANDATE_STATUS),
  commissionCalc: toOptions(COMMISSION_CALC), inquiryStatus: toOptions(INQUIRY_STATUS), inquirySource: toOptions(INQUIRY_SOURCE),
  channels: toOptions(CHANNELS), visitStatus: toOptions(VISIT_STATUS), transactionStatus: toOptions(TRANSACTION_STATUS),
  offerStatus: toOptions(OFFER_STATUS), paymentMethods: toOptions(PAYMENT_METHODS), revenueTypes: toOptions(REVENUE_TYPES),
  revenueStatus: toOptions(REVENUE_STATUS), taskPriority: toOptions(TASK_PRIORITY), taskStatus: toOptions(TASK_STATUS),
  roles: toOptions(ROLES),
};

/** Couleur de badge par statut (classes Tailwind). */
export function statusTone(status: string | null | undefined): 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'gold' {
  switch (status) {
    case 'publie': case 'actif': case 'verifie': case 'confirmee': case 'effectuee': case 'encaisse': case 'terminee':
    case 'vente_conclue': case 'converti': case 'traite': case 'acceptee':
      return 'success';
    case 'disponible': case 'contact_etabli': case 'besoin_qualifie': case 'en_cours': case 'exigible': case 'dossier_en_cours':
      return 'info';
    case 'a_verifier': case 'a_confirmer': case 'en_attente_signature': case 'partiel': case 'offre_en_attente': case 'reportee':
    case 'nouveau': case 'a_contacter': case 'a_faire': case 'en_attente': case 'sous_negociation': case 'negociation':
    case 'offre_acceptee_sous_conditions':
      return 'warning';
    case 'vendu': case 'reserve': case 'visite_programmee': case 'en_negociation':
      return 'gold';
    case 'non_conforme': case 'annulee': case 'abandonnee': case 'resilie': case 'spam': case 'refusee': case 'annule':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function label(map: Record<string, string>, value: string | null | undefined): string {
  if (!value) return '—';
  return map[value] ?? value;
}
