const fs=require('fs'),path=require('path'),{PGlite}=require('@electric-sql/pglite');
const repo=path.resolve(__dirname,'../..');
const read=f=>fs.readFileSync(path.join(repo,f),'utf8');
function fn(f,name){const s=read(f),start=s.toLowerCase().indexOf('create or replace function public.'+name+'(');if(start<0)throw Error(name);const tail=s.slice(start),d=tail.match(/\$(?:\w+)?\$/)[0],end=tail.indexOf(d,tail.indexOf(d)+d.length)+d.length;return tail.slice(0,end)+';';}
function policy(name){const s=read('migrations/0137_core_rls_baseline.sql'),start=s.indexOf('create policy "'+name+'"');return s.slice(start,s.indexOf(';',start)+1);}
(async()=>{const db=new PGlite();await db.exec(`create role authenticated; create role anon; create role service_role bypassrls; create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema public,auth to authenticated;create table profiles(id uuid primary key,email text,is_admin boolean default false,is_owner boolean default false,banned boolean default false,handicap_index numeric,display_name text);create table group_members(group_id uuid,user_id uuid,role text,status text);create domain citext as text;create table banned_emails(email citext);alter table profiles enable row level security;grant select,insert,update,delete on profiles to authenticated;`);
await db.exec(fn('migrations/0136_core_rls_helpers.sql','is_admin')+fn('migrations/0102_owner_system_admins.sql','is_owner')+fn('migrations/0136_core_rls_helpers.sql','shares_active_club')+fn('migrations/0144_authorization_hardening.sql','guard_profile_privileged_cols')+fn('migrations/0038_auth_blocklist.sql','guard_new_profile_banned'));
await db.exec(`create trigger trg_guard_profile_privileged before update on profiles for each row execute function guard_profile_privileged_cols();create trigger trg_guard_new_profile_banned before insert on profiles for each row execute function guard_new_profile_banned();`+['insert own profile','read own, co-members, or admin','update own or admin all'].map(policy).join('\n'));

await db.exec(`create table activity_log(actor_id uuid,actor_name text,action text,summary text,target_user_id uuid); grant usage on schema public,auth to service_role;grant all on profiles to service_role;create function public.record_migration(text) returns void language sql as $$ select $$;`);
await db.exec(read('migrations/0158_profile_privilege_boundaries.sql'));
await db.exec(read('migrations/0158_profile_privilege_boundaries.sql')); // reapplication is safe
await db.exec(read('ci/assert-profile-privileges.sql'));
console.log('PASS: actual migration applied twice; authenticated RLS insert/update, owner RPC, direct owner audit, ban permissions, metadata spoof, service role and rollback scenarios');
await db.close();})().catch(e=>{console.error(e);process.exit(1)});
