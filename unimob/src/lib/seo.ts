import { useEffect } from 'react';
import { usePublicAgency } from '@/api/hooks';

type Seo = { title: string; description?: string; image?: string | null; noindex?: boolean; siteName?: string; path?: string };

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

/**
 * Adresse canonique de la page courante (sans paramètres). La balise injectée côté serveur
 * pour une fiche de bien doit suivre la navigation interne : Chrome sur Android partage
 * l'URL canonique, qui désignerait sinon la première annonce ouverte.
 */
function setCanonical(href: string) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement('link');
    el.rel = 'canonical';
    document.head.appendChild(el);
  }
  el.href = href;
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
/** path : chemin canonique imposé (fiche d'un bien : référence en majuscules, comme le sitemap et la Function). */
export function useSeo({ title, description, image, noindex, siteName, path }: Seo) {
  const { data: agency } = usePublicAgency();
  const name = siteName ?? agency?.agency_name;
  // Adresse lue au rendu : deux fiches de même titre doivent tout de même mettre à jour og:url et la canonique.
  const href = window.location.href;
  useEffect(() => {
    const full = fullTitle(title, name);
    document.title = full;
    setMeta('name', 'description', description ?? null);
    setMeta('property', 'og:title', full);
    setMeta('property', 'og:description', description ?? null);
    setMeta('property', 'og:type', 'website');
    setMeta('property', 'og:site_name', name ?? null);
    setMeta('property', 'og:image', image ? new URL(image, window.location.origin).toString() : null);
    setMeta('property', 'og:url', href);
    const url = new URL(href);
    setCanonical(url.origin + (path ?? url.pathname));
    setMeta('name', 'robots', noindex ? 'noindex, nofollow' : null);
  }, [title, description, image, noindex, name, href, path]);
}
