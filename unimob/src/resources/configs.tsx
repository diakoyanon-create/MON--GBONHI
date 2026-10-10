import type { Row } from '@/api/crud';
import { StatusBadge } from '@/components/ui';
import {
  BUYER_STATUS, INQUIRY_SOURCE, INQUIRY_STATUS, MANDATE_STATUS, MANDATE_TYPES, PAYMENT_METHODS, PROPERTY_STATUS,
  PROPERTY_TYPES, REVENUE_STATUS, REVENUE_TYPES, TASK_PRIORITY, TASK_STATUS, TRANSACTION_STATUS, VERIFICATION_STATUS,
  VISIT_STATUS, label, options,
} from '@/domain/labels';
import { COMMISSION_DISCLAIMER } from '@/domain/commission';
import { formatDate, formatDateTime, formatXOF, fullName, todayISO } from '@/lib/format';
import type { FieldDef, RelationDef, ResourceConfig } from './types';

// ---------------------------------------------------------------------------
// Relations réutilisables (listes déroulantes)
// ---------------------------------------------------------------------------
export const REL = {
  owner: { table: 'owners', select: 'id, reference, last_name, first_names', order: 'last_name', label: (r: Row) => `${fullName(r)} (${r.reference})` } satisfies RelationDef,
  property: { table: 'properties', select: 'id, reference, title, commercial_status', label: (r: Row) => `${r.reference} — ${r.title}`, notIn: { column: 'commercial_status', values: ['archive'] } } satisfies RelationDef,
  buyer: { table: 'buyers', select: 'id, reference, last_name, first_names, status', order: 'last_name', label: (r: Row) => `${fullName(r)} (${r.reference})`, notIn: { column: 'status', values: ['archive'] } } satisfies RelationDef,
  mandate: { table: 'mandates', select: 'id, reference, status', label: (r: Row) => `${r.reference} (${label(MANDATE_STATUS, r.status)})` } satisfies RelationDef,
  transaction: { table: 'transactions', select: 'id, reference, status', label: (r: Row) => `${r.reference} (${label(TRANSACTION_STATUS, r.status)})` } satisfies RelationDef,
  commissionRule: { table: 'commission_rules', select: 'id, name, is_active', order: 'name', label: (r: Row) => r.name, eq: { is_active: 'true' } } satisfies RelationDef,
  profile: { table: 'profiles', select: 'id, full_name, email, role, is_active', order: 'full_name', label: (r: Row) => r.full_name || r.email, eq: { is_active: 'true' } } satisfies RelationDef,
};

const ref = (r: Row) => <span className="font-mono text-xs">{r.reference}</span>;

// ---------------------------------------------------------------------------
// Biens
// ---------------------------------------------------------------------------
export const propertyFields: FieldDef[] = [
  { name: 'title', label: 'Titre de l’annonce', type: 'text', required: true, maxLength: 160, full: true },
  { name: 'property_type', label: 'Type de bien', type: 'select', required: true, options: options.propertyTypes },
  { name: 'reference', label: 'Référence', type: 'text', maxLength: 40, help: 'Laisser vide pour une référence automatique (BIEN-AAAA-NNNNN, format réservé). Modifiable ensuite par l’administrateur uniquement.' },
  { name: 'price_xof', label: 'Prix (FCFA)', type: 'money', min: 0 },
  { name: 'negotiable', label: 'Prix négociable', type: 'boolean' },
  { name: 'region', label: 'Région', type: 'text' },
  { name: 'city', label: 'Ville / commune', type: 'text', required: true },
  { name: 'district', label: 'Quartier', type: 'text' },
  { name: 'location_description', label: 'Localisation descriptive', type: 'text', full: true, help: 'Visible sur le site. Ne pas indiquer d’adresse précise.' },
  { name: 'latitude', label: 'Latitude (facultatif, privé)', type: 'number', min: -90, max: 90 },
  { name: 'longitude', label: 'Longitude (facultatif, privé)', type: 'number', min: -180, max: 180 },
  { name: 'area', label: 'Superficie', type: 'number', min: 0 },
  { name: 'area_unit', label: 'Unité', type: 'select', required: true, options: options.areaUnits },
  { name: 'bedrooms', label: 'Chambres', type: 'number', min: 0, max: 100, showIf: (v) => !['terrain'].includes(String(v.property_type)) },
  { name: 'bathrooms', label: 'Salles d’eau', type: 'number', min: 0, max: 100, showIf: (v) => !['terrain'].includes(String(v.property_type)) },
  { name: 'features', label: 'Caractéristiques', type: 'tags', placeholder: 'Ex. Jardin, Forage, Titre foncier…', full: true },
  { name: 'description', label: 'Description', type: 'textarea', maxLength: 8000 },
  { name: 'owner_id', label: 'Propriétaire', type: 'relation', relation: REL.owner },
  { name: 'assigned_to', label: 'Responsable', type: 'relation', relation: REL.profile },
  { name: 'listing_origin', label: 'Origine du référencement', type: 'select', settingsOptions: 'contact_sources' },
  { name: 'verification_status', label: 'Statut de vérification', type: 'select', required: true, options: options.verification, help: 'Distinct du statut commercial. « Vérifié » uniquement après contrôle réel des documents.' },
  { name: 'commercial_status', label: 'Statut commercial', type: 'select', required: true, options: options.propertyStatus, help: 'La publication est refusée tant que les conditions configurées ne sont pas remplies. Une vente conclue dans les transactions passe le bien en « Vendu ».' },
  { name: 'unavailability_reason', label: 'Motif d’indisponibilité', type: 'text', showIf: (v) => ['retire', 'archive', 'reserve', 'vendu'].includes(String(v.commercial_status)), full: true },
  { name: 'is_featured', label: 'Mettre en avant sur l’accueil', type: 'boolean' },
  { name: 'is_demo', label: 'Bien de démonstration (fictif)', type: 'boolean', help: 'Affiché comme fictif sur le site public.' },
];

