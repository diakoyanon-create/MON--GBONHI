// Tests unitaires de la revue adversariale (partie publique, documents privés, session) :
// recherche normalisée comme unaccent en base, fenêtre des documents privés ouverte dans le clic,
// profil rechargé au retour sur l'onglet, PDF, tri du catalogue, balise canonique, injection
// des métadonnées. Le client Supabase est un faux client en mémoire (aucun accès réseau).
import { createElement as h } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, AuthProvider, permissionsFor } from '@/auth/AuthContext';
import { RequireStaff } from '@/auth/RequireStaff';
import { logEvent } from '@/api/crud';
import { catalogParams, fetchCatalog, normalizeSearch, unaccentLower } from '@/api/publicApi';
import { AttachmentField } from '@/components/AttachmentField';
import { PrivateDocuments } from '@/components/PrivateDocuments';
import { escapeHtml, injectMeta } from '@/lib/ogInject';
import { pdfSafe } from '@/lib/pdf';
import { openPrivateFile, POPUP_BLOCKED } from '@/lib/photos';
import { useSeo } from '@/lib/seo';
import { CatalogPage } from '@/pages/public/PublicPages';

type Listener = (event: string, session: unknown) => void;

const fake = vi.hoisted(() => ({
  session: { user: { id: 'u-test' } } as { user: { id: string } } | null,
  profile: null as Record<string, unknown> | null,
  failProfile: false,
  profileReads: 0,
  listeners: new Set<Listener>(),
  download: vi.fn(),
}));

vi.mock('@/lib/supabase', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/supabase')>();
  const supabase = {
    auth: {
      getSession: async () => ({ data: { session: fake.session } }),
      onAuthStateChange: (cb: Listener) => {
        fake.listeners.add(cb);
        return { data: { subscription: { unsubscribe: () => fake.listeners.delete(cb) } } };
      },
      signOut: async () => ({ error: null }),
    },
    // Seule la lecture du profil passe par from() dans ces tests.
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            fake.profileReads++;
            return fake.failProfile ? { data: null, error: { message: 'Failed to fetch' } } : { data: fake.profile, error: null };
          },
        }),
      }),
    }),
    storage: { from: () => ({ download: fake.download }) },
  };
  return { ...orig, supabaseConfigured: true, supabase };
});
vi.mock('@/api/crud', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/crud')>()),
  listRows: vi.fn(async () => ({
    rows: [{ id: 'd1', title: 'Titre foncier (fictif)', doc_type: 'Titre foncier', storage_path: 'biens/p1/doc.pdf', created_at: '2026-10-01T10:00:00Z' }],
    count: 1,
  })),
  logEvent: vi.fn(),
}));
vi.mock('@/api/publicApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/publicApi')>()),
  fetchCatalog: vi.fn(async () => ({ rows: [], count: 0 })),
  fetchPublicCities: vi.fn(async () => ['Abidjan']),
}));
vi.mock('@/api/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/hooks')>()),
  usePublicAgency: () => ({ data: { agency_name: 'Agence Test' }, loading: false, error: null, reload: () => {} }),
}));

/** Laisse s'exécuter les setTimeout(0) et promesses en attente. */
const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 20)));

