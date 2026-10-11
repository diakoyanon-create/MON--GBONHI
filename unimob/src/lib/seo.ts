import { useEffect } from 'react';
import { usePublicAgency } from '@/api/hooks';

type Seo = { title: string; description?: string; image?: string | null; noindex?: boolean; siteName?: string };

function setMeta(attr: 'name' | 'property', key: string, content: string | null) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!content) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

/** Titre complet « Page | Agence » (sans répétition si la page porte déjà le nom de l'agence). */
export function fullTitle(title: string, siteName?: string | null): string {
  if (!siteName || title === siteName || title.endsWith(`| ${siteName}`)) return title;
  return `${title} | ${siteName}`;
}

/**
 * Titre, description, Open Graph et directive robots de la page courante (navigation dans l'application).
 * Les robots des réseaux sociaux reçoivent en plus des balises injectées côté serveur
 * pour les fiches de biens (functions/biens/[reference].ts).
 */
export function useSeo({ title, description, image, noindex, siteName }: Seo) {
  const { data: agency } = usePublicAgency();
  const name = siteName ?? agency?.agency_name;
  useEffect(() => {
    const full = fullTitle(title, name);
    document.title = full;
    setMeta('name', 'description', description ?? null);
    setMeta('property', 'og:title', full);
    setMeta('property', 'og:description', description ?? null);
    setMeta('property', 'og:type', 'website');
    setMeta('property', 'og:site_name', name ?? null);
    setMeta('property', 'og:image', image ? new URL(image, window.location.origin).toString() : null);
    setMeta('property', 'og:url', window.location.href);
    setMeta('name', 'robots', noindex ? 'noindex, nofollow' : null);
  }, [title, description, image, noindex, name]);
}
