// Pile locale « compatible Supabase » pour les tests de bout en bout :
// PostgreSQL + GoTrue (Supabase Auth) + PostgREST derrière un mini-proxy /auth/v1 et /rest/v1.
// Le stockage de fichiers (Storage API) n'est PAS émulé : les envois de photos ne sont pas testés ici.
//
// Prérequis : PostgreSQL local, binaires GOTRUE_BIN et POSTGREST_BIN (voir docs/TESTS.md).
// Usage : node tests/e2e/stack.mjs   (laisse la pile tourner jusqu'à Ctrl+C)
import { spawn } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const DB = 'unimob_e2e';
const JWT_SECRET = randomBytes(32).toString('hex'); // éphémère, jamais écrit dans le dépôt
const AUTHENTICATOR_PWD = randomBytes(12).toString('hex');
const PORTS = { proxy: 54321, rest: 54330, auth: 54331 };
const STATE_FILE = process.env.E2E_STATE_FILE ?? join(root, 'tests/e2e/.state.json');

const b64url = (b) => Buffer.from(b).toString('base64url');
export function signJwt(payload, secret = JWT_SECRET) {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 * 6, ...payload }));
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

const dbUrl = (user = 'postgres', pwd = 'postgres') => {
  const u = new URL(ADMIN_URL);
  u.username = user;
  u.password = pwd;
  u.pathname = `/${DB}`;
  return u.toString();
};

async function waitFor(url, label, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {
      /* pas encore prêt */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${label} ne répond pas (${url})`);
}

function start(cmd, env, label) {
  const p = spawn(cmd, [], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = [];
  p.stdout.on('data', (d) => log.push(String(d)));
  p.stderr.on('data', (d) => log.push(String(d)));
  p.on('exit', (code) => code && code !== 0 && console.error(`[${label}] arrêt (${code})\n${log.slice(-20).join('')}`));
  return p;
}

export async function startStack() {
  const gotrue = process.env.GOTRUE_BIN;
  const postgrest = process.env.POSTGREST_BIN;
  if (!gotrue || !postgrest) throw new Error('Définir GOTRUE_BIN et POSTGREST_BIN (voir docs/TESTS.md)');

  // 1. Base vierge + rôles
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${DB} with (force)`);
  await admin.query(`create database ${DB}`);
  await admin.query(`do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator login noinherit; end if;
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
  end $$`);
  await admin.query(`alter role authenticator password '${AUTHENTICATOR_PWD}'`);
  await admin.query('grant anon, authenticated, service_role to authenticator');
  await admin.end();

  const c = new pg.Client({ connectionString: dbUrl() });
  await c.connect();
  await c.query('create schema if not exists auth');

  // 2. GoTrue crée son schéma auth
  const authProc = start(gotrue, {
    GOTRUE_DB_DRIVER: 'postgres',
    DATABASE_URL: `${dbUrl()}?search_path=auth`,
    GOTRUE_DB_DATABASE_URL: `${dbUrl()}?search_path=auth`,
    GOTRUE_JWT_SECRET: JWT_SECRET,
    GOTRUE_JWT_EXP: '3600',
    GOTRUE_JWT_AUD: 'authenticated',
    GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated',
    GOTRUE_JWT_ADMIN_ROLES: 'service_role',
    GOTRUE_API_HOST: '127.0.0.1',
    PORT: String(PORTS.auth),
    API_EXTERNAL_URL: `http://localhost:${PORTS.proxy}/auth/v1`,
    GOTRUE_SITE_URL: 'http://localhost:4173',
    GOTRUE_DISABLE_SIGNUP: 'true',
    GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true',
    GOTRUE_MAILER_AUTOCONFIRM: 'true',
    GOTRUE_LOG_LEVEL: 'warn',
  }, 'gotrue');
  await waitFor(`http://127.0.0.1:${PORTS.auth}/health`, 'GoTrue');

  // 3. Shim (stockage, privilèges par défaut) + migrations + données fictives
  for (const f of ['tests/db/supabase-shim.sql', ...readdirSync(join(root, 'supabase/migrations')).sort().map((f) => `supabase/migrations/${f}`), 'supabase/seed.sql']) {
    try {
      await c.query(readFileSync(join(root, f), 'utf8'));
    } catch (e) {
      throw new Error(`${f}: ${e.message}`);
    }
  }
  await c.query(`grant usage on schema auth to authenticator`);

  // 4. PostgREST
  const restProc = start(postgrest, {
    PGRST_DB_URI: dbUrl('authenticator', AUTHENTICATOR_PWD),
    PGRST_DB_SCHEMAS: 'public',
    PGRST_DB_ANON_ROLE: 'anon',
    PGRST_JWT_SECRET: JWT_SECRET,
    PGRST_SERVER_PORT: String(PORTS.rest),
    PGRST_SERVER_HOST: '127.0.0.1',
    PGRST_DB_EXTRA_SEARCH_PATH: 'extensions',
    PGRST_LOG_LEVEL: 'warn',
  }, 'postgrest');
  await waitFor(`http://127.0.0.1:${PORTS.rest}/`, 'PostgREST');

  // 5. Proxy façon Supabase (/rest/v1, /auth/v1) + stub de stockage pour les illustrations
  const proxy = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, X-Total-Count');
    if (req.method === 'OPTIONS') return res.end();
    const routes = [['/rest/v1', PORTS.rest], ['/auth/v1', PORTS.auth]];
    const hit = routes.find(([prefix]) => req.url.startsWith(prefix));
    if (!hit) {
      res.statusCode = 404;
      return res.end('{"message":"Stockage non émulé"}');
    }
    const headers = { ...req.headers, host: `127.0.0.1:${hit[1]}` };
    const up = http.request({ host: '127.0.0.1', port: hit[1], path: req.url.slice(hit[0].length) || '/', method: req.method, headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, { ...r.headers, 'access-control-allow-origin': '*', 'access-control-expose-headers': 'Content-Range, X-Total-Count' });
      r.pipe(res);
    });
    up.on('error', () => {
      res.statusCode = 502;
      res.end();
    });
    req.pipe(up);
  });
  await new Promise((r) => proxy.listen(PORTS.proxy, '127.0.0.1', r));

  // 6. Comptes de test (mots de passe aléatoires, non persistés dans le dépôt)
  const anonKey = signJwt({ role: 'anon', iss: 'supabase' });
  const serviceKey = signJwt({ role: 'service_role', iss: 'supabase' });
  const users = {};
  for (const role of ['admin', 'agent', 'comptable', 'sans_role']) {
    const email = `${role}@e2e.test`;
    const password = `E2e-${randomBytes(9).toString('base64url')}`;
    const r = await fetch(`http://127.0.0.1:${PORTS.auth}/admin/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
      body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: `Test ${role}` } }),
    });
    if (!r.ok) throw new Error(`Création ${email} : ${r.status} ${await r.text()}`);
    if (role !== 'sans_role') await c.query(`update public.profiles set role = $2, is_active = true where email = $1`, [email, role]);
    users[role] = { email, password };
  }
  await c.end();

  const state = { url: `http://localhost:${PORTS.proxy}`, anonKey, users, dbUrl: dbUrl() };
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  const stop = () => {
    proxy.close();
    authProc.kill();
    restProc.kill();
  };
  return { state, stop };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startStack()
    .then(({ state, stop }) => {
      console.log(`Pile prête : ${state.url}\nClé anon (éphémère) écrite dans ${STATE_FILE}`);
      process.on('SIGINT', () => {
        stop();
        process.exit(0);
      });
      process.on('SIGTERM', () => {
        stop();
        process.exit(0);
      });
    })
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
