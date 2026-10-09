import type { Row } from '@/api/crud';
import { listRows, rpc } from '@/api/crud';
import {
  AREA_UNITS, BUYER_STATUS, CHANNELS, CONTACT_PREF, MANDATE_STATUS, MANDATE_TYPES, OFFER_STATUS, PAYMENT_METHODS, PROPERTY_STATUS,
  PROPERTY_TYPES, REVENUE_STATUS, REVENUE_TYPES, TASK_PRIORITY, TASK_STATUS, TRANSACTION_STATUS, VERIFICATION_STATUS, VISIT_STATUS, label,
} from '@/domain/labels';
import { COMMISSION_DISCLAIMER } from '@/domain/commission';
import { formatDate, formatDateTime, formatNumber, formatXOF, fullName, todayISO } from '@/lib/format';
import { buildPdf, finishPdf, type PdfAgency } from '@/lib/pdf';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export async function propertySheetPdf(agency: PdfAgency, p: Row, mandates: Row[]) {
  const b = await buildPdf(agency, 'Fiche descriptive du bien', p.reference, false);
  b.heading(p.title);
  b.keyValues([
    ['Type', label(PROPERTY_TYPES, p.property_type)],
    ['Prix', `${formatXOF(p.price_xof)}${p.negotiable ? ' (négociable)' : ''}`],
    ['Localisation', [p.district, p.city, p.region].filter(Boolean).join(', ')],
    ['Superficie', p.area ? `${formatNumber(p.area, 2)} ${label(AREA_UNITS, p.area_unit)}` : '—'],
    ['Chambres / salles d’eau', `${p.bedrooms ?? '—'} / ${p.bathrooms ?? '—'}`],
    ['Caractéristiques', (p.features ?? []).join(', ') || '—'],
    ['Statut commercial', label(PROPERTY_STATUS, p.commercial_status)],
    ['Vérification', label(VERIFICATION_STATUS, p.verification_status)],
    ['Mandat', mandates.find((m) => m.status === 'actif')?.reference ?? 'Aucun mandat actif'],
  ]);
  b.heading('Description');
  b.paragraph(p.description ?? '');
  if (p.is_demo) b.paragraph('Bien de démonstration fictif.');
  if (p.verification_status !== 'verifie') b.paragraph('Informations juridiques à vérifier : ce document ne vaut pas vérification foncière.');
  await finishPdf(b, agency, { docType: 'fiche_bien', title: `Fiche ${p.reference}`, filename: `fiche-${slug(p.reference)}.pdf`, entityType: 'properties', entityId: p.id, personal: false });
}

export async function ownerSheetPdf(agency: PdfAgency, o: Row) {
  const [props, checks] = await Promise.all([
    listRows('properties', { select: 'reference, title, commercial_status, price_xof', eq: { owner_id: o.id }, pageSize: 200 }),
    listRows('document_checks', { eq: { owner_id: o.id }, pageSize: 200 }),
  ]);
  const b = await buildPdf(agency, 'Fiche propriétaire', o.reference, true);
  b.heading(fullName(o));
  b.keyValues([
    ['Téléphones', [o.phone_primary, o.phone_secondary].filter(Boolean).join(' / ')],
    ['Courriel', o.email ?? '—'],
    ['Localité / adresse', [o.locality, o.address].filter(Boolean).join(', ') || '—'],
    ['Préférence de contact', label(CONTACT_PREF, o.contact_preference)],
    ['Premier contact', formatDate(o.first_contact_date)],
    ['Source', o.source ?? '—'],
    ['Vérification', label(VERIFICATION_STATUS, o.verification_status)],
  ]);
  b.heading('Biens');
  b.table(['Référence', 'Titre', 'Statut', 'Prix'], props.rows.map((r) => [r.reference, r.title, label(PROPERTY_STATUS, r.commercial_status), formatXOF(r.price_xof)]));
  b.heading('Contrôle des documents');
  b.table(['Type', 'Référence', 'Reçu le', 'Statut', 'Vérifié le', 'Commentaire'], checks.rows.map((c) => [c.doc_type, c.doc_reference ?? '', formatDate(c.received_date), label(VERIFICATION_STATUS, c.verification_status), formatDate(c.verified_at), c.comment ?? '']));
  await finishPdf(b, agency, { docType: 'fiche_proprietaire', title: `Fiche ${o.reference}`, filename: `proprietaire-${slug(o.reference)}.pdf`, entityType: 'owners', entityId: o.id, personal: true });
}

