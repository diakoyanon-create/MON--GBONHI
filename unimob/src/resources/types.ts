import type { ReactNode } from 'react';
import type { Option } from '@/domain/labels';
import type { Permissions } from '@/auth/AuthContext';
import type { Row } from '@/api/crud';

export type FieldType =
  | 'text' | 'textarea' | 'number' | 'money' | 'date' | 'datetime' | 'select'
  | 'tags' | 'multiselect' | 'boolean' | 'relation' | 'email' | 'tel';

export type RelationDef = {
  table: string;
  select: string;
  label: (row: Row) => string;
  order?: string;
  eq?: Record<string, string>;
  notIn?: { column: string; values: string[] };
};

export type FieldDef = {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: Option[];
  /** Liste d'options issue des paramètres de l'agence (ex. contact_sources). */
  settingsOptions?: string;
  relation?: RelationDef;
  help?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
  full?: boolean;
  showIf?: (values: Record<string, unknown>) => boolean;
  /** Masqué à la création (champ géré par le flux). */
  editOnly?: boolean;
};

export type Column = { key: string; label: string; render?: (row: Row) => ReactNode; className?: string };

export type Filter = { name: string; label: string; options: Option[] };

export type ResourceConfig = {
  key: string;
  table: string;
  title: string;
  singular: string;
  basePath: string;
  listSelect?: string;
  order: { column: string; ascending?: boolean };
  fields: FieldDef[];
  columns: Column[];
  search?: string[];
  searchPlaceholder?: string;
  filters?: Filter[];
  /** Filtre par défaut « masquer archivés » etc. */
  hiddenStatuses?: { column: string; values: string[]; label: string };
  /** Filtres numériques « entre » : paramètres d'URL <name>_min et <name>_max. */
  rangeFilters?: Array<{ name: string; label: string }>;
  /** Filtre « couvre la valeur » sur une fourchette min/max (ex. budget d'un prospect). */
  coverFilter?: { param: string; label: string; minCol: string; maxCol: string };
  /** Filtre « contient » sur une colonne tableau (ex. zones recherchées). */
  containsFilter?: { name: string; label: string; settingsOptions: string };
  /** Colonne d'archivage (date) : les éléments archivés sont masqués par défaut. */
  archivedColumn?: string;
  /** false si la suppression est interdite par la base même pour l'administrateur. */
  canDelete?: boolean;
  /** Pièce jointe privée enregistrée dans une colonne (justificatif, document signé). */
  attachment?: { bucket: 'private-documents' | 'finance-receipts'; column: string; label: string; folder: string };
  canCreate: keyof Permissions;
  canEdit: keyof Permissions;
  hasDetail?: boolean;
  /** Valeurs initiales ; une fonction est réévaluée à chaque ouverture (ex. date du jour). */
  defaults?: Record<string, unknown> | (() => Record<string, unknown>);
  exportName?: string;
  /** Lignes d'en-tête explicatives (avertissements légaux, etc.). */
  notice?: ReactNode;
};
