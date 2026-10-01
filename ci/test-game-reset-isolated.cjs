// Actual PostgreSQL/PGlite engine + shipped SQL; schema is explicitly MODELLED.
// Does not replace fresh Supabase reconstruction or independent-connection concurrency.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {PGlite}=require(process.env.BNN_PGLITE_MODULE||'@electric-sql/pglite');
const root=path.resolve(__dirname,'..'),read=n=>fs.readFileSync(path.join(root,n),'utf8');
(async()=>{
 const db=new PGlite();
 try{
  await db.exec(read('ci/fixtures/game-reset-isolated.sql'));
  const baseline=read('migrations/0137_core_rls_baseline.sql');
  for(const name of ['edit own scores','marker_can_update_group_scores','organizer adds players','organizer manages players','organizer removes players','see co-players','tee_group_marker_can_update']){
   const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
   const policy=baseline.match(new RegExp('create policy "'+escaped+'"[\\s\\S]*?;'));
   assert.ok(policy,name);await db.exec(policy[0]);
  }
  const side=read('migrations/0140_alt_shot_side_scores.sql');
  const table=side.match(/create table if not exists public.game_alt_shot_scores[\s\S]*?\n\);/);assert.ok(table);await db.exec(table[0]);
  await db.exec('grant select on public.game_alt_shot_scores to authenticated; alter table public.game_alt_shot_scores enable row level security; create policy fixture_side_select on public.game_alt_shot_scores for select to authenticated using(public.is_game_member(game_id) or public.is_admin());');
  for(const file of ['0067_save_hole_stats.sql','0141_alt_shot_clear_tombstones.sql','0162_primary_scoring_device.sql','0163_game_reset_fencing.sql'])await db.exec(read('migrations/'+file));
  // Applying the new migration twice proves its local rerun contract.
  await db.exec(read('migrations/0163_game_reset_fencing.sql'));
  await db.exec(read('ci/assert-game-reset-fencing.sql'));
  await db.exec(read('ci/assert-match-length-roundtrip.sql'));
  console.log('PASS: EXECUTED actual 0163 twice in PostgreSQL/PGlite with authenticated RLS; current/stale/absent version, direct and legacy RPC bypass denial, own-stats permission, player/side clearing, organizer/admin repeated resets, version rewind denial, anonymous grants, 9/18/back-nine setup round trip');
 }finally{await db.close()}
})().catch(e=>{console.error(e.message);process.exitCode=1});