// ---------------------------------------------------------------------------
// 1. Recherche publique
// ---------------------------------------------------------------------------
describe('recherche : même normalisation que lower(extensions.unaccent(…)) en base', () => {
  // Sorties relevées dans PostgreSQL 16 : select lower(extensions.unaccent($1)).
  const RELEVES: Array<[string, string]> = [
    ['Villa au cœur d’exception « Riviera »', "villa au coeur d'exception << riviera >>"],
    ['ŒUVRE Æsthète Straße ẞ', 'oeuvre aesthete strasse ss'],
    ['Adjamé ANGRÉ Port-Bouët'.normalize('NFD'), 'adjame angre port-bouet'],
    ['L‘Ébène ʼ Ça – 3 pièces — vue mer…', "l'ebene ' ca - 3 pieces - vue mer..."],
    ['Ø ø Ð ð Þ þ Đ đ Ł ł Ħ ı Ĳ ŀ Ŋ ŧ ſ', 'o o d d th th d d l l h i ij l n t s'],
    ['½ ¼ ¾ × ÷ © ® ± ¡ ¿', '1/2 1/4 3/4 * / (c) (r) +/- ! ?'],
  ];
  it('échantillon de chaînes', () => {
    for (const [input, expected] of RELEVES) expect(unaccentLower(input), input).toBe(expected);
  });
  it('Latin-1 et Latin étendu A (U+00A0 à U+017F) : identique au relevé en base', () => {
    const all = Array.from({ length: 0x180 - 0xa0 }, (_, i) => String.fromCharCode(0xa0 + i)).join('');
    expect(unaccentLower(all)).toBe(
      ' !¢£¤¥¦§¨(c)ª<<¬-(r)¯°+/-²³´µ¶·¸¹º>>1/41/23/4?aaaaaaaeceeeeiiiidnooooo*ouuuuythssaaaaaaaeceeeeiiiidnooooo/ouuuuythyaaaaaaccccccccddddeeeeeeeeeegggggggghhhhiiiiiiiiiiijijjjkkqllllllllllnnnnnn\'nnnoooooooeoerrrrrrssssssssttttttuuuuuuuuuuuuwwyyyzzzzzzs',
    );
  });
  it('ponctuation (U+2010 à U+203A) : identique au relevé en base', () => {
    const punct = '‐‑‒–—―‖‗‘’‚‛“”„‟†‡•‣․‥…‧‰‱′″‴‵‶‷‸‹›';
    expect(unaccentLower(punct)).toBe('------||‗\'\',\'"",,"†‡•‣......‧‰‱\'"‴‵‶‷‸<>');
  });
  it('saisie d’un téléphone (œ, apostrophe typographique) : même terme que search_text', () => {
    expect(normalizeSearch('cœur')).toBe('coeur');
    expect(normalizeSearch('d’exception')).toBe("d'exception");
    expect(normalizeSearch('  CŒUR   d’Angré ')).toBe("coeur d'angre");
    // « × » devient « * » (joker de PostgREST) : neutralisé après la conversion.
    expect(normalizeSearch('4 × 4')).toBe('4 4');
  });
});