export async function buyerSheetPdf(agency: PdfAgency, bu: Row) {
  const inter = await listRows('interactions', { eq: { buyer_id: bu.id }, order: { column: 'occurred_at' }, pageSize: 100 });
  const b = await buildPdf(agency, 'Fiche prospect', bu.reference, true);
  b.heading(fullName(bu));
  b.keyValues([
    ['Téléphone / courriel', [bu.phone, bu.email].filter(Boolean).join(' / ')],
    ['Budget', `${formatXOF(bu.budget_min)} → ${formatXOF(bu.budget_max)}`],
    ['Zones', (bu.zones ?? []).join(', ') || '—'],
    ['Types de biens', (bu.property_types ?? []).map((t: string) => label(PROPERTY_TYPES, t)).join(', ') || '—'],
    ['Délai du projet', bu.project_timeline ?? '—'],
    ['Statut', label(BUYER_STATUS, bu.status)],
    ['Prochaine relance', formatDateTime(bu.next_follow_up_at)],
    ['Consentements', `Contact : ${bu.consent_contact ? 'oui' : 'non'} · Offres : ${bu.consent_marketing ? 'oui' : 'non'}`],
  ]);
  b.heading('Échanges');
  b.table(['Date', 'Canal', 'Résumé'], inter.rows.map((i) => [formatDateTime(i.occurred_at), label(CHANNELS, i.channel), i.summary]));
  await finishPdf(b, agency, { docType: 'fiche_prospect', title: `Fiche ${bu.reference}`, filename: `prospect-${slug(bu.reference)}.pdf`, entityType: 'buyers', entityId: bu.id, personal: true });
}

export async function visitReportPdf(agency: PdfAgency, v: Row) {
  const b = await buildPdf(agency, 'Fiche de visite et compte rendu', v.reference, true);
  b.keyValues([
    ['Bien', v.property ? `${v.property.reference} — ${v.property.title}` : '—'],
    ['Prospect', fullName(v.buyer)],
    ['Date', formatDateTime(v.scheduled_at)],
    ['Lieu', v.location ?? '—'],
    ['Statut', label(VISIT_STATUS, v.status)],
    ['Niveau d’intérêt', v.interest_level ? `${v.interest_level}/5` : '—'],
    ['Prochaine action', v.next_action ?? '—'],
    ['Relance', formatDateTime(v.follow_up_at)],
  ]);
  b.heading('Compte rendu');
  b.paragraph(v.report ?? '');
  b.heading('Objections');
  b.paragraph(v.objections ?? '');
  await finishPdf(b, agency, { docType: 'compte_rendu_visite', title: `Visite ${v.reference}`, filename: `visite-${slug(v.reference)}.pdf`, entityType: 'visits', entityId: v.id, personal: true });
}

export async function transactionSheetPdf(agency: PdfAgency, t: Row, offers: Row[], commission: Row | null) {
  const b = await buildPdf(agency, 'Fiche de transaction', t.reference, true);
  b.keyValues([
    ['Bien', t.property ? `${t.property.reference} — ${t.property.title}` : '—'],
    ['Acheteur', fullName(t.buyer)],
    ['Vendeur', fullName(t.owner)],
    ['Prix demandé initial', formatXOF(t.initial_asking_price)],
    ['Prix convenu', formatXOF(t.agreed_price)],
    ['Statut', label(TRANSACTION_STATUS, t.status)],
    ['Dates', `Offre acceptée : ${formatDate(t.offer_accepted_date)} · Compromis : ${formatDate(t.compromise_date)} · Acte : ${formatDate(t.deed_date)} · Conclusion : ${formatDate(t.concluded_date)}`],
    ['Frais', formatXOF(t.fees)],
    ['Motif d’abandon', t.abandon_reason ?? '—'],
  ]);
  b.heading('Offres et contre-offres');
  b.table(['Date', 'Type', 'De', 'Montant', 'Statut'], offers.map((o) => [formatDateTime(o.offered_at), o.offer_kind === 'offre' ? 'Offre' : 'Contre-offre', o.from_party, formatXOF(o.amount), label(OFFER_STATUS, o.status)]));
  if (commission) {
    b.heading('Commission');
    b.keyValues([
      ['Estimée', formatXOF(commission.commission_estimated)],
      ['Convenue', formatXOF(commission.commission_agreed)],
      ['Exigible', formatXOF(commission.commission_due)],
      ['Encaissée', formatXOF(commission.commission_received)],
      ['Solde restant', formatXOF(commission.commission_balance)],
    ]);
    b.paragraph(COMMISSION_DISCLAIMER);
  }
  b.heading('Conditions');
  b.paragraph(t.conditions ?? '');
  await finishPdf(b, agency, { docType: 'fiche_transaction', title: `Transaction ${t.reference}`, filename: `transaction-${slug(t.reference)}.pdf`, entityType: 'transactions', entityId: t.id, personal: true });
}

