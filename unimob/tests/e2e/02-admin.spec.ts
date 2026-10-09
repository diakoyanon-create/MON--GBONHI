import { expect, test, type Page } from '@playwright/test';
import { field, login, selectOptionContaining, sql, state } from './helpers';

test.describe.configure({ mode: 'serial' });

test.describe('Authentification et accès', () => {
  test('un visiteur non connecté est redirigé vers la connexion', async ({ page }) => {
    await page.goto('/admin/biens');
    await expect(page).toHaveURL(/\/connexion$/);
  });

  test('identifiants incorrects : message clair', async ({ page }) => {
    await page.goto('/connexion');
    await page.getByLabel('Adresse électronique').fill('admin@e2e.test');
    await page.getByLabel('Mot de passe').fill('mauvais-mot-de-passe');
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.getByText('Identifiants incorrects.')).toBeVisible();
  });

  test('un compte sans rôle ne voit aucune donnée privée', async ({ page }) => {
    await login(page, 'sans_role');
    await expect(page.getByRole('heading', { name: 'Accès non autorisé' })).toBeVisible();
    await expect(page.getByText('Tableau de bord')).toHaveCount(0);
  });

  test('l’agent ne voit pas les finances ni l’administration', async ({ page }) => {
    await login(page, 'agent');
    await expect(page.getByRole('heading', { name: /Bonjour/ })).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Navigation de l’espace privé' });
    await expect(nav.getByRole('link', { name: 'Biens' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Finances' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Utilisateurs' })).toHaveCount(0);
    await page.goto('/admin/finances');
    await expect(page.getByText('Votre rôle ne permet pas d’accéder à cette section.')).toBeVisible();
    await page.goto('/admin');
    await expect(page.getByText('Commissions estimées')).toHaveCount(0);
  });
});

async function createOwner(page: Page, name: string) {
  await page.goto('/admin/proprietaires/nouveau');
  await field(page, 'Nom').fill(name);
  await field(page, 'Prénoms').fill('Test');
  await field(page, 'Téléphone principal').fill('+225 07 99 88 77 66');
  await page.getByRole('button', { name: 'Créer' }).click();
  await expect(page.getByRole('heading', { name: new RegExp(name) })).toBeVisible();
  return page.url().split('/').pop()!;
}

