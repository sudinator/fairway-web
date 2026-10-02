-- ci/local_supabase_shim.sql
-- Enough of Supabase for the committed migration chain to replay on a plain PostgreSQL 16 with
-- pg_cron: roles, auth.users/uid/role/jwt, storage tables and helpers, the realtime publication.
-- Used by ci/test_fresh_db_local.sh. It is a SHIM, not Supabase: RLS defaults, grants and the
-- auth schema are approximations, so the GitHub fresh-Supabase rebuild remains the final gate.
-- Written after 195.0 shipped an assertion that passed on a modelled fixture and failed on the
-- real chain (settlements.event_id NOT NULL, 0121). The real chain is now one command away.
-- Supabase compatibility shim for a plain PostgreSQL 16: roles, auth schema, storage, extensions.
do $$ declare r text; begin
  foreach r in array array['anon','authenticated','service_role','authenticator','supabase_admin','supabase_auth_admin'] loop
    if not exists (select 1 from pg_roles where rolname=r) then execute format('create role %I nologin', r); end if;
  end loop;
end $$;
alter role service_role bypassrls;
create extension if not exists pgcrypto; create extension if not exists citext; create extension if not exists pg_cron;
create schema if not exists auth; create schema if not exists storage; create schema if not exists extensions;
create table auth.users(
  id uuid primary key default gen_random_uuid(), instance_id uuid, aud text, role text, email text, encrypted_password text,
  email_confirmed_at timestamptz, invited_at timestamptz, confirmation_token text, confirmation_sent_at timestamptz,
  raw_app_meta_data jsonb, raw_user_meta_data jsonb, is_super_admin bool, created_at timestamptz default now(),
  updated_at timestamptz default now(), phone text, last_sign_in_at timestamptz, banned_until timestamptz, deleted_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(coalesce(current_setting('request.jwt.claim.sub',true), current_setting('request.jwt.claims',true)::jsonb->>'sub'),'')::uuid $$;
create function auth.role() returns text language sql stable as $$ select coalesce(current_setting('request.jwt.claim.role',true), current_setting('request.jwt.claims',true)::jsonb->>'role') $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb, '{}'::jsonb) $$;
create table storage.buckets(id text primary key, name text, public bool, file_size_limit bigint, allowed_mime_types text[], owner uuid, created_at timestamptz default now(), updated_at timestamptz default now());
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb, created_at timestamptz default now());
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
create function storage.filename(name text) returns text language sql immutable as $$ select (string_to_array(name,'/'))[array_length(string_to_array(name,'/'),1)] $$;
create function storage.extension(name text) returns text language sql immutable as $$ select reverse(split_part(reverse(name),'.',1)) $$;
grant usage on schema auth, storage, public, extensions to anon, authenticated, service_role;
grant all on all tables in schema storage to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
create publication supabase_realtime;
-- Supabase grants service_role everything in public by default privileges; mirror that.
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
