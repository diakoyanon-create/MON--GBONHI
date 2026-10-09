import pg from 'pg';
import { randomUUID } from 'node:crypto';

export type Role = 'admin' | 'agent' | 'assistant' | 'comptable';
export type Who = { uid: string | null; role: 'anon' | 'authenticated' };

const url = () =>
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/unimob_test';

let pool: pg.Pool | null = null;
export function db(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: url(), max: 4 });
  return pool;
}
export async function closeDb() {
  await pool?.end();
  pool = null;
}

/** Requête en super-utilisateur (équivalent service/migrations). */
export async function sql<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = []) {
  return (await db().query<T>(text, params)).rows;
}

/** Crée un compte Auth et, si demandé, lui attribue un rôle actif. */
export async function createUser(role: Role | null, active = true): Promise<Who> {
  const id = randomUUID();
  await sql('insert into auth.users (id, email) values ($1, $2)', [id, `${role ?? 'sans-role'}-${id.slice(0, 8)}@test.invalid`]);
  if (role) await sql('update public.profiles set role = $2, is_active = $3 where id = $1', [id, role, active]);
  return { uid: id, role: 'authenticated' };
}

export const anon: Who = { uid: null, role: 'anon' };

/**
 * Exécute fn en se faisant passer pour un utilisateur de l'API Supabase
 * (rôle Postgres + claims JWT), dans une transaction annulée à la fin
 * sauf si commit = true.
 */
export async function as<T>(who: Who, fn: (q: <R extends pg.QueryResultRow = any>(t: string, p?: unknown[]) => Promise<R[]>) => Promise<T>, commit = true): Promise<T> {
  const client = await db().connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify(who.uid ? { sub: who.uid, role: who.role } : { role: 'anon' }),
    ]);
    await client.query(`set local role ${who.role}`);
    const q = async <R extends pg.QueryResultRow = any>(t: string, p: unknown[] = []) => (await client.query<R>(t, p)).rows;
    const res = await fn(q);
    await client.query(commit ? 'commit' : 'rollback');
    return res;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Crée un propriétaire + bien publiable (vérifié, mandat actif, photo). */
export async function makePublishableProperty(overrides: Record<string, unknown> = {}) {
  const [owner] = await sql(`insert into owners (last_name, phone_primary) values ('TEST', '+225 01 02 03 04 05') returning id`);
  const [prop] = await sql(
    `insert into properties (property_type, title, description, city, price_xof, owner_id, verification_status, commercial_status, is_demo)
     values ('maison', $1, 'Description de test suffisamment longue.', 'Abidjan', $2, $3, 'verifie', 'disponible', true)
     returning id, reference`,
    [overrides.title ?? 'Maison de test', overrides.price ?? 50000000, owner.id],
  );
  await sql(`insert into mandates (owner_id, property_id, signed_date, status) values ($1, $2, current_date, 'actif')`, [owner.id, prop.id]);
  await sql(`insert into property_photos (property_id, storage_path) values ($1, $2)`, [prop.id, `${prop.id}/a.jpg`]);
  return { ownerId: owner.id as string, propertyId: prop.id as string, reference: prop.reference as string };
}