export const propertiesConfig: ResourceConfig = {
  key: 'biens',
  table: 'properties',
  title: 'Biens immobiliers',
  singular: 'Bien',
  basePath: '/admin/biens',
  listSelect: 'id, reference, title, property_type, city, district, price_xof, commercial_status, verification_status, is_demo, updated_at',
  order: { column: 'updated_at' },
  search: ['reference', 'title', 'city', 'district'],
  searchPlaceholder: 'Référence, titre, ville, quartier…',
  filters: [
    { name: 'property_type', label: 'Type', options: options.propertyTypes },
    { name: 'commercial_status', label: 'Statut', options: options.propertyStatus },
    { name: 'verification_status', label: 'Vérification', options: options.verification },
  ],
  hiddenStatuses: { column: 'commercial_status', values: ['archive'], label: 'Afficher les archivés' },
  rangeFilters: [{ name: 'price_xof', label: 'Prix (FCFA)' }],
  fields: propertyFields,
  defaults: { area_unit: 'm2', negotiable: true, verification_status: 'a_verifier', commercial_status: 'brouillon' },
  columns: [
    { key: 'title', label: 'Bien', render: (r) => <span><span className="block">{r.title}</span><span className="font-mono text-xs text-ink-500">{r.reference}</span></span> },
    { key: 'property_type', label: 'Type', render: (r) => label(PROPERTY_TYPES, r.property_type) },
    { key: 'city', label: 'Localisation', render: (r) => [r.district, r.city].filter(Boolean).join(', ') },
    { key: 'price_xof', label: 'Prix', render: (r) => formatXOF(r.price_xof), className: 'whitespace-nowrap tabular-nums' },
    { key: 'commercial_status', label: 'Statut', render: (r) => <StatusBadge value={r.commercial_status} map={PROPERTY_STATUS} /> },
    { key: 'verification_status', label: 'Vérification', render: (r) => <StatusBadge value={r.verification_status} map={VERIFICATION_STATUS} /> },
  ],
  canCreate: 'sales',
  canEdit: 'sales',
  hasDetail: true,
};

// ---------------------------------------------------------------------------
// Propriétaires
// ---------------------------------------------------------------------------
export const ownerFields: FieldDef[] = [
  { name: 'last_name', label: 'Nom', type: 'text', required: true, maxLength: 80 },
  { name: 'first_names', label: 'Prénoms', type: 'text', maxLength: 120 },
  { name: 'phone_primary', label: 'Téléphone principal', type: 'tel', required: true },
  { name: 'phone_secondary', label: 'Téléphone secondaire', type: 'tel' },
  { name: 'email', label: 'Courriel', type: 'email' },
  { name: 'contact_preference', label: 'Préférence de contact', type: 'select', required: true, options: options.contactPref },
  { name: 'locality', label: 'Localité', type: 'text' },
  { name: 'address', label: 'Adresse', type: 'text' },
  { name: 'first_contact_date', label: 'Date du premier contact', type: 'date' },
  { name: 'source', label: 'Source', type: 'select', settingsOptions: 'contact_sources' },
  { name: 'verification_status', label: 'Statut de vérification', type: 'select', required: true, options: options.verification, help: 'Les informations juridiques restent « à vérifier » tant que le contrôle n’est pas réalisé.' },
  { name: 'notes', label: 'Notes internes', type: 'textarea' },
];

