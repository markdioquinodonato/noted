/**
 * In-process PostgreSQL (PGlite, Postgres 17 compiled to WASM) loaded with a
 * minimal stand-in for the Supabase platform (auth schema, auth.uid(), API
 * roles, default grants) and then the REAL migration files from
 * supabase/migrations. Lets us execute RLS / privilege tests without Docker or
 * a hosted project. Queries run as the `authenticated` role, exactly like
 * PostgREST does, so RLS and column grants are genuinely enforced.
 */
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SUPABASE_PLATFORM_STUB = `
  create role anon nologin noinherit;
  create role authenticated nologin noinherit;
  create role service_role nologin noinherit bypassrls;

  create schema storage;
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null);
  alter table storage.objects enable row level security;
  grant usage on schema storage to authenticated;
  grant select,insert,delete on storage.objects to authenticated;
  create schema auth;
  create schema extensions;
  create table auth.users (
    id uuid primary key,
    email text unique,
    email_change text default '',
    raw_user_meta_data jsonb default '{}'::jsonb
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;

  grant usage on schema public, auth, extensions to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;

  -- Mirror Supabase defaults: API roles get broad privileges on new objects
  -- in public. Our migration must explicitly revoke what it does not want.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

export type TestDb = {
  db: PGlite;
  /** Create an auth user (as the platform would on sign-up). */
  createUser(id: string, email: string, displayName?: string): Promise<void>;
  /** Run SQL as `authenticated` with auth.uid() = userId (or as anon when null). */
  as<T = Record<string, unknown>>(
    userId: string | null,
    sql: string,
    params?: unknown[],
  ): Promise<T[]>;
  /** Run SQL as the superuser (bypasses RLS) — for setup/inspection only. */
  admin<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
};

export async function createTestDb(): Promise<TestDb> {
  const db = await PGlite.create({ extensions: { pg_trgm } });
  await db.exec(SUPABASE_PLATFORM_STUB);

  const dir = join(process.cwd(), 'supabase', 'migrations');
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    await db.exec(readFileSync(join(dir, file), 'utf8'));
  }

  const admin = async <T>(sql: string, params: unknown[] = []) => {
    await db.exec('reset role');
    return (await db.query<T>(sql, params)).rows;
  };

  const as = async <T>(userId: string | null, sql: string, params: unknown[] = []) => {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? '']);
    await db.exec(userId ? 'set role authenticated' : 'set role anon');
    try {
      return (await db.query<T>(sql, params)).rows;
    } finally {
      await db.exec('reset role');
    }
  };

  const createUser = async (id: string, email: string, displayName?: string) => {
    await admin(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
      id,
      email,
      JSON.stringify(displayName ? { display_name: displayName } : {}),
    ]);
  };

  return { db, createUser, as, admin };
}
