import { describe, expect, it } from 'vitest';
import { formatXOF, formatDate, formatDateTime, todayISO, toDateTimeInput, fromDateTimeInput } from '@/lib/format';
import { estimateCommission } from '@/domain/commission';
import { whatsappLink } from '@/domain/whatsapp';
import { csvEscape, toCsv } from '@/domain/csv';
import { validateFile, storagePath } from '@/domain/files';
import { inquirySchema, firstErrors } from '@/domain/validation';
import { label, PROPERTY_STATUS, statusTone } from '@/domain/labels';

describe('format', () => {
  it('formate le XOF sans décimales, y compris depuis une chaîne numeric', () => {
    expect(formatXOF(85000000)).toBe('85 000 000 FCFA');
    expect(formatXOF('2500000')).toBe('2 500 000 FCFA');
    expect(formatXOF(null)).toBe('—');
    expect(formatXOF('abc')).toBe('—');
  });

  it('affiche les dates dans le fuseau Africa/Abidjan', () => {
    expect(formatDate('2026-10-09')).toBe('09/10/2026');
    expect(formatDateTime('2026-10-09T23:30:00Z')).toBe('09/10/2026 23:30');
    expect(formatDateTime('2026-10-09T23:30:00+02:00')).toBe('09/10/2026 21:30');
    expect(todayISO(new Date('2026-10-09T23:59:00Z'))).toBe('2026-10-09');
  });

  it('aller-retour datetime-local ↔ timestamptz', () => {
    const iso = fromDateTimeInput('2026-10-12T10:30');
    expect(iso).toBe('2026-10-12T10:30:00.000Z');
    expect(toDateTimeInput(iso)).toBe('2026-10-12T10:30');
    expect(fromDateTimeInput('')).toBeNull();
  });
});

describe('commissions (miroir de la base)', () => {
  it('reproduit estimate_commission()', () => {
    expect(estimateCommission(10_000_000, 'pourcentage', 5, null, 250_000)).toBe(500_000);
    expect(estimateCommission(1_000_000, 'pourcentage', 5, null, 250_000)).toBe(250_000);
    expect(estimateCommission(10_000_000, 'fixe', null, 500_000)).toBe(500_000);
    expect(estimateCommission(10_000_000, 'autre')).toBeNull();
    expect(estimateCommission(33_333_333, 'pourcentage', 3)).toBe(1_000_000);
    expect(estimateCommission(null, 'pourcentage', 3)).toBeNull();
  });
});

describe('WhatsApp', () => {
  it('construit un lien prérempli avec la référence', () => {
    const l = whatsappLink('+225 00 00 00 00 00', 'Bonjour, bien {reference} ?', 'BIEN-2026-00001');
    expect(l).toBe('https://wa.me/2250000000000?text=' + encodeURIComponent('Bonjour, bien BIEN-2026-00001 ?'));
  });
  it('message générique sans référence, null sans numéro', () => {
    expect(whatsappLink('2250000000000', 'Bien {reference}')).toContain(encodeURIComponent('Bonjour, je vous contacte'));
    expect(whatsappLink('', 'x')).toBeNull();
    expect(whatsappLink(null, 'x')).toBeNull();
  });
});

describe('export CSV', () => {
  it('neutralise les formules et échappe les séparateurs', () => {
    expect(csvEscape('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvEscape('+225 07')).toBe("'+225 07");
    expect(csvEscape('a;b')).toBe('"a;b"');
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(['a', 'b'])).toBe('a | b');
  });
  it('refuse d’exporter des colonnes sensibles', () => {
    expect(() => toCsv([{ password: 'x' }], [{ key: 'password', header: 'MDP' }])).toThrow(/interdite/);
    expect(() => toCsv([{}], [{ key: 'client_fingerprint', header: 'x' }])).toThrow(/interdite/);
  });
  it('produit un CSV avec BOM et en-têtes', () => {
    const csv = toCsv([{ ref: 'A', prix: 10 }], [{ key: 'ref', header: 'Référence' }, { key: 'prix', header: 'Prix' }]);
    expect(csv).toBe('﻿Référence;Prix\r\nA;10');
  });
});

describe('fichiers', () => {
  it('limite formats et tailles', () => {
    expect(validateFile({ type: 'image/jpeg', size: 1000, name: 'a.jpg' }, 'photo')).toBeNull();
    expect(validateFile({ type: 'application/pdf', size: 1000, name: 'a.pdf' }, 'photo')).toMatch(/Format/);
    expect(validateFile({ type: 'image/jpeg', size: 6 * 1024 * 1024, name: 'a.jpg' }, 'photo')).toMatch(/volumineux/);
    expect(validateFile({ type: 'application/pdf', size: 1000, name: 'a.pdf' }, 'document')).toBeNull();
    expect(validateFile({ type: 'application/x-msdownload', size: 10, name: 'a.exe' }, 'document')).toMatch(/Format/);
    expect(validateFile({ type: 'image/png', size: 0, name: 'a.png' }, 'receipt')).toMatch(/vide/);
  });
  it('génère un chemin de stockage sans nom d’origine', () => {
    expect(storagePath('abc-123/../x', 'image/jpeg', 'id1')).toBe('abc-123/x/id1.jpg');
  });
});

describe('validation du formulaire public', () => {
  const base = { full_name: 'Awa K', phone: '+225 07 00 00 00 00', email: '', property_reference: 'bien-2026-00001', message: 'Bonjour, disponible ?', contact_preference: 'whatsapp' as const, consent: true as const };
  it('normalise les champs', () => {
    const r = inquirySchema.parse(base);
    expect(r.email).toBeNull();
    expect(r.property_reference).toBe('BIEN-2026-00001');
  });
  it('signale les erreurs en français', () => {
    const r = inquirySchema.safeParse({ ...base, phone: 'abc', consent: false, message: 'x' });
    expect(r.success).toBe(false);
    if (!r.success) {
      const e = firstErrors(r.error);
      expect(e.phone).toMatch(/téléphone/);
      expect(e.consent).toMatch(/accord/);
      expect(e.message).toMatch(/court/);
    }
  });
});

describe('libellés', () => {
  it('traduit les statuts et choisit une couleur', () => {
    expect(label(PROPERTY_STATUS, 'sous_negociation')).toBe('Sous négociation');
    expect(label(PROPERTY_STATUS, null)).toBe('—');
    expect(statusTone('publie')).toBe('success');
    expect(statusTone('annulee')).toBe('danger');
  });
});