export const ownersConfig: ResourceConfig = {
  key: 'proprietaires',
  table: 'owners',
  title: 'Propriétaires et vendeurs',
  singular: 'Propriétaire',
  basePath: '/admin/proprietaires',
  listSelect: 'id, reference, last_name, first_names, phone_primary, locality, verification_status, created_at',
  order: { column: 'created_at' },
  search: ['reference', 'last_name', 'first_names', 'phone_primary', 'email'],
  searchPlaceholder: 'Nom, téléphone, référence…',
  filters: [{ name: 'verification_status', label: 'Vérification', options: options.verification }],
  archivedColumn: 'archived_at',
  fields: ownerFields,
  defaults: { contact_preference: 'telephone', verification_status: 'a_verifier' },
  columns: [
    { key: 'last_name', label: 'Nom', render: (r) => fullName(r) },
    { key: 'reference', label: 'Référence', render: ref },
    { key: 'phone_primary', label: 'Téléphone' },
    { key: 'locality', label: 'Localité' },
    { key: 'verification_status', label: 'Vérification', render: (r) => <StatusBadge value={r.verification_status} map={VERIFICATION_STATUS} /> },
  ],
  canCreate: 'sales',
  canEdit: 'sales',
  hasDetail: true,
};

// ---------------------------------------------------------------------------
// Acheteurs / prospects
// ---------------------------------------------------------------------------
export const buyerFields: FieldDef[] = [
  { name: 'last_name', label: 'Nom', type: 'text', required: true, maxLength: 80 },
  { name: 'first_names', label: 'Prénoms', type: 'text' },
  { name: 'phone', label: 'Téléphone', type: 'tel', required: true },
  { name: 'email', label: 'Courriel', type: 'email' },
  { name: 'budget_min', label: 'Budget minimal (FCFA)', type: 'money', min: 0 },
  { name: 'budget_max', label: 'Budget maximal (FCFA)', type: 'money', min: 0 },
  { name: 'zones', label: 'Zones recherchées', type: 'tags', settingsOptions: 'zones_served', full: true },
  { name: 'property_types', label: 'Types de biens', type: 'multiselect', options: options.propertyTypes },
  { name: 'area_min', label: 'Superficie minimale (m²)', type: 'number', min: 0 },
  { name: 'bedrooms_min', label: 'Chambres minimum', type: 'number', min: 0 },
  { name: 'project_timeline', label: 'Délai du projet', type: 'text', placeholder: 'Ex. sous 3 mois' },
  { name: 'source', label: 'Source', type: 'select', settingsOptions: 'contact_sources' },
  { name: 'contact_preference', label: 'Préférence de communication', type: 'select', required: true, options: options.contactPref },
  { name: 'status', label: 'Statut', type: 'select', required: true, options: options.buyerStatus },
  { name: 'next_follow_up_at', label: 'Prochaine relance', type: 'datetime' },
  { name: 'assigned_to', label: 'Responsable', type: 'relation', relation: REL.profile },
  { name: 'consent_contact', label: 'Consentement à être recontacté', type: 'boolean' },
  { name: 'consent_marketing', label: 'Accepte de recevoir des offres', type: 'boolean' },
  { name: 'notes', label: 'Notes internes', type: 'textarea' },
];

export const buyersConfig: ResourceConfig = {
  key: 'acheteurs',
  table: 'buyers',
  title: 'Acheteurs et prospects',
  singular: 'Prospect',
  basePath: '/admin/acheteurs',
  listSelect: 'id, reference, last_name, first_names, phone, budget_min, budget_max, zones, status, next_follow_up_at, last_contact_at',
  order: { column: 'created_at' },
  search: ['reference', 'last_name', 'first_names', 'phone', 'email'],
  searchPlaceholder: 'Nom, téléphone, courriel…',
  filters: [{ name: 'status', label: 'Statut', options: options.buyerStatus }],
  hiddenStatuses: { column: 'status', values: ['archive', 'sans_suite'], label: 'Afficher archivés / sans suite' },
  coverFilter: { param: 'budget', label: 'Budget compatible avec (FCFA)', minCol: 'budget_min', maxCol: 'budget_max' },
  containsFilter: { name: 'zones', label: 'Zone recherchée', settingsOptions: 'zones_served' },
  fields: buyerFields,
  defaults: { contact_preference: 'telephone', status: 'nouveau' },
  columns: [
    { key: 'last_name', label: 'Nom', render: (r) => fullName(r) },
    { key: 'phone', label: 'Téléphone' },
    { key: 'budget_max', label: 'Budget', render: (r) => (r.budget_max ? `≤ ${formatXOF(r.budget_max)}` : r.budget_min ? `≥ ${formatXOF(r.budget_min)}` : '—'), className: 'whitespace-nowrap' },
    { key: 'zones', label: 'Zones', render: (r) => (r.zones?.length ? r.zones.join(', ') : '—') },
    { key: 'status', label: 'Statut', render: (r) => <StatusBadge value={r.status} map={BUYER_STATUS} /> },
    { key: 'next_follow_up_at', label: 'Relance', render: (r) => formatDateTime(r.next_follow_up_at) },
  ],
  canCreate: 'sales',
  canEdit: 'sales',
  hasDetail: true,
};

