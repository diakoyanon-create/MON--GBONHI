// Tests unitaires des corrections de l'audit (interface).
import { describe, expect, it } from 'vitest';
import { parseXOF } from '@/lib/money';
import { authRedirectTarget } from '@/lib/authRedirect';
import { robotsTxt } from '@/lib/robots';
import { escapeHtml, injectMeta } from '@/lib/ogInject';
import { propertyDescription } from '@/domain/propertyText';
import { pdfSafe } from '@/lib/pdf';
import { isValidConfig } from '@/lib/supabase';
import { normalizeSearch } from '@/api/publicApi';
import { compressImage } from '@/domain/files';
import { pageFromParam } from '@/resources/ResourceList';
import { isChunkLoadError } from '@/lib/pwa';
import { fullTitle } from '@/lib/seo';
import { fromFormValues, validate } from '@/resources/values';
import type { FieldDef } from '@/resources/types';

describe('montants en FCFA', () => {
  it('accepte les séparateurs de milliers usuels', () => {
    for (const [input, n] of [['150000', 150000], ['150 000', 150000], ['150.000', 150000], ['1.500.000', 1500000], ['1,500,000', 1500000], ['150 000', 150000], ['25 000 F', 25000], ['0', 0]] as const) {
      expect(parseXOF(input), input).toBe(n);
    }
  });
  it('refuse les formats ambigus au lieu de diviser par 1000', () => {
    for (const input of ['150.5', '1.50.000', '12,5', '1.500,000', 'abc', '', '15 000,50']) {
      expect(Number.isNaN(parseXOF(input)), input).toBe(true);
    }
  });
  it('est utilisé par les formulaires', () => {
    const f: FieldDef[] = [{ name: 'price', label: 'Prix', type: 'money' }];
    expect(fromFormValues(f, { price: '150.000' }, false)).toEqual({ price: 150000 });
    expect(validate(f, { price: '150.5' }).price).toMatch(/Montant invalide/);
  });
});

describe('formulaires : champs masqués', () => {
  const fields: FieldDef[] = [
    { name: 'status', label: 'Statut', type: 'select' },
    { name: 'reason', label: 'Motif', type: 'text', showIf: (v) => v.status === 'retire' },
  ];
  it('en modification, un champ masqué n’est pas effacé (motif « Vendu (TRX-…) » conservé)', () => {
    expect(fromFormValues(fields, { status: 'vendu', reason: 'Vendu (TRX-1)' }, true)).toEqual({ status: 'vendu' });
  });
  it('à la création, un champ masqué reste vide', () => {
    expect(fromFormValues(fields, { status: 'vendu', reason: 'x' }, false)).toEqual({ status: 'vendu', reason: null });
  });
});

describe('liens d’invitation et de réinitialisation', () => {
  it('redirige vers /mot-de-passe en gardant le jeton', () => {
    expect(authRedirectTarget({ pathname: '/', search: '', hash: '#access_token=abc&type=invite' })).toBe('/mot-de-passe#access_token=abc&type=invite');
    expect(authRedirectTarget({ pathname: '/biens', search: '?type=recovery', hash: '' })).toBe('/mot-de-passe?type=recovery');
  });
  it('ne fait rien dans les autres cas', () => {
    expect(authRedirectTarget({ pathname: '/mot-de-passe', search: '', hash: '#type=invite' })).toBeNull();
    expect(authRedirectTarget({ pathname: '/', search: '', hash: '#type=signup' })).toBeNull();
    expect(authRedirectTarget({ pathname: '/biens', search: '?type=terrain', hash: '' })).toBeNull();
  });
});

