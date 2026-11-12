import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'

const db = new PGlite()
try {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create schema storage;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text);
    create function auth.uid() returns uuid language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
    $$;
    create table storage.buckets (
      id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]
    );
    create table storage.objects (
      id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
      name text, metadata jsonb, unique(bucket_id, name)
    );
    alter table storage.objects enable row level security;
    grant usage on schema public, auth, storage to anon, authenticated, service_role;
    grant select, insert, update, delete on storage.objects to anon, authenticated;
    grant all on storage.objects, storage.buckets to service_role;
    -- Supabase defaults grant application-table access broadly. The migration
    -- must explicitly revoke this before granting its narrow application ACLs.
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant execute on functions to anon, authenticated;
  `)
  for (const file of ['supabase/migrations/001_initial.sql', 'supabase/seed.sql', 'supabase/tests/security.sql']) {
    console.log(`Running ${file}`)
    await db.exec(await readFile(file, 'utf8'))
    console.log(`PASS ${file}`)
  }
  console.log('PASS: real PostgreSQL migration, seed, and rollback security scenarios using PGlite. Supabase Auth and Storage schemas mocked; Storage HTTP service not exercised.')
} finally {
  await db.close()
}