// ---------------------------------------------------------------------------
// Mandats
// ---------------------------------------------------------------------------
export const mandateFields: FieldDef[] = [
  { name: 'property_id', label: 'Bien', type: 'relation', required: true, relation: REL.property, full: true },
  { name: 'owner_id', label: 'Propriétaire (mandant)', type: 'relation', required: true, relation: REL.owner, help: 'Doit être le propriétaire enregistré du bien.' },
  { name: 'mandate_type', label: 'Type de mandat', type: 'select', required: true, options: options.mandateTypes },
  { name: 'status', label: 'Statut', type: 'select', required: true, options: options.mandateStatus },
  { name: 'signed_date', label: 'Date de signature', type: 'date', help: 'Obligatoire pour un mandat actif.' },
  { name: 'start_date', label: 'Début', type: 'date' },
  { name: 'end_date', label: 'Expiration', type: 'date' },
  { name: 'reminder_date', label: 'Date de rappel', type: 'date' },
  { name: 'commission_rule_id', label: 'Règle de commission', type: 'relation', relation: REL.commissionRule },
  { name: 'commission_calc', label: 'Rémunération convenue', type: 'select', options: options.commissionCalc },
  { name: 'commission_rate_percent', label: 'Taux convenu (%)', type: 'number', min: 0, max: 100, showIf: (v) => v.commission_calc === 'pourcentage' },
  { name: 'commission_fixed_amount', label: 'Montant convenu (FCFA)', type: 'money', min: 0, showIf: (v) => v.commission_calc === 'fixe' },
  { name: 'commission_notes', label: 'Précisions sur la rémunération', type: 'text', full: true },
  { name: 'conditions', label: 'Conditions convenues', type: 'textarea' },
];

export const mandatesConfig: ResourceConfig = {
  key: 'mandats',
  table: 'mandates',
  title: 'Mandats',
  singular: 'Mandat',
  basePath: '/admin/mandats',
  listSelect: 'id, reference, mandate_type, status, signed_date, end_date, property:properties!mandates_property_id_fkey(reference, title), owner:owners!mandates_owner_id_fkey(last_name, first_names)',
  order: { column: 'created_at' },
  search: ['reference'],
  filters: [{ name: 'status', label: 'Statut', options: options.mandateStatus }, { name: 'mandate_type', label: 'Type', options: options.mandateTypes }],
  fields: mandateFields,
  defaults: { mandate_type: 'simple', status: 'brouillon' },
  notice: 'Les durées, conditions et commissions sont configurables et ne constituent pas des obligations légales. Les modèles de mandat doivent être validés par un professionnel compétent avant utilisation.',
  attachment: { bucket: 'private-documents', column: 'signed_document_path', label: 'Mandat signé (PDF ou photo)', folder: 'mandats' },
  columns: [
    { key: 'reference', label: 'Référence', render: ref },
    { key: 'property', label: 'Bien', render: (r) => r.property ? `${r.property.reference} — ${r.property.title}` : '—' },
    { key: 'owner', label: 'Mandant', render: (r) => fullName(r.owner) },
    { key: 'mandate_type', label: 'Type', render: (r) => label(MANDATE_TYPES, r.mandate_type) },
    { key: 'status', label: 'Statut', render: (r) => <StatusBadge value={r.status} map={MANDATE_STATUS} /> },
    { key: 'end_date', label: 'Expiration', render: (r) => formatDate(r.end_date) },
  ],
  canCreate: 'sales',
  canEdit: 'sales',
};

