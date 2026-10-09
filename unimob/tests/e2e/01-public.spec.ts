import { expect, test } from '@playwright/test';
import { sql, state } from './helpers';

test.describe('Site public', () => {
  test('accueil : biens publiés, mention « fictif », pas de lien vers des données privées', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Biens récents et à la une' })).toBeVisible();
    const cards = page.locator('article');
    await expect(cards.first()).toBeVisible();
    await expect(page.getByText('Exemple fictif').first()).toBeVisible();
    await expect(page.getByText(/ne sont pas disponibles à la vente/)).toBeVisible();
    // Aucun bien non publié (seed : 2 biens « à vérifier »)
    await expect(page.getByText('Terrain 1000 m² proche plage')).toHaveCount(0);
  });

  test('catalogue : filtre par type et par budget, pagination', async ({ page }) => {
    await page.goto('/biens');
    await expect(page.getByText(/\d+ biens?/)).toBeVisible();
    await page.getByLabel('Type').selectOption('terrain');
    await page.getByRole('button', { name: 'Filtrer' }).click();
    await expect(page).toHaveURL(/type=terrain/);
    const titles = await page.locator('article h3').allTextContents();
    expect(titles.length).toBeGreaterThan(0);
    for (const t of titles) expect(t.toLowerCase()).toContain('terrain');

    await page.getByRole('button', { name: 'Réinitialiser' }).click();
    await page.getByLabel('Budget max. (FCFA)').fill('30000000');
    await page.getByRole('button', { name: 'Filtrer' }).click();
    await expect(page.locator('article')).toHaveCount(1);
    await expect(page.locator('article')).toContainText('25 000 000 FCFA');
  });

  test('fiche bien : informations publiques, WhatsApp, aucune donnée du propriétaire', async ({ page }) => {
    await page.goto('/biens/BIEN-2026-00003');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Appartement 3 pièces');
    await expect(page.getByText('48 000 000 FCFA').first()).toBeVisible();
    await expect(page.getByText('Réf. BIEN-2026-00003')).toBeVisible();
    const body = await page.locator('body').innerText();
    expect(body).not.toContain('KONE-DEMO'); // nom du propriétaire fictif
    expect(body).not.toContain('00 00 00 00 02'); // téléphone du propriétaire
    // Le bouton WhatsApp flottant contient le numéro configuré
    await expect(page.getByRole('link', { name: 'Nous écrire sur WhatsApp' })).toHaveAttribute('href', /wa\.me\/2250000000000/);
  });

  test('un bien non publié renvoie « plus en ligne »', async ({ page }) => {
    await page.goto('/biens/BIEN-2026-00005');
    await expect(page.getByText(/n’est plus en ligne/)).toBeVisible();
  });

  test('formulaire de demande : validation puis envoi enregistré', async ({ page }) => {
    await page.goto('/biens/BIEN-2026-00002');
    const form = page.locator('aside form');
    await form.getByRole('button', { name: 'Envoyer ma demande' }).click();
    await expect(form.getByText('Indiquez votre nom')).toBeVisible();
    await expect(form.getByText('Numéro de téléphone invalide')).toBeVisible();
    await expect(form.getByText(/Votre accord est nécessaire/)).toBeVisible();

    await form.getByLabel('Nom complet *').fill('Kouadio Test E2E');
    await form.getByLabel('Téléphone *').fill('+225 07 12 34 56 78');
    await form.getByText('WhatsApp', { exact: true }).click();
    await form.getByRole('checkbox').check();
    await form.getByRole('button', { name: 'Envoyer ma demande' }).click();
    await expect(page.getByText(/votre demande a bien été envoyée \(n° DEM-/)).toBeVisible();

    const [row] = await sql(`select i.status, i.contact_preference, p.reference from inquiries i join properties p on p.id = i.property_id where i.full_name = 'Kouadio Test E2E'`);
    expect(row).toEqual({ status: 'nouveau', contact_preference: 'whatsapp', reference: 'BIEN-2026-00002' });
  });

  test('accès direct à l’API : un visiteur ne lit pas les demandes ni les propriétaires', async ({ request }) => {
    const { url, anonKey } = state();
    const headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}` };
    for (const table of ['inquiries', 'owners', 'buyers', 'financial_entries', 'activity_logs', 'property_documents']) {
      const r = await request.get(`${url}/rest/v1/${table}?select=*`, { headers });
      expect(r.status(), table).toBe(401);
    }
    const ok = await request.get(`${url}/rest/v1/public_properties?select=reference`, { headers });
    expect(ok.status()).toBe(200);
    // Écriture directe dans la table refusée, même avec des données valides
    const ins = await request.post(`${url}/rest/v1/inquiries`, { headers: { ...headers, 'Content-Type': 'application/json' }, data: { full_name: 'Pirate', phone: '0102030405', message: 'Bonjour test' } });
    expect(ins.status()).toBe(401);
  });

  test('SEO : titre, description, robots.txt et pages privées non indexées', async ({ page, request }) => {
    await page.goto('/biens/BIEN-2026-00003');
    await expect(page).toHaveTitle(/Appartement 3 pièces/);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /Appartement/);
    const robots = await (await request.get('/robots.txt')).text();
    expect(robots).toContain('Disallow: /admin');
    await page.goto('/connexion');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  });
});
