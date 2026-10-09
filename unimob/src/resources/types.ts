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
  canCreate: keyof Permissions;
  canEdit: keyof Permissions;
  hasDetail?: boolean;
  /** Valeurs initiales ; une fonction est réévaluée à chaque ouverture (ex. date du jour). */
  defaults?: Record<string, unknown> | (() => Record<string, unknown>);
  exportName?: string;
  /** Lignes d'en-tête explicatives (avertissements légaux, etc.). */
  notice?: ReactNode;
};
