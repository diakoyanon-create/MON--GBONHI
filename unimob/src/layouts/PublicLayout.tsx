import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { usePublicAgency } from '@/api/hooks';
import { whatsappLink } from '@/domain/whatsapp';

const LINKS = [
  { to: '/', label: 'Accueil' },
  { to: '/biens', label: 'Biens à vendre' },
  { to: '/a-propos', label: 'À propos' },
  { to: '/contact', label: 'Contact' },
];

export function PublicLayout() {
  const { data: agency } = usePublicAgency();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  const wa = whatsappLink(agency?.whatsapp_number, null);

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#contenu" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-white focus:p-2">Aller au contenu</a>
      <header className="sticky top-0 z-30 border-b border-ink-800 bg-ink-900/95 text-cream backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/" className="flex min-w-0 items-center gap-2">
            {agency?.logo_url ? <img src={agency.logo_url} alt="" className="h-9 w-9 rounded object-contain" /> : <img src="/icon.svg" alt="" className="h-9 w-9" />}
            <span className="truncate font-display text-lg text-gold-300">{agency?.agency_name ?? 'Agence immobilière'}</span>
          </Link>
          <nav aria-label="Navigation principale" className="hidden md:block">
            <ul className="flex items-center gap-1">
              {LINKS.map((l) => (
                <li key={l.to}>
                  <NavLink to={l.to} end={l.to === '/'} className={({ isActive }) => `rounded-md px-3 py-2 text-sm ${isActive ? 'text-gold-300' : 'text-ink-200 hover:text-white'}`}>{l.label}</NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <button className="btn-ghost btn-sm text-cream hover:bg-ink-800 md:hidden" aria-expanded={open} aria-controls="menu-public" onClick={() => setOpen((o) => !o)}>☰ Menu</button>
        </div>
        {open && (
          <nav id="menu-public" aria-label="Navigation principale" className="border-t border-ink-800 md:hidden">
            <ul className="mx-auto max-w-6xl px-4 py-2">
              {LINKS.map((l) => (
                <li key={l.to}><NavLink to={l.to} end={l.to === '/'} className="block min-h-11 py-3 text-ink-100">{l.label}</NavLink></li>
              ))}
            </ul>
          </nav>
        )}
      </header>
      <main id="contenu" className="flex-1">
        <Outlet />
      </main>
      <footer className="bg-ink-950 text-ink-300">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-3">
          <div>
            <div className="font-display text-lg text-gold-300">{agency?.agency_name}</div>
            {agency?.tagline && <p className="mt-2 text-sm">{agency.tagline}</p>}
          </div>
          <div className="text-sm">
            <div className="mb-2 font-semibold text-cream">Contact</div>
            {agency?.phone && <p><a className="hover:text-white" href={`tel:${agency.phone.replace(/[^\d+]/g, '')}`}>{agency.phone}</a></p>}
            {agency?.email && <p><a className="hover:text-white" href={`mailto:${agency.email}`}>{agency.email}</a></p>}
            {agency?.address && <p>{agency.address}</p>}
          </div>
          <div className="text-sm">
            <div className="mb-2 font-semibold text-cream">Informations</div>
            <ul className="space-y-1">
              <li><Link className="hover:text-white" to="/mentions-legales">Mentions légales</Link></li>
              <li><Link className="hover:text-white" to="/confidentialite">Politique de confidentialité</Link></li>
              <li><Link className="hover:text-white" to="/connexion" rel="nofollow">Espace privé</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-ink-800 py-4 text-center text-xs">© {new Date().getFullYear()} {agency?.agency_name} · Prix en francs CFA (XOF)</div>
      </footer>
      {wa && (
        <a href={wa} target="_blank" rel="noopener noreferrer" className="fixed right-4 bottom-4 z-40 inline-flex min-h-12 items-center gap-2 rounded-full bg-[#1f8f4e] px-4 text-sm font-semibold text-white shadow-lg hover:bg-[#177540]" aria-label="Nous écrire sur WhatsApp">
          WhatsApp
        </a>
      )}
    </div>
  );
}
