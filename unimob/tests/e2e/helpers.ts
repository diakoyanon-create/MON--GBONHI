import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
import { expect, type Page } from '@playwright/test';
import pg from 'pg';

type State = { url: string; anonKey: string; dbUrl: string; users: Record<'admin' | 'agent' | 'comptable' | 'sans_role', { email: string; password: string }> };

export function state(): State {
  return JSON.parse(readFileSync(join(__dirname, '.state.json'), 'utf8'));
}

export async function login(page: Page, who: keyof State['users']) {
  const u = state().users[who];
  await page.goto('/connexion');
  await page.getByLabel('Adresse électronique').fill(u.email);
  await page.getByLabel('Mot de passe').fill(u.password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
}

export async function logout(page: Page) {
  await page.evaluate(() => localStorage.clear());
}

export async function sql<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: state().dbUrl });
  await c.connect();
  try {
    return (await c.query(text, params)).rows as T[];
  } finally {
    await c.end();
  }
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Champ de formulaire dont le libellé commence par `label` (les champs requis finissent par « * »). */
export const field = (page: Page, label: string) => page.getByLabel(new RegExp(`^${esc(label)}( \\*)?$`));

export async function selectOptionContaining(page: Page, label: string, text: string) {
  const select = field(page, label);
  const value = await select.locator('option', { hasText: text }).first().getAttribute('value');
  expect(value, `option « ${text} » dans « ${label} »`).toBeTruthy();
  await select.selectOption(value!);
}