// ---------------------------------------------------------------------------
// Demandes
// ---------------------------------------------------------------------------
export const inquiryFields: FieldDef[] = [
  { name: 'full_name', label: 'Nom complet', type: 'text', required: true, maxLength: 120 },
  { name: 'phone', label: 'Téléphone', type: 'tel', required: true },
  { name: 'email', label: 'Courriel', type: 'email' },
  { name: 'source', label: 'Canal', type: 'select', required: true, options: options.inquirySource },
  { name: 'property_id', label: 'Bien concerné', type: 'relation', relation: REL.property, full: true },
  { name: 'message', label: 'Message / besoin', type: 'textarea', required: true, maxLength: 2000 },
  { name: 'contact_preference', label: 'Préférence de contact', type: 'select', required: true, options: options.contactPref },
  { name: 'status', label: 'Statut', type: 'select', required: true, options: options.inquiryStatus },
  { name: 'consent', label: 'La personne a donné son accord pour être recontactée', type: 'boolean', help: 'À cocher uniquement si l’accord a été exprimé. Votre nom et la date sont enregistrés comme preuve.' },
];

export const inquiriesConfig: ResourceConfig = {
  key: 'demandes',
  table: 'inquiries',
  title: 'Demandes',
  singular: 'Demande',
  basePath: '/admin/demandes',
  listSelect: 'id, reference, full_name, phone, source, status, created_at, property_reference_input, property:properties!inquiries_property_id_fkey(reference, title)',
  order: { column: 'created_at' },
  search: ['reference', 'full_name', 'phone', 'email'],
  filters: [{ name: 'status', label: 'Statut', options: options.inquiryStatus }, { name: 'source', label: 'Canal', options: options.inquirySource }],
  hiddenStatuses: { column: 'status', values: ['spam'], label: 'Afficher les indésirables' },
  fields: inquiryFields,
  defaults: { source: 'telephone', contact_preference: 'telephone', status: 'nouveau', consent: false },
  notice: 'Les conversations WhatsApp ne sont pas importées automatiquement : enregistrez ici les demandes reçues par WhatsApp ou téléphone.',
  columns: [
    { key: 'full_name', label: 'Contact' },
    { key: 'created_at', label: 'Reçue le', render: (r) => formatDateTime(r.created_at) },
    { key: 'property', label: 'Bien', render: (r) => r.property?.reference ?? r.property_reference_input ?? '—' },
    { key: 'source', label: 'Canal', render: (r) => label(INQUIRY_SOURCE, r.source) },
    { key: 'status', label: 'Statut', render: (r) => <StatusBadge value={r.status} map={INQUIRY_STATUS} /> },
  ],
  canCreate: 'sales',
  canEdit: 'sales',
  hasDetail: true,
};

// ---------------------------------------------------------------------------
// Visites
// ---------------------------------------------------------------------------
export const visitFields: FieldDef[] = [
  { name: 'property_id', label: 'Bien', type: 'relation', required: true, relation: REL.property, full: true },
  { name: 'buyer_id', label: 'Prospect', type: 'relation', required: true, relation: REL.buyer },
  { name: 'scheduled_at', label: 'Date et heure', type: 'datetime', required: true },
  { name: 'location', label: 'Lieu de rendez-vous', type: 'text' },
  { name: 'status', label: 'Statut', type: 'select', required: true, options: options.visitStatus },
  { name: 'agent_id', label: 'Agent', type: 'relation', relation: REL.profile },
  { name: 'report', label: 'Compte rendu', type: 'textarea' },
  { name: 'interest_level', label: 'Niveau d’intérêt (1 à 5)', type: 'number', min: 1, max: 5 },
  { name: 'objections', label: 'Objections', type: 'text', full: true },
  { name: 'next_action', label: 'Prochaine action', type: 'text' },
  { name: 'follow_up_at', label: 'Relance', type: 'datetime' },
  { name: 'notes', label: 'Notes', type: 'textarea' },
];

