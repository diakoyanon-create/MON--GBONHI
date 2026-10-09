import { useEffect } from 'react';

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

/** Titre, description, Open Graph et directive robots de la page courante. */
export function useSeo({ title, description, image, noindex, siteName }: Seo) {
  useEffect(() => {
    const full = siteName ? `${title} | ${siteName}` : title;
    document.title = full;
    setMeta('name', 'description', description ?? null);
    setMeta('property', 'og:title', full);
    setMeta('property', 'og:description', description ?? null);
    setMeta('property', 'og:type', 'website');
    setMeta('property', 'og:image', image ? new URL(image, window.location.origin).toString() : null);
    setMeta('property', 'og:url', window.location.href);
    setMeta('name', 'robots', noindex ? 'noindex, nofollow' : null);
  }, [title, description, image, noindex, siteName]);
}