export async function commissionStatementPdf(agency: PdfAgency) {
  const { rows } = await listRows('transaction_commissions', { order: { column: 'reference' }, pageSize: 1000 });
  const b = await buildPdf(agency, 'Relevé des commissions', `RELEVE-${todayISO()}`, true);
  b.table(
    ['Dossier', 'Statut', 'Base', 'Estimée', 'Convenue', 'Exigible', 'Encaissée', 'Solde'],
    rows.map((r) => [r.reference, label(TRANSACTION_STATUS, r.status), formatXOF(r.base_price), formatXOF(r.commission_estimated), formatXOF(r.commission_agreed), formatXOF(r.commission_due), formatXOF(r.commission_received), formatXOF(r.commission_balance)]),
  );
  b.paragraph(COMMISSION_DISCLAIMER);
  await finishPdf(b, agency, { docType: 'releve_commissions', title: 'Relevé des commissions', filename: `releve-commissions-${todayISO()}.pdf`, personal: true });
}

export async function financialReportPdf(agency: PdfAgency, from: string, to: string) {
  const r = await rpc<Row>('finance_report', { p_from: from, p_to: to });
  const b = await buildPdf(agency, 'Rapport financier', `FIN-${from}-${to}`, true);
  b.keyValues([
    ['Période', `${formatDate(from)} → ${formatDate(to)}`],
    ['Recettes attendues', formatXOF(r.revenues_expected)],
    ['Recettes encaissées', formatXOF(r.revenues_received)],
    ['Commissions dues (solde)', formatXOF(r.commissions_due)],
    ['Commissions encaissées', formatXOF(r.commissions_received)],
    ['Dépenses', formatXOF(r.expenses_total)],
    ['Résultat de gestion simplifié', formatXOF(r.result)],
  ]);
  b.heading('Recettes par type');
  b.table(['Type', 'Attendu', 'Encaissé', 'Solde'], (r.revenues_by_type as Row[]).map((x) => [label(REVENUE_TYPES, x.entry_type), formatXOF(x.expected), formatXOF(x.received), formatXOF(x.balance)]));
  b.heading('Dépenses par catégorie');
  b.table(['Catégorie', 'Nombre', 'Total'], (r.expenses_by_category as Row[]).map((x) => [x.category, String(x.count), formatXOF(x.total)]));
  b.paragraph('Les montants attendus ne sont pas des montants encaissés. Résultat simplifié (encaissements − dépenses), non comptable.');
  await finishPdf(b, agency, { docType: 'rapport_financier', title: `Rapport financier ${from} → ${to}`, filename: `rapport-financier-${from}-${to}.pdf`, personal: false });
}

export async function revenueStatementPdf(agency: PdfAgency, e: Row, payments: Row[]) {
  const b = await buildPdf(agency, 'Relevé de recette', e.reference, true);
  b.keyValues([
    ['Type', label(REVENUE_TYPES, e.entry_type)],
    ['Date', formatDate(e.entry_date)],
    ['Transaction', e.transaction?.reference ?? '—'],
    ['Montant attendu', formatXOF(e.amount_expected)],
    ['Montant encaissé', formatXOF(e.amount_received)],
    ['Solde', formatXOF(e.balance)],
    ['Statut', label(REVENUE_STATUS, e.status)],
  ]);
  b.heading('Encaissements');
  b.table(['Date', 'Montant', 'Mode', 'Référence', 'Note'], payments.map((p) => [formatDate(p.paid_on), formatXOF(p.amount), label(PAYMENT_METHODS, p.method), p.payment_reference ?? '', `${p.is_correction ? 'Correction : ' : ''}${p.note ?? ''}`]));
  await finishPdf(b, agency, { docType: 'releve_recette', title: `Recette ${e.reference}`, filename: `recette-${slug(e.reference)}.pdf`, entityType: 'financial_entries', entityId: e.id, personal: true });
}