// ---------------------------------------------------------------------------
// 2. Documents privés
// ---------------------------------------------------------------------------
describe('documents privés : fenêtre ouverte dans le clic, jamais l’onglet de l’application', () => {
  const auth = {
    loading: false, profileError: false, session: { user: { id: 'u' } } as never, profile: null, can: permissionsFor({ role: 'agent', is_active: true }),
    signIn: async () => null, signOut: async () => {}, refreshProfile: async () => {},
  };
  const originalOpen = window.open;
  let win: { location: { href: string }; close: ReturnType<typeof vi.fn> };
  let open: ReturnType<typeof vi.fn>;
  const renderDocs = () => render(h(AuthContext.Provider, { value: auth }, h(PrivateDocuments, { propertyId: 'p1' })));

  beforeEach(() => {
    win = { location: { href: '' }, close: vi.fn() };
    open = vi.fn(() => win);
    window.open = open as never;
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:document-fictif'), revokeObjectURL: vi.fn() });
    fake.download.mockReset().mockResolvedValue({ data: new Blob(['%PDF-1.4']), error: null });
    vi.mocked(logEvent).mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => {
    window.open = originalOpen;
  });

  it('la fenêtre est ouverte avant l’appel réseau du journal, puis reçoit le document', async () => {
    let release!: () => void;
    vi.mocked(logEvent).mockImplementation(() => new Promise<void>((r) => { release = r; }));
    renderDocs();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Ouvrir' }));
    // Journal encore en attente : la fenêtre est déjà ouverte (activation utilisateur conservée).
    expect(open).toHaveBeenCalledWith('', '_blank');
    expect(open.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(logEvent).mock.invocationCallOrder[0]);
    expect(fake.download).not.toHaveBeenCalled();
    await act(async () => release());
    await waitFor(() => expect(win.location.href).toBe('blob:document-fictif'));
    expect(win.close).not.toHaveBeenCalled();
  });

  it('pop-up bloqué : message clair, l’onglet de l’application ne quitte pas la page', async () => {
    open.mockReturnValue(null);
    const before = window.location.href;
    renderDocs();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Ouvrir' }));
    expect(await screen.findByText(POPUP_BLOCKED)).toBeInTheDocument();
    expect(POPUP_BLOCKED).toMatch(/^Autorisez les fenêtres pop-up/);
    expect(logEvent).not.toHaveBeenCalled();
    expect(fake.download).not.toHaveBeenCalled();
    expect(window.location.href).toBe(before);
  });

  it('échec du journal : la fenêtre ouverte est refermée', async () => {
    vi.mocked(logEvent).mockRejectedValue(new Error('Action non autorisée pour votre rôle.'));
    renderDocs();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Ouvrir' }));
    expect(await screen.findByText('Action non autorisée pour votre rôle.')).toBeInTheDocument();
    expect(win.close).toHaveBeenCalled();
    expect(fake.download).not.toHaveBeenCalled();
  });

  it('openPrivateFile sans fenêtre fournie (justificatifs) : ouvre dans le clic, erreur si bloquée', async () => {
    open.mockReturnValueOnce(null);
    await expect(openPrivateFile('finance-receipts', 'depenses/e1/recu.pdf')).rejects.toThrow(POPUP_BLOCKED);
    expect(fake.download).not.toHaveBeenCalled();
    // Téléchargement impossible : la fenêtre ouverte est refermée.
    fake.download.mockResolvedValueOnce({ data: null, error: new Error('Object not found') });
    await expect(openPrivateFile('private-documents', 'biens/p1/absent.pdf')).rejects.toThrow('Object not found');
    expect(win.close).toHaveBeenCalledTimes(1);
  });

  it('AttachmentField : pop-up bloqué signalé, la page reste en place', async () => {
    open.mockReturnValue(null);
    const before = window.location.href;
    render(h(AttachmentField, {
      table: 'expenses', id: 'e1', bucket: 'finance-receipts', column: 'receipt_path', label: 'Justificatif',
      folder: 'depenses', currentPath: 'depenses/e1/recu.pdf', editable: false, onSaved: () => {},
    }));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Ouvrir le fichier joint' }));
    expect(await screen.findByText(POPUP_BLOCKED)).toBeInTheDocument();
    expect(window.location.href).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// 3. Profil rechargé pour le même utilisateur
// ---------------------------------------------------------------------------
describe('session : profil rechargé au retour sur l’onglet (SIGNED_IN), pas au rafraîchissement du jeton', () => {
  const emit = (event: string) => act(() => { for (const l of fake.listeners) l(event, fake.session); });
  const Espace = () => h('input', { 'aria-label': 'Note' });

  beforeEach(() => {
    fake.session = { user: { id: 'u-test' } };
    fake.profile = { id: 'u-test', full_name: 'Awa Test', email: 'awa@test.invalid', role: null, is_active: false };
    fake.failProfile = false;
    fake.profileReads = 0;
  });

  it('activation, coupure réseau puis désactivation, sans recharger la page', async () => {
    const user = userEvent.setup();
    render(h(AuthProvider, null, h(MemoryRouter, { initialEntries: ['/admin'] },
      h(Routes, null, h(Route, { path: '/admin', element: h(RequireStaff, null, h(Espace)) })))));
    expect(await screen.findByText('Accès non autorisé')).toBeInTheDocument();

    // Compte pas encore activé : « Vérifier à nouveau » indique qu'il est toujours en attente…
    await user.click(screen.getByRole('button', { name: 'Vérifier à nouveau' }));
    expect(await screen.findByText('Compte toujours en attente d’activation.')).toBeInTheDocument();
    // … puis donne accès dès que l'administrateur l'a activé.
    fake.profile = { ...fake.profile, role: 'agent', is_active: true };
    await user.click(screen.getByRole('button', { name: 'Vérifier à nouveau' }));
    await user.type(await screen.findByLabelText('Note'), 'brouillon');

    // Rafraîchissement horaire du jeton : le profil est relu ; inchangé, rien n'est démonté.
    const reads = fake.profileReads;
    await emit('TOKEN_REFRESHED');
    await flush();
    expect(fake.profileReads).toBe(reads + 1);
    expect(screen.getByLabelText('Note')).toHaveValue('brouillon');

    // Retour sur l'onglet pendant une coupure réseau : profil conservé, rien n'est démonté.
    fake.profile = { ...fake.profile, is_active: false };
    fake.failProfile = true;
    await emit('SIGNED_IN');
    await flush();
    expect(fake.profileReads).toBe(reads + 2);
    expect(screen.getByLabelText('Note')).toHaveValue('brouillon');

    // Réseau rétabli : la désactivation est prise en compte dès le rafraîchissement suivant du jeton
    // (seul événement émis au retour sur l'onglet après une longue absence).
    fake.failProfile = false;
    await emit('TOKEN_REFRESHED');
    expect(await screen.findByText('Accès non autorisé')).toBeInTheDocument();
    expect(screen.queryByLabelText('Note')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 4. PDF
// ---------------------------------------------------------------------------
describe('pdfSafe', () => {
  it('recompose les accents décomposés (NFD) au lieu de « e? »', () => {
    expect(pdfSafe('Adjamé / Angré'.normalize('NFD'))).toBe('Adjamé / Angré');
  });
  it('retire les caractères de contrôle C1 (U+0080 à U+009F)', () => {
    expect(pdfSafe('a\u0080b\u0092c\u009fd')).toBe('abcd');
  });
  it('garde les caractères WinAnsi utiles', () => {
    expect(pdfSafe('L’œuvre – 1 500 € — fin…')).toBe('L’œuvre – 1 500 € — fin…');
    expect(pdfSafe('Œ Š Ž “x” ‘y’ • ‰ ™')).toBe('Œ Š Ž “x” ‘y’ • ‰ ™');
    expect(pdfSafe('a → b ≤ c ✓ 漢')).toBe('a -> b <= c oui ?');
  });
});

// ---------------------------------------------------------------------------
// 5. Catalogue : le tri applique aussi les filtres saisis
// ---------------------------------------------------------------------------
describe('catalogue : changer le tri ne perd pas les filtres saisis', () => {
  it('catalogParams : même conversion pour « Filtrer » et le tri', () => {
    expect(catalogParams({ district: 'Riviera', maxPrice: '50000000', sort: 'prix-asc', type: '', q: '' }).toString())
      .toBe('quartier=Riviera&prix_max=50000000&tri=prix-asc');
    expect(catalogParams({ city: 'Abidjan', sort: 'recent' }).toString()).toBe('ville=Abidjan');
  });

  it('saisie non validée puis « Prix croissant » : filtres appliqués et champs conservés', async () => {
    const Probe = () => h('output', { 'aria-label': 'URL' }, useLocation().search);
    render(h(MemoryRouter, { initialEntries: ['/biens?page=2&chambres=3'] },
      h(Routes, null, h(Route, { path: '/biens', element: h('div', null, h(CatalogPage), h(Probe)) }))));
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Quartier'), 'Riviera');
    await user.type(screen.getByLabelText('Budget max. (FCFA)'), '50000000');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Trier' }), 'prix-asc');

    const search = new URLSearchParams(screen.getByLabelText('URL').textContent ?? '');
    expect(Object.fromEntries(search)).toEqual({ chambres: '3', quartier: 'Riviera', prix_max: '50000000', tri: 'prix-asc' });
    await flush();
    expect(screen.getByLabelText('Quartier')).toHaveValue('Riviera');
    expect(screen.getByLabelText('Budget max. (FCFA)')).toHaveValue('50000000');
    expect(vi.mocked(fetchCatalog)).toHaveBeenLastCalledWith(expect.objectContaining({ district: 'Riviera', maxPrice: '50000000', bedrooms: '3', sort: 'prix-asc' }), 0);
  });
});

// ---------------------------------------------------------------------------
// 6. Balise canonique suivie pendant la navigation interne
// ---------------------------------------------------------------------------
describe('useSeo : link[rel=canonical]', () => {
  const Page = ({ title }: { title: string }) => {
    useSeo({ title });
    return null;
  };
  const canonicals = () => document.head.querySelectorAll<HTMLLinkElement>('link[rel="canonical"]');
  beforeEach(() => canonicals().forEach((l) => l.remove()));
  afterEach(() => {
    window.history.replaceState(null, '', '/');
    canonicals().forEach((l) => l.remove());
  });

  it('remplace la canonique injectée pour la première fiche, puis la suit à chaque page', () => {
    // Balise injectée côté serveur pour la fiche ouverte depuis WhatsApp.
    const injected = document.createElement('link');
    injected.rel = 'canonical';
    injected.href = `${window.location.origin}/biens/BIEN-2026-00001`;
    document.head.appendChild(injected);

    window.history.pushState(null, '', '/biens/BIEN-2026-00003?source=whatsapp');
    const { rerender } = render(h(Page, { title: 'Villa' }));
    expect(canonicals()).toHaveLength(1);
    expect(canonicals()[0].href).toBe(`${window.location.origin}/biens/BIEN-2026-00003`);
    expect(document.head.querySelector('meta[property="og:url"]')?.getAttribute('content')).toBe(window.location.href);

    // Autre page de même titre : la canonique suit quand même l'adresse.
    window.history.pushState(null, '', '/contact');
    rerender(h(Page, { title: 'Villa' }));
    expect(canonicals()).toHaveLength(1);
    expect(canonicals()[0].href).toBe(`${window.location.origin}/contact`);
  });

  it('crée la balise si la page n’en a pas', () => {
    window.history.pushState(null, '', '/biens?tri=prix-asc');
    render(h(Page, { title: 'Biens à vendre' }));
    expect(canonicals()).toHaveLength(1);
    expect(canonicals()[0].href).toBe(`${window.location.origin}/biens`);
  });

  it('fiche ouverte en minuscules ou avec une barre finale : même canonique que le serveur', () => {
    const Fiche = () => {
      useSeo({ title: 'Villa', path: '/biens/BIEN-2026-00001' });
      return null;
    };
    for (const url of ['/biens/bien-2026-00001', '/biens/BIEN-2026-00001/']) {
      window.history.pushState(null, '', url);
      const { unmount } = render(h(Fiche));
      expect(canonicals()).toHaveLength(1);
      expect(canonicals()[0].href).toBe(`${window.location.origin}/biens/BIEN-2026-00001`);
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Métadonnées injectées : motifs « $ » littéraux
// ---------------------------------------------------------------------------
describe('injectMeta : un titre contenant $` $& $\' $$ reste littéral', () => {
  const html = [
    '<!doctype html>', '<html lang="fr">', '  <head>', '    <meta charset="UTF-8" />', '    <title>Agence</title>',
    '    <meta name="description" content="Générique" />', '    <script type="module" crossorigin src="/assets/index-abc.js"></script>',
    '  </head>', '  <body><div id="root"></div></body>', '</html>',
  ].join('\n');
  const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

  for (const motif of ['$`', '$&', "$'", '$$', '$1', '$<x>']) {
    it(`motif ${motif}`, () => {
      const title = `Villa 4 pièces Promo${motif} Cocody`;
      const description = `Description ${motif} fin`;
      const out = injectMeta(html, { title, description, url: 'https://exemple.test/biens/BIEN-2026-00001', siteName: 'Agence Test' });
      expect(count(out, /<head>/g)).toBe(1);
      expect(count(out, /<\/head>/g)).toBe(1);
      expect(count(out, /<title>/g)).toBe(1);
      expect(count(out, /<!doctype html>/gi)).toBe(1);
      expect(count(out, /<script /g)).toBe(1);
      const full = escapeHtml(`${title} | Agence Test`);
      expect(out).toContain(`<title>${full}</title>`);
      expect(out).toContain(`<meta property="og:title" content="${full}" />`);
      expect(out).toContain(`<meta name="description" content="${escapeHtml(description)}" />`);
      expect(out).not.toContain('Générique');
    });
  }
});