export const visitsConfig: ResourceConfig = {
  key: 'visites',
  table: 'visits',
  title: 'Visites',
  singular: 'Visite',
  basePath: '/admin/visites',
  listSelect: 'id, reference, scheduled_at, status, interest_level, location, property:properties!visits_property_id_fkey(reference, title), buyer:buyers!visits_buyer_id_fkey(last_name, first_names)',
  order: { column: 'scheduled_at' },
  search: ['reference', 'location'],
  filters: [{ name: 'status', label: 'Statut', options: options.visitStatus }],
  fields: visitFields,
  defaults: { status: 'a_confirmer' },
  columns: [
    { key: 'scheduled_at', label: 'Date', render: (r) => formatDateTime(r.scheduled_at) },
    { key: 'property', label: 'Bien', render: (r) => r.property ? `${r.property.reference} — ${r.property.title}` : '—' },
    { key: 'buyer', label: 'Prospect', render: (r) => fullName(r.buyer) },
    { key: 'status', label: 'Statut', render: (r) => <StatusBadge value={r.status} map={VISIT_STATUS} /> },
    { key: 'interest_level', label: 'Intérêt', render: (r) => (r.interest_level ? `${r.interest_level}/5` : '—') },
  ],
  canCreate: 'sales',
  canEdit: 'sales',
};

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------
export const transactionFields: FieldDef[] = [
  { name: 'property_id', label: 'Bien', type: 'relation', required: true, relation: REL.property, full: true },
  { name: 'buyer_id', label: 'Acheteur', type: 'relation', required: true, relation: REL.buyer },
  { name: 'owner_id', label: 'Vendeur', type: 'relation', required: true, relation: REL.owner, help: 'Doit être le propriétaire enregistré du bien.' },
  { name: 'mandate_id', label: 'Mandat', type: 'relation', relation: REL.mandate },
  { name: 'initial_asking_price', label: 'Prix demandé initial (FCFA)', type: 'money', min: 0 },
  { name: 'agreed_price', label: 'Prix convenu (FCFA)', type: 'money', min: 1 },
  { name: 'status', label: 'Statut', type: 'select', required: true, options: options.transactionStatus, help: 'Une offre acceptée ne signifie pas que la vente est conclue.' },
  { name: 'offer_accepted_date', label: 'Date d’acceptation de l’offre', type: 'date' },
  { name: 'compromise_date', label: 'Date de promesse / compromis', type: 'date' },
  { name: 'deed_date', label: 'Date de l’acte', type: 'date' },
  { name: 'concluded_date', label: 'Date de conclusion', type: 'date', help: 'Obligatoire pour « Vente conclue ».' },
  { name: 'abandon_reason', label: 'Motif d’annulation / abandon', type: 'text', full: true, showIf: (v) => ['annulee', 'abandonnee'].includes(String(v.status)) },
  { name: 'commission_rule_id', label: 'Règle de commission', type: 'relation', relation: REL.commissionRule },
  { name: 'commission_agreed', label: 'Commission convenue (FCFA)', type: 'money', min: 0 },
  { name: 'fees', label: 'Frais (FCFA)', type: 'money', min: 0 },
  { name: 'agent_id', label: 'Agent', type: 'relation', relation: REL.profile },
  { name: 'conditions', label: 'Conditions éventuelles', type: 'textarea' },
  { name: 'supporting_docs_note', label: 'Justificatifs (liste / état)', type: 'textarea' },
  { name: 'notes', label: 'Notes', type: 'textarea' },
];

export const transactionsConfig: ResourceConfig = {
  key: 'transactions',
  table: 'transactions',
  title: 'Négociations et transactions',
  singular: 'Dossier',
  basePath: '/admin/transactions',
  listSelect: 'id, reference, status, initial_asking_price, agreed_price, concluded_date, updated_at, property:properties!transactions_property_id_fkey(reference, title), buyer:buyers!transactions_buyer_id_fkey(last_name, first_names)',
  order: { column: 'updated_at' },
  search: ['reference'],
  filters: [{ name: 'status', label: 'Statut', options: options.transactionStatus }],
  fields: transactionFields,
  defaults: { status: 'negociation' },
  notice: COMMISSION_DISCLAIMER,
  columns: [
    { key: 'reference', label: 'Dossier', render: ref },
    { key: 'property', label: 'Bien', render: (r) => r.property ? `${r.property.reference} — ${r.property.title}` : '—' },
    { key: 'buyer', label: 'Acheteur', render: (r) => fullName(r.buyer) },
    { key: 'agreed_price', label: 'Prix', render: (r) => formatXOF(r.agreed_price ?? r.initial_asking_price), className: 'whitespace-nowrap tabular-nums' },
    { key: 'status', label: 'Statut', render: (r) => <StatusBadge value={r.status} map={TRANSACTION_STATUS} /> },
  ],
  canCreate: 'negotiate',
  canEdit: 'negotiate',
  hasDetail: true,
};

// ---------------------------------------------------------------------------
// Finances
// ---------------------------------------------------------------------------
export const revenueFields: FieldDef[] = [
  { name: 'entry_date', label: 'Date', type: 'date', required: true },
  { name: 'entry_type', label: 'Type de recette', type: 'select', required: true, options: options.revenueTypes },
  { name: 'transaction_id', label: 'Transaction liée', type: 'relation', relation: REL.transaction },
  { name: 'amount_expected', label: 'Montant attendu (FCFA)', type: 'money', required: true, min: 0 },
  { name: 'status', label: 'Statut', type: 'select', required: true, options: options.revenueStatus.filter((o) => !['partiel', 'encaisse'].includes(o.value)), help: '« Partiel » et « Encaissé » sont calculés à partir des encaissements.' },
  { name: 'description', label: 'Description', type: 'text', full: true },
  { name: 'notes', label: 'Notes', type: 'textarea' },
];