describe('référencement', () => {
  it('robots.txt : sitemap en URL absolue, pages privées exclues', () => {
    const r = robotsTxt('https://agence.pages.dev/');
    expect(r).toContain('Sitemap: https://agence.pages.dev/sitemap.xml');
    expect(r).toContain('Disallow: /admin');
    expect(robotsTxt(undefined)).not.toContain('Sitemap');
    expect(robotsTxt('/relatif')).not.toContain('Sitemap');
  });
  it('injecte titre, description et Open Graph dans index.html, en échappant le HTML', () => {
    const html = '<html><head><title>Ancien</title><meta name="description" content="générique" /></head><body></body></html>';
    const out = injectMeta(html, { title: 'Villa <b>"luxe"</b>', description: 'Maison à vendre', url: 'https://x.ci/biens/BIEN-1', image: 'https://x.ci/p.jpg', siteName: 'Agence', noindex: true });
    expect(out).not.toContain('Ancien');
    expect(out).not.toContain('générique');
    expect(out).toContain('<title>Villa &lt;b&gt;&quot;luxe&quot;&lt;/b&gt; | Agence</title>');
    expect(out).toContain('<meta property="og:image" content="https://x.ci/p.jpg" />');
    expect(out).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(out.indexOf('og:title')).toBeLessThan(out.indexOf('</head>'));
    expect(escapeHtml(`<'&">`)).toBe('&lt;&#39;&amp;&quot;&gt;');
  });
  it('description d’un bien sans « — » quand le prix manque ; mention fictif', () => {
    expect(propertyDescription({ property_type: 'terrain', title: 'T', reference: 'BIEN-1', price_xof: null, district: 'Angré', city: 'Abidjan' })).toBe('Terrain à vendre à Angré, Abidjan. Réf. BIEN-1.');
    expect(propertyDescription({ property_type: 'maison', title: 'M', reference: 'B2', price_xof: '1000000', city: 'Bouaké', is_demo: true })).toBe('Maison à vendre à Bouaké : 1 000 000 FCFA. Réf. B2. Exemple fictif, non disponible.');
  });
  it('titre de page avec le nom de l’agence, sans répétition', () => {
    expect(fullTitle('Contact', 'Agence X')).toBe('Contact | Agence X');
    expect(fullTitle('Agence X', 'Agence X')).toBe('Agence X');
    expect(fullTitle('Contact', null)).toBe('Contact');
  });
  it('recherche insensible aux accents', () => {
    expect(normalizeSearch('Adjamé ANGRÉ Port-Bouët')).toBe('adjame angre port-bouet');
    expect(normalizeSearch('a,b(c)')).toBe('a b c');
  });
});

describe('PDF', () => {
  it('remplace les caractères hors WinAnsi qui rendraient la ligne illisible', () => {
    expect(pdfSafe('Du 01/10 → 31/10 : 5 − 2 ≤ 4 000')).toBe('Du 01/10 -> 31/10 : 5 - 2 <= 4 000');
    expect(pdfSafe('Côte d’Ivoire « éè » — 100 €')).toBe('Côte d’Ivoire « éè » — 100 €');
    expect(pdfSafe('Emoji 🏠')).toBe('Emoji ??');
  });
});

describe('robustesse', () => {
  it('configuration Supabase invalide détectée sans exception', () => {
    expect(isValidConfig('', 'k')).toBe(false);
    expect(isValidConfig('projet.supabase.co', 'k')).toBe(false);
    expect(isValidConfig('https://votre-projet.supabase.co', 'k')).toBe(false);
    expect(isValidConfig('https://abc.supabase.co', '')).toBe(false);
    expect(isValidConfig('https://abc.supabase.co', 'eyJ')).toBe(true);
  });
  it('numéro de page de l’URL toujours valide', () => {
    expect(pageFromParam('3')).toBe(3);
    for (const v of ['-1', 'abc', '1.5', null, '']) expect(pageFromParam(v)).toBe(0);
  });
  it('reconnaît une erreur de chargement après déploiement', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: /assets/AdminRoutes-x.js'))).toBe(true);
    expect(isChunkLoadError(new Error('Autre'))).toBe(false);
  });
  it('photo : sans réencodage possible, l’envoi est refusé (jamais l’original avec ses métadonnées GPS)', async () => {
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'gps.jpg', { type: 'image/jpeg' });
    await expect(compressImage(file)).rejects.toThrow(/navigateur|illisible|impossible/);
  });
});