export async function inventoryPdf(agency: PdfAgency) {
  const { rows } = await listRows('properties', { select: 'reference, title, property_type, city, district, price_xof, commercial_status, verification_status', notIn: { commercial_status: ['archive'] }, order: { column: 'reference', ascending: true }, pageSize: 2000 });
  const b = await buildPdf(agency, 'Inventaire des biens', `INV-${todayISO()}`, false);
  b.table(['Réf.', 'Titre', 'Type', 'Localisation', 'Prix', 'Statut', 'Vérif.'], rows.map((r) => [r.reference, r.title, label(PROPERTY_TYPES, r.property_type), [r.district, r.city].filter(Boolean).join(', '), formatXOF(r.price_xof), label(PROPERTY_STATUS, r.commercial_status), label(VERIFICATION_STATUS, r.verification_status)]));
  await finishPdf(b, agency, { docType: 'inventaire', title: `Inventaire ${todayISO()}`, filename: `inventaire-${todayISO()}.pdf`, personal: false });
}

export async function tasksPdf(agency: PdfAgency) {
  const { rows } = await listRows('tasks', { inList: { status: ['a_faire', 'en_cours', 'reportee'] }, order: { column: 'due_at', ascending: true }, pageSize: 1000 });
  const b = await buildPdf(agency, 'Liste des tâches ouvertes', `TACHES-${todayISO()}`, false);
  b.table(['Échéance', 'Tâche', 'Catégorie', 'Priorité', 'Statut'], rows.map((r) => [formatDateTime(r.due_at), r.title, r.category ?? '', label(TASK_PRIORITY, r.priority), label(TASK_STATUS, r.status)]));
  await finishPdf(b, agency, { docType: 'liste_taches', title: `Tâches ${todayISO()}`, filename: `taches-${todayISO()}.pdf`, personal: false });
}

export async function activityReportPdf(agency: PdfAgency, from: string, to: string, stats: Row) {
  const b = await buildPdf(agency, 'Rapport d’activité', `ACT-${from}-${to}`, false);
  b.keyValues([
    ['Période', `${formatDate(from)} → ${formatDate(to)}`],
    ['Biens référencés', String(stats.properties.total)],
    ['Biens en ligne', String(stats.properties.publies)],
    ['En négociation', String(stats.properties.en_negociation)],
    ['Vendus (total)', String(stats.properties.vendus)],
    ['Prospects actifs', String(stats.prospects ?? '—')],
    ['Demandes non traitées', String(stats.inquiries_new ?? '—')],
    ['Visites à venir', String(stats.visits_upcoming ?? '—')],
    ['Dossiers en cours', String(stats.transactions_open ?? '—')],
    ['Ventes conclues (période)', stats.sales ? `${stats.sales.count} — ${formatXOF(stats.sales.volume)}` : '—'],
    ['Tâches en retard', String(stats.tasks_overdue)],
  ]);
  await finishPdf(b, agency, { docType: 'rapport_activite', title: `Activité ${from} → ${to}`, filename: `rapport-activite-${from}-${to}.pdf`, personal: false });
}

/** Modèle de mandat : brouillon à faire valider, jamais présenté comme juridiquement valide. */
export async function mandateTemplatePdf(agency: PdfAgency, m: Row) {
  const b = await buildPdf(agency, 'Projet de mandat de vente — MODÈLE À VALIDER', m.reference, true);
  b.paragraph('AVERTISSEMENT : ce document est un modèle de travail généré automatiquement. Il n’a pas été validé juridiquement et ne doit pas être signé sans relecture par un professionnel compétent (notaire, juriste).');
  b.keyValues([
    ['Mandant', fullName(m.owner)],
    ['Bien', m.property ? `${m.property.reference} — ${m.property.title}` : '—'],
    ['Type de mandat', label(MANDATE_TYPES, m.mandate_type)],
    ['Durée', `Du ${formatDate(m.start_date)} au ${formatDate(m.end_date)}`],
    ['Rémunération convenue', m.commission_calc === 'pourcentage' ? `${m.commission_rate_percent} % du prix de vente` : m.commission_calc === 'fixe' ? formatXOF(m.commission_fixed_amount) : m.commission_notes ?? 'À préciser'],
    ['Statut', label(MANDATE_STATUS, m.status)],
  ]);
  b.heading('Conditions convenues');
  b.paragraph(m.conditions ?? 'À compléter.');
  b.heading('Signatures');
  b.paragraph('Le mandant : ____________________          L’agence : ____________________');
  await finishPdf(b, agency, { docType: 'modele_mandat', title: `Modèle de mandat ${m.reference}`, filename: `modele-mandat-${slug(m.reference)}.pdf`, entityType: 'mandates', entityId: m.id, personal: true, template: true });
}
