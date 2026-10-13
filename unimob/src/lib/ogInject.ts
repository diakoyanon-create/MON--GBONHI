// Injection des métadonnées d'une page dans index.html, côté serveur (Cloudflare Pages Function).
// Les robots de WhatsApp, Facebook ou LinkedIn n'exécutent pas le JavaScript : sans cela,
// l'aperçu d'une annonce partagée serait générique et sans photo.

export type PageMeta = {
  title: string;
  description: string;
  url: string;
  image?: string | null;
  siteName?: string | null;
  noindex?: boolean;
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

export function injectMeta(html: string, m: PageMeta): string {
  const title = m.siteName ? `${m.title} | ${m.siteName}` : m.title;
  const tags = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(m.description)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(m.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(m.url)}" />`,
    m.siteName ? `<meta property="og:site_name" content="${escapeHtml(m.siteName)}" />` : '',
    m.image ? `<meta property="og:image" content="${escapeHtml(m.image)}" />` : '',
    m.image ? `<meta name="twitter:card" content="summary_large_image" />` : `<meta name="twitter:card" content="summary" />`,
    m.noindex ? `<meta name="robots" content="noindex, nofollow" />` : '',
    `<link rel="canonical" href="${escapeHtml(m.url)}" />`,
  ].filter(Boolean).join('\n    ');
  // Fonction de remplacement : une chaîne serait interprétée ($&, $`, $' ou $$ d'un titre
  // recopieraient « </head> » ou tout le début du document dans les balises).
  return html
    .replace(/<title>[\s\S]*?<\/title>/i, '')
    .replace(/<meta\s+name="description"[^>]*>/i, '')
    .replace(/<\/head>/i, () => `    ${tags}\n  </head>`);
}