export const revenuesConfig: ResourceConfig = {
  key: 'recettes',
  table: 'financial_entries',
  title: 'Recettes',
  singular: 'Recette',
  basePath: '/admin/finances/recettes',
  listSelect: 'id, reference, entry_date, entry_type, amount_expected, amount_received, balance, status, transaction:transactions!financial_entries_transaction_id_fkey(reference)',
  order: { column: 'entry_date' },
  search: ['reference', 'description'],
  filters: [{ name: 'status', label: 'Statut', options: options.revenueStatus }, { name: 'entry_type', label: 'Type', options: options.revenueTypes }],
  fields: revenueFields,
  defaults: () => ({ entry_type: 'commission', status: 'prevu', entry_date: todayISO() }),
  notice: 'Les montants attendus et encaissés sont distincts. Les encaissements se saisissent depuis la fiche de la recette et ne sont jamais modifiés : une erreur se corrige par une ligne de correction motivée.',
  columns: [
    { key: 'reference', label: 'Référence', render: ref },
    { key: 'entry_date', label: 'Date', render: (r) => formatDate(r.entry_date) },
    { key: 'entry_type', label: 'Type', render: (r) => label(REVENUE_TYPES, r.entry_type) },
    { key: 'amount_expected', label: 'Attendu', render: (r) => formatXOF(r.amount_expected), className: 'whitespace-nowrap tabular-nums' },
    { key: 'amount_received', label: 'Encaissé', render: (r) => formatXOF(r.amount_received), className: 'whitespace-nowrap tabular-nums' },
    { key: 'balance', label: 'Solde', render: (r) => formatXOF(r.balance), className: 'whitespace-nowrap tabular-nums' },
    { key: 'status', label: 'Statut', render: (r) => <StatusBadge value={r.status} map={REVENUE_STATUS} /> },
  ],
  canCreate: 'finance',
  canEdit: 'finance',
  hasDetail: true,
  canDelete: false,
};

export const expenseFields: FieldDef[] = [
  { name: 'expense_date', label: 'Date', type: 'date', required: true },
  { name: 'category', label: 'Catégorie', type: 'select', required: true, settingsOptions: 'expense_categories' },
  { name: 'description', label: 'Description', type: 'text', required: true, maxLength: 500, full: true },
  { name: 'amount', label: 'Montant (FCFA)', type: 'money', required: true, min: 1 },
  { name: 'payment_method', label: 'Mode de paiement', type: 'select', required: true, options: options.paymentMethods },
  { name: 'property_id', label: 'Bien lié', type: 'relation', relation: REL.property },
  { name: 'transaction_id', label: 'Transaction liée', type: 'relation', relation: REL.transaction },
  { name: 'notes', label: 'Notes', type: 'textarea' },
];

export const expensesConfig: ResourceConfig = {
  key: 'depenses',
  table: 'expenses',
  title: 'Dépenses',
  singular: 'Dépense',
  basePath: '/admin/finances/depenses',
  listSelect: 'id, reference, expense_date, category, description, amount, payment_method',
  order: { column: 'expense_date' },
  search: ['reference', 'description', 'category'],
  fields: expenseFields,
  attachment: { bucket: 'finance-receipts', column: 'receipt_path', label: 'Justificatif de la dépense', folder: 'depenses' },
  defaults: () => ({ payment_method: 'especes', expense_date: todayISO() }),
  columns: [
    { key: 'description', label: 'Dépense' },
    { key: 'expense_date', label: 'Date', render: (r) => formatDate(r.expense_date) },
    { key: 'category', label: 'Catégorie' },
    { key: 'amount', label: 'Montant', render: (r) => formatXOF(r.amount), className: 'whitespace-nowrap tabular-nums' },
    { key: 'payment_method', label: 'Paiement', render: (r) => label(PAYMENT_METHODS, r.payment_method) },
    { key: 'reference', label: 'Référence', render: ref },
  ],
  canCreate: 'finance',
  canEdit: 'finance',
};

export const commissionRuleFields: FieldDef[] = [
  { name: 'name', label: 'Nom de la règle', type: 'text', required: true, full: true },
  { name: 'calc_type', label: 'Mode de calcul', type: 'select', required: true, options: options.commissionCalc },
  { name: 'rate_percent', label: 'Taux (%)', type: 'number', min: 0, max: 100, showIf: (v) => v.calc_type === 'pourcentage', required: true },
  { name: 'min_amount', label: 'Minimum (FCFA)', type: 'money', min: 0, showIf: (v) => v.calc_type === 'pourcentage' },
  { name: 'fixed_amount', label: 'Montant fixe (FCFA)', type: 'money', min: 0, showIf: (v) => v.calc_type === 'fixe', required: true },
  { name: 'payer', label: 'À la charge de', type: 'select', required: true, options: [{ value: 'vendeur', label: 'Vendeur' }, { value: 'acheteur', label: 'Acheteur' }, { value: 'partage', label: 'Partagée' }] },
  { name: 'is_active', label: 'Règle active', type: 'boolean' },
  { name: 'notes', label: 'Notes', type: 'textarea' },
];

