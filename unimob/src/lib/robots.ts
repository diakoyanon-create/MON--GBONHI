/** Contenu de robots.txt. Le protocole exige une URL ABSOLUE pour la directive Sitemap. */
export function robotsTxt(siteUrl?: string | null): string {
  const lines = ['User-agent: *', 'Allow: /', 'Disallow: /admin', 'Disallow: /connexion', 'Disallow: /mot-de-passe', 'Disallow: /mot-de-passe-oublie'];
  const base = (siteUrl ?? '').trim().replace(/\/+$/, '');
  if (/^https?:\/\/[^/]+/.test(base)) lines.push(`Sitemap: ${base}/sitemap.xml`);
  return lines.join('\n') + '\n';
}
