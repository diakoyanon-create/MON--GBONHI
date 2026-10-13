import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth, type Permissions } from '@/auth/AuthContext';
import { ROLES, label } from '@/domain/labels';
import { useSeo } from '@/lib/seo';

type NavItem = { to: string; label: string; need?: keyof Permissions };
const NAV: Array<{ group: string; items: NavItem[] }> = [
  { group: 'Pilotage', items: [{ to: '/admin', label: 'Tableau de bord' }, { to: '/admin/taches', label: 'Tâches' }] },
  {
    group: 'Portefeuille',
    items: [
      { to: '/admin/biens', label: 'Biens', need: 'sales' },
      { to: '/admin/proprietaires', label: 'Propriétaires', need: 'sales' },
      { to: '/admin/mandats', label: 'Mandats', need: 'sales' },
    ],
  },
  {
    group: 'Commercial',
    items: [
      { to: '/admin/demandes', label: 'Demandes', need: 'sales' },
      { to: '/admin/acheteurs', label: 'Acheteurs', need: 'sales' },
      { to: '/admin/visites', label: 'Visites', need: 'sales' },
      { to: '/admin/transactions', label: 'Négociations', need: 'sales' },
    ],
  },
  {
    group: 'Gestion',
    items: [
      { to: '/admin/finances', label: 'Finances', need: 'finance' },
      { to: '/admin/documents', label: 'Documents', need: 'staff' },
      { to: '/admin/rapports', label: 'Rapports', need: 'staff' },
    ],
  },
  {
    group: 'Administration',
    items: [
      { to: '/admin/parametres', label: 'Paramètres', need: 'admin' },
      { to: '/admin/utilisateurs', label: 'Utilisateurs', need: 'admin' },
      { to: '/admin/journal', label: 'Journal d’activité', need: 'admin' },
    ],
  },
];

export function AdminLayout() {
  const { profile, can, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useSeo({ title: 'Espace privé', noindex: true });
  useEffect(() => setOpen(false), [location.pathname]);

  const nav = (
    <nav aria-label="Navigation de l’espace privé" className="space-y-5">
      {NAV.map((g) => {
        const items = g.items.filter((i) => !i.need || can[i.need] || (i.to === '/admin/transactions' && can.finance));
        if (!items.length) return null;
        return (
          <div key={g.group}>
            <div className="px-3 text-[11px] font-semibold tracking-wider text-ink-500 uppercase">{g.group}</div>
            <ul className="mt-1 space-y-0.5">
              {items.map((i) => (
                <li key={i.to}>
                  <NavLink
                    to={i.to}
                    end={i.to === '/admin'}
                    className={({ isActive }) =>
                      `flex min-h-10 items-center rounded-lg px-3 text-sm ${isActive ? 'bg-ink-800 text-gold-300' : 'text-ink-200 hover:bg-ink-800 hover:text-white'}`
                    }
                  >
                    {i.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen lg:flex">
      {/* Barre supérieure mobile */}
      <header className="sticky top-0 z-30 flex items-center justify-between bg-ink-900 px-4 py-3 text-cream lg:hidden">
        <button className="btn-ghost btn-sm text-cream hover:bg-ink-800" aria-expanded={open} aria-controls="admin-nav" onClick={() => setOpen((o) => !o)}>
          ☰ Menu
        </button>
        <span className="font-display text-gold-300">Espace privé</span>
      </header>
      <aside
        id="admin-nav"
        className={`${open ? 'block' : 'hidden'} fixed inset-x-0 top-[52px] bottom-0 z-20 overflow-y-auto bg-ink-900 p-4 lg:sticky lg:top-0 lg:block lg:h-screen lg:w-64 lg:shrink-0`}
      >
        <div className="mb-6 hidden px-3 lg:block">
          <div className="font-display text-lg text-gold-300">Espace privé</div>
        </div>
        {nav}
        <div className="mt-6 border-t border-ink-700 px-3 pt-4 text-sm text-ink-300">
          <div className="truncate text-cream">{profile?.full_name || profile?.email}</div>
          <div className="text-xs">{label(ROLES, profile?.role)}</div>
          <div className="mt-3 flex gap-2">
            <NavLink to="/" className="btn-ghost btn-sm text-ink-200 hover:bg-ink-800">Site public</NavLink>
            <button className="btn-ghost btn-sm text-ink-200 hover:bg-ink-800" onClick={() => void signOut()}>Déconnexion</button>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <Outlet />
      </main>
    </div>
  );
}
