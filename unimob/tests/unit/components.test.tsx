import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext, permissionsFor, type Profile } from '@/auth/AuthContext';
import { RequireStaff } from '@/auth/RequireStaff';
import { fromFormValues, toFormValues, validate } from '@/resources/values';
import type { FieldDef } from '@/resources/types';
import { passwordProblem } from '@/pages/auth/LoginPage';
import { sanitizeSearch } from '@/api/crud';

vi.mock('@/api/publicApi', () => ({ submitInquiry: vi.fn(async () => ({ ok: true, reference: 'DEM-2026-00099' })) }));
vi.mock('@/api/hooks', async (orig) => ({ ...(await orig<typeof import('@/api/hooks')>()), usePublicAgency: () => ({ data: null, loading: false, error: null, reload: () => {} }) }));

function withAuth(profile: Profile | null, session: boolean, ui: React.ReactNode, path = '/admin') {
  const value = {
    loading: false, profileError: false, session: session ? ({ user: { id: 'u' } } as never) : null, profile, can: permissionsFor(profile),
    signIn: async () => null, signOut: async () => {}, refreshProfile: async () => {},
  };
  return render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/connexion" element={<div>Page de connexion</div>} />
          <Route path="/admin" element={ui} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe('permissions (miroir des fonctions SQL)', () => {
  it('applique le moindre privilège', () => {
    expect(permissionsFor({ role: 'agent', is_active: true })).toEqual({ staff: true, admin: false, sales: true, negotiate: true, finance: false });
    expect(permissionsFor({ role: 'assistant', is_active: true })).toMatchObject({ sales: true, negotiate: false, finance: false });
    expect(permissionsFor({ role: 'comptable', is_active: true })).toMatchObject({ sales: false, finance: true });
    expect(permissionsFor({ role: 'admin', is_active: false })).toMatchObject({ staff: false, admin: false });
    expect(permissionsFor(null).staff).toBe(false);
  });
});

describe('RequireStaff', () => {
  it('redirige un visiteur vers la connexion', () => {
    withAuth(null, false, <RequireStaff><div>Secret</div></RequireStaff>);
    expect(screen.getByText('Page de connexion')).toBeInTheDocument();
    expect(screen.queryByText('Secret')).not.toBeInTheDocument();
  });
  it('bloque un compte non activé', () => {
    withAuth({ id: 'u', full_name: '', email: 'x@y.z', role: null, is_active: false }, true, <RequireStaff><div>Secret</div></RequireStaff>);
    expect(screen.getByText('Accès non autorisé')).toBeInTheDocument();
    expect(screen.queryByText('Secret')).not.toBeInTheDocument();
  });
  it('bloque une section non autorisée pour le rôle', () => {
    withAuth({ id: 'u', full_name: 'A', email: null, role: 'agent', is_active: true }, true, <RequireStaff need="finance"><div>Finances</div></RequireStaff>);
    expect(screen.getByText('Accès réservé')).toBeInTheDocument();
  });
  it('laisse passer le rôle autorisé', () => {
    withAuth({ id: 'u', full_name: 'A', email: null, role: 'comptable', is_active: true }, true, <RequireStaff need="finance"><div>Finances</div></RequireStaff>);
    expect(screen.getByText('Finances')).toBeInTheDocument();
  });
});

describe('conversion des formulaires', () => {
  const fields: FieldDef[] = [
    { name: 'title', label: 'Titre', type: 'text', required: true },
    { name: 'price', label: 'Prix', type: 'money', min: 0 },
    { name: 'rooms', label: 'Pièces', type: 'number', max: 10 },
    { name: 'when', label: 'Quand', type: 'datetime' },
    { name: 'tags', label: 'Tags', type: 'tags' },
    { name: 'ok', label: 'OK', type: 'boolean' },
    { name: 'email', label: 'Courriel', type: 'email' },
    { name: 'secret', label: 'Masqué', type: 'text', showIf: (v) => v.ok === true },
  ];
  it('convertit chaînes → types SQL (vide = null, montants entiers, dates UTC)', () => {
    const v = toFormValues(fields, null, { ok: false });
    v.title = '  Villa  ';
    v.price = '120 000 000';
    v.when = '2026-10-20T10:00';
    v.tags = ['Jardin', ' '];
    v.secret = 'ne doit pas partir';
    expect(fromFormValues(fields, v, false)).toEqual({
      title: 'Villa', price: 120000000, rooms: null, when: '2026-10-20T10:00:00.000Z', tags: ['Jardin'], ok: false, email: null, secret: null,
    });
  });
  it('relit une ligne existante', () => {
    const v = toFormValues(fields, { title: 'A', price: '5000', rooms: null, when: '2026-10-20T10:00:00+00:00', tags: null, ok: true, email: null, secret: 's' });
    expect(v).toMatchObject({ title: 'A', price: '5000', rooms: '', when: '2026-10-20T10:00', tags: [], ok: true, secret: 's' });
  });
  it('valide obligatoires, bornes, montants entiers et courriel', () => {
    const errs = validate(fields, { title: '', price: '10.5', rooms: '11', email: 'bad', tags: [], ok: false, when: '' });
    expect(errs).toMatchObject({ title: 'Champ obligatoire', price: 'Montant invalide (ex. 150000 ou 150 000)', rooms: 'Maximum 10', email: 'Adresse électronique invalide' });
  });
});

describe('sécurité côté interface', () => {
  it('neutralise les caractères spéciaux des filtres PostgREST', () => {
    expect(sanitizeSearch('a,b.or(id.eq.1)*%')).toBe('a b.or id.eq.1');
    expect(sanitizeSearch('x'.repeat(200))).toHaveLength(80);
  });
  it('exige un mot de passe robuste', () => {
    expect(passwordProblem('court1', 'court1')).toMatch(/12 caractères/);
    expect(passwordProblem('seulementdeslettres', 'seulementdeslettres')).toMatch(/chiffres/);
    expect(passwordProblem('motdepasse1234', 'autre')).toMatch(/correspondent/);
    expect(passwordProblem('motdepasse1234', 'motdepasse1234')).toBeNull();
  });
});

describe('formulaire public', () => {
  it('affiche les erreurs puis confirme l’envoi', async () => {
    const { InquiryForm } = await import('@/components/InquiryForm');
    const { submitInquiry } = await import('@/api/publicApi');
    render(<MemoryRouter><InquiryForm propertyReference="BIEN-2026-00001" /></MemoryRouter>);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Envoyer ma demande' }));
    expect(await screen.findByText('Indiquez votre nom')).toBeInTheDocument();
    expect(submitInquiry).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Nom complet *'), 'Awa Test');
    await user.type(screen.getByLabelText('Téléphone *'), '+225 07 00 00 00 00');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Envoyer ma demande' }));
    expect(await screen.findByText(/DEM-2026-00099/)).toBeInTheDocument();
    expect(submitInquiry).toHaveBeenCalledWith(expect.objectContaining({ full_name: 'Awa Test', property_reference: 'BIEN-2026-00001', consent: true, email: null }));
  });
});