export const commissionRulesConfig: ResourceConfig = {
  key: 'commissions',
  table: 'commission_rules',
  title: 'Règles de commission',
  singular: 'Règle',
  basePath: '/admin/finances/regles',
  order: { column: 'name', ascending: true },
  fields: commissionRuleFields,
  defaults: { calc_type: 'pourcentage', payer: 'vendeur', is_active: true },
  notice: COMMISSION_DISCLAIMER,
  columns: [
    { key: 'name', label: 'Règle' },
    { key: 'calc_type', label: 'Calcul', render: (r) => (r.calc_type === 'pourcentage' ? `${r.rate_percent} %${r.min_amount ? ` (min. ${formatXOF(r.min_amount)})` : ''}` : r.calc_type === 'fixe' ? formatXOF(r.fixed_amount) : 'Autre') },
    { key: 'payer', label: 'À la charge de' },
    { key: 'is_active', label: 'Active', render: (r) => (r.is_active ? 'Oui' : 'Non') },
  ],
  canCreate: 'finance',
  canEdit: 'finance',
};

// ---------------------------------------------------------------------------
// Tâches
// ---------------------------------------------------------------------------
export const taskFields: FieldDef[] = [
  { name: 'title', label: 'Titre', type: 'text', required: true, maxLength: 200, full: true },
  { name: 'category', label: 'Catégorie', type: 'select', settingsOptions: 'task_categories' },
  { name: 'priority', label: 'Priorité', type: 'select', required: true, options: options.taskPriority },
  { name: 'due_at', label: 'Échéance', type: 'datetime' },
  { name: 'status', label: 'Statut', type: 'select', required: true, options: options.taskStatus },
  { name: 'assigned_to', label: 'Assignée à', type: 'relation', relation: REL.profile },
  { name: 'property_id', label: 'Bien associé', type: 'relation', relation: REL.property },
  { name: 'buyer_id', label: 'Prospect associé', type: 'relation', relation: REL.buyer },
  { name: 'owner_id', label: 'Propriétaire associé', type: 'relation', relation: REL.owner },
  { name: 'description', label: 'Description', type: 'textarea' },
  { name: 'result', label: 'Résultat', type: 'textarea', editOnly: true },
  { name: 'next_action', label: 'Prochaine action', type: 'text', editOnly: true },
];

export const tasksConfig: ResourceConfig = {
  key: 'taches',
  table: 'tasks',
  title: 'Tâches et rappels',
  singular: 'Tâche',
  basePath: '/admin/taches',
  listSelect: 'id, title, category, priority, due_at, status',
  order: { column: 'due_at', ascending: true },
  search: ['title', 'description'],
  filters: [{ name: 'status', label: 'Statut', options: options.taskStatus }, { name: 'priority', label: 'Priorité', options: options.taskPriority }],
  hiddenStatuses: { column: 'status', values: ['terminee', 'annulee'], label: 'Afficher terminées / annulées' },
  fields: taskFields,
  defaults: { priority: 'normale', status: 'a_faire' },
  notice: 'Les rappels s’affichent dans l’application. Aucune notification externe (SMS, courriel) n’est envoyée tant qu’un service n’a pas été réellement configuré.',
  columns: [
    { key: 'title', label: 'Tâche' },
    { key: 'due_at', label: 'Échéance', render: (r) => <span className={r.due_at && new Date(r.due_at) < new Date() && !['terminee', 'annulee'].includes(r.status) ? 'font-medium text-red-700' : ''}>{formatDateTime(r.due_at)}</span> },
    { key: 'priority', label: 'Priorité', render: (r) => label(TASK_PRIORITY, r.priority) },
    { key: 'category', label: 'Catégorie' },
    { key: 'status', label: 'Statut', render: (r) => <StatusBadge value={r.status} map={TASK_STATUS} /> },
  ],
  canCreate: 'staff',
  canEdit: 'staff',
};

export const ALL_CONFIGS = [
  propertiesConfig, ownersConfig, buyersConfig, mandatesConfig, inquiriesConfig, visitsConfig,
  transactionsConfig, revenuesConfig, expensesConfig, commissionRulesConfig, tasksConfig,
];