test.describe('Parcours complet : du bien à la vente', () => {
  const OWNER = 'PROPRIO-E2E';
  const TITLE = 'Villa E2E avec piscine';

  test('l’admin assouplit la règle « photo obligatoire » (stockage non émulé)', async ({ page }) => {
    await login(page, 'admin');
    await expect(page.getByRole('heading', { name: /Bonjour/ })).toBeVisible();
    await page.goto('/admin/parametres');
    await page.getByLabel('Exiger au moins une photo').uncheck();
    await page.getByRole('button', { name: 'Enregistrer les paramètres' }).click();
    await expect(page.getByText('Paramètres enregistrés.')).toBeVisible();
    const [s] = await sql('select publication_requires_photo from agency_settings');
    expect(s.publication_requires_photo).toBe(false);
  });

  test('l’agent crée propriétaire, bien et mandat ; la publication est contrôlée', async ({ page }) => {
    await login(page, 'agent');
    await expect(page.getByRole('heading', { name: /Bonjour/ })).toBeVisible();
    const ownerId = await createOwner(page, OWNER);

    // Création du bien depuis la fiche propriétaire (préremplissage)
    await page.getByRole('link', { name: '+ Bien' }).click();
    await expect(field(page, 'Propriétaire')).toHaveValue(ownerId);
    await field(page, 'Titre de l’annonce').fill(TITLE);
    await field(page, 'Type de bien').selectOption('maison');
    await field(page, 'Prix (FCFA)').fill('120 000 000');
    await field(page, 'Ville / commune').fill('Abidjan');
    await field(page, 'Quartier').fill('Riviera');
    await field(page, 'Superficie').fill('600');
    await field(page, 'Chambres').fill('4');
    await field(page, 'Description').fill('Belle villa de test créée par le parcours de bout en bout automatisé.');
    await page.getByRole('button', { name: 'Créer' }).click();

    // Fiche du bien : référence automatique, publication bloquée
    await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();
    const reference = (await page.locator('header, div').getByText(/^BIEN-\d{4}-\d{5}$/).first().textContent())!;
    expect(reference).toMatch(/^BIEN-/);
    await expect(page.getByText('Le bien doit être vérifié')).toBeVisible();
    await expect(page.getByText('Un mandat actif est requis')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Publier l’annonce' })).toBeDisabled();

    // Un brouillon n'est pas visible publiquement
    const pub = await page.request.get(`/biens/${reference}`);
    expect(pub.ok()).toBe(true);

    // Vérification du bien
    const propertyUrl = page.url();
    await page.getByRole('link', { name: 'Modifier', exact: true }).click();
    await field(page, 'Statut de vérification').selectOption('verifie');
    await field(page, 'Statut commercial').selectOption('disponible');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Un mandat actif est requis')).toBeVisible();
    await expect(page.getByText('Le bien doit être vérifié')).toHaveCount(0);

    // Mandat actif
    await page.getByRole('link', { name: '+ Mandat' }).click();
    await field(page, 'Statut').selectOption('actif');
    await field(page, 'Date de signature').fill('2026-10-01');
    await field(page, 'Rémunération convenue').selectOption('pourcentage');
    await field(page, 'Taux convenu (%)').fill('5');
    await expect(page.getByText(/Exemple : pour une vente à 50 000 000 FCFA, 2 500 000 FCFA/)).toBeVisible();
    await page.getByRole('button', { name: 'Créer' }).click();
    await expect(page).toHaveURL(propertyUrl);

    // Publication
    await expect(page.getByText('Toutes les conditions sont remplies.')).toBeVisible();
    await page.getByRole('button', { name: 'Publier l’annonce' }).click();
    await expect(page.getByText(/L’annonce est en ligne/)).toBeVisible();

    // Visible dans le catalogue public
    await page.goto(`/biens/${reference}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(TITLE);
    await expect(page.getByText('120 000 000 FCFA').first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText(OWNER);
  });

  test('la demande publique arrive dans l’espace privé et devient un prospect', async ({ page, request }) => {
    // Demande envoyée comme un visiteur, via l'API publique (indépendant de l'ordre des fichiers).
    const [existing] = await sql(`select count(*)::int as n from inquiries where full_name = 'Kouadio Test E2E'`);
    if (existing.n === 0) {
      const { url, anonKey } = state();
      const r = await request.post(`${url}/rest/v1/rpc/submit_inquiry`, {
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
        data: { p_full_name: 'Kouadio Test E2E', p_phone: '+225 07 12 34 56 78', p_message: 'Bonjour, test.', p_property_reference: 'BIEN-2026-00002', p_consent: true },
      });
      expect(r.ok()).toBe(true);
    }
    await login(page, 'agent');
    await expect(page.getByRole('heading', { name: /Bonjour/ })).toBeVisible();
    await page.goto('/admin/demandes?status=nouveau');
    await page.getByRole('link', { name: 'Kouadio Test E2E' }).first().click();
    await expect(page.getByRole('heading', { name: 'Demande de Kouadio Test E2E' })).toBeVisible();
    await page.getByRole('button', { name: 'Créer un prospect' }).click();
    await expect(page.getByRole('heading', { name: 'Kouadio Test E2E' })).toBeVisible();
    await expect(page.getByText(/Demande DEM-\d{4}-\d{5}/)).toBeVisible(); // échange historisé
    const [b] = await sql(`select status from buyers where last_name = 'Kouadio'`);
    expect(b.status).toBe('a_contacter');
  });

  test('visite puis vente conclue : le bien quitte le catalogue, l’historique reste', async ({ page }) => {
    await login(page, 'agent');
    await expect(page.getByRole('heading', { name: /Bonjour/ })).toBeVisible();
    const [p] = await sql(`select id, reference from properties where title = $1`, [TITLE]);

    // Visite
    await page.goto(`/admin/visites/nouveau?property_id=${p.id}`);
    await selectOptionContaining(page, 'Prospect', 'Kouadio');
    await field(page, 'Date et heure').fill('2026-10-20T10:00');
    await field(page, 'Statut').selectOption('effectuee');
    await field(page, 'Compte rendu').fill('Visite concluante (test).');
    await page.getByRole('button', { name: 'Créer' }).click();
    const [v] = await sql(`select v.scheduled_at, b.last_name from visits v join buyers b on b.id = v.buyer_id where v.property_id = $1`, [p.id]);
    expect(v.last_name).toBe('Kouadio');
    expect(new Date(v.scheduled_at).toISOString()).toBe('2026-10-20T10:00:00.000Z'); // heure d'Abidjan = UTC

    // Dossier de vente depuis la fiche bien
    await page.goto(`/admin/biens/${p.id}`);
    await page.getByRole('link', { name: '+ Dossier' }).click();
    await selectOptionContaining(page, 'Acheteur', 'Kouadio');
    await selectOptionContaining(page, 'Règle de commission', 'Pourcentage standard');
    await page.getByRole('button', { name: 'Créer' }).click();
    await expect(page.getByRole('heading', { name: /Dossier TRX-/ })).toBeVisible();
    await expect(page.getByText('6 000 000 FCFA')).toBeVisible(); // estimation 5 % de 120 M

    // Offre puis conclusion
    await page.getByRole('button', { name: '+ Offre' }).click();
    await field(page, 'Montant (FCFA)').fill('110000000');
    await page.getByRole('dialog').getByRole('button', { name: 'Créer' }).click();
    await expect(page.getByRole('cell', { name: '110 000 000 FCFA' })).toBeVisible();

    await page.getByRole('link', { name: /Modifier \/ changer le statut/ }).click();
    await field(page, 'Statut').selectOption('vente_conclue');
    await expect(page.getByText(/retire le bien du site/)).toBeVisible();
    await field(page, 'Prix convenu (FCFA)').fill('115000000');
    await field(page, 'Commission convenue (FCFA)').fill('5500000');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    // Sans date de conclusion, la base refuse
    await expect(page.getByText(/ne respectent pas les règles/)).toBeVisible();
    await field(page, 'Date de conclusion').fill('2026-10-09');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByRole('heading', { name: /Dossier TRX-/ })).toBeVisible();
    await expect(page.getByText('Vente conclue').first()).toBeVisible();

    // Le bien n'est plus public
    await page.goto(`/biens/${p.reference}`);
    await expect(page.getByText(/n’est plus en ligne/)).toBeVisible();
    // Historique conservé côté privé
    await page.goto(`/admin/biens/${p.id}`);
    await expect(page.getByText('Vendu').first()).toBeVisible();
    await expect(page.getByText(/Publié → /)).toBeVisible();
  });

  test('le comptable encaisse partiellement la commission ; soldes justes', async ({ page }) => {
    await login(page, 'comptable');
    await expect(page.getByRole('heading', { name: /Bonjour/ })).toBeVisible();
    await expect(page.getByText('Commissions dues (solde)')).toBeVisible();
    await page.goto('/admin/finances/recettes?status=exigible');
    await page.getByRole('row', { name: /5 500 000 FCFA/ }).getByRole('link').click();
    await expect(page.getByRole('heading', { name: /Recette REC-/ })).toBeVisible();

    await page.getByRole('button', { name: '+ Encaissement' }).click();
    await page.getByLabel(/Montant encaissé/).fill('2000000');
    await page.getByLabel(/Date/).fill('2026-10-09');
    await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Partiellement encaissé').first()).toBeVisible();
    await expect(page.getByText('3 500 000 FCFA').first()).toBeVisible(); // solde

    // Correction motivée
    await page.getByRole('button', { name: 'Correction' }).click();
    await page.getByLabel(/Montant à retirer/).fill('500000');
    await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Le motif de la correction est obligatoire.')).toBeVisible();
    await page.getByLabel(/Motif de la correction/).fill('Erreur de saisie (test)');
    await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('4 000 000 FCFA').first()).toBeVisible();

    const [e] = await sql(`select amount_expected::bigint, amount_received::bigint, balance::bigint, status from financial_entries where amount_expected = 5500000`);
    expect(e).toEqual({ amount_expected: '5500000', amount_received: '1500000', balance: '4000000', status: 'partiel' });

    // Dépense
    await page.goto('/admin/finances/depenses/nouveau');
    await field(page, 'Catégorie').selectOption('Publicité');
    await field(page, 'Description').fill('Affiches test E2E');
    await field(page, 'Montant (FCFA)').fill('25000');
    await page.getByRole('button', { name: 'Créer' }).click();
    await expect(page.getByRole('cell', { name: 'Affiches test E2E' })).toBeVisible();

    // Rapport financier cohérent
    await page.goto('/admin/finances');
    await expect(page.getByText('Recettes encaissées')).toBeVisible();
  });

  test('l’admin consulte le journal d’activité (lecture seule)', async ({ page }) => {
    await login(page, 'admin');
    await expect(page.getByRole('heading', { name: /Bonjour/ })).toBeVisible();
    await page.goto('/admin/journal');
    await expect(page.getByRole('cell', { name: 'publication' }).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Test agent' }).first()).toBeVisible();
  });
});
