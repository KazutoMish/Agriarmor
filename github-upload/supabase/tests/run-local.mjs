/**
 * Runs the actual migration and SQL security scenarios in PostgreSQL/WASM.
 * Supabase's managed auth/storage schemas are represented by minimal fixtures;
 * this does not exercise Auth HTTP, Storage HTTP, or concurrent connections.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

const db = new PGlite();
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
    -- Prove the migration revokes Supabase's broad default privileges before
    -- granting its narrow application privileges and RPC access.
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant execute on functions to anon, authenticated;
  `);
  for (const path of ['../migrations/001_initial.sql', '../seed.sql', '../migrations/002_update_product_prices.sql', '../migrations/003_require_checkout_payment_proof.sql', './security.sql']) {
    await db.exec(await readFile(new URL(path, import.meta.url), 'utf8'));
    console.log(`PASS ${path}`);
  }
  console.log('SQL security scenarios passed in PostgreSQL. Supabase Auth/Storage HTTP and concurrent requests require a configured Supabase project.');
} finally {
  await db.close();
}
