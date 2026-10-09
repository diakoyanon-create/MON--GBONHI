import { expect, test } from '@playwright/test';
import { login } from './helpers';

// Parcours essentiels sur un téléphone Android (viewport Pixel 7, tactile).
test.describe('Mobile Android', () => {
  test('catalogue et fiche bien lisibles sans défilement horizontal', async ({ page }) => {
    await page.goto('/biens');
    await expect(page.locator('article').first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.locator('article a').first().click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Envoyer ma demande' })).toBeVisible();
    const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow2).toBeLessThanOrEqual(1);
  });

  test('menu mobile du site', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Menu/ }).click();
    await page.locator('#menu-public').getByRole('link', { name: 'Contact' }).click();
    await expect(page.getByRole('heading', { name: 'Contact' })).toBeVisible();
  });

  test('cibles tactiles d’au moins 36 px sur les boutons du formulaire', async ({ page }) => {
    await page.goto('/contact');
    const box = await page.getByRole('button', { name: 'Envoyer ma demande' }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(36);
  });

  test('espace privé : connexion, menu repliable, liste en cartes', async ({ page }) => {
    await login(page, 'agent');
    await expect(page.getByRole('heading', { name: /Bonjour/ })).toBeVisible();
    await page.getByRole('button', { name: /Menu/ }).click();
    await page.getByRole('link', { name: 'Biens', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Biens immobiliers' })).toBeVisible();
    await expect(page.locator('ul.space-y-2 > li').first()).toBeVisible(); // vue cartes
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
