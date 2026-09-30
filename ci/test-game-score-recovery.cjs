// Execute shipped helpers and actual GameRoom load with fault-injected reads.
const fs=require('fs'),path=require('path'),Module=require('module'),assert=require('node:assert/strict');
const repo=path.resolve(__dirname,'..'),req=Module.createRequire(path.join(repo,'package.json')),ts=req('typescript');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,f);
const {JSDOM}=req('jsdom'),dom=new JSDOM('',{url:'https://game-test.invalid'});global.window=dom.window;
Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
const draft=require(path.join(repo,'lib/draft.ts')),{mergeBackupRow}=require(path.join(repo,'lib/golf.ts')),{createGameScoreWriter}=require(path.join(repo,'lib/game-score-sync.ts'));
const bundle=(scores=[],putts=[],fairways=[],penalties=[],sand=[])=>({scores,putts,fairways,penalties,sand}),copy=x=>structuredClone(x);
const base=bundle([5,6],[2,2],['hit','miss'],[0,0],[false,false]);
const local={...copy(base),scores:[4,null],putts:[1,2],fairways:[null,'miss'],penalties:[1,0],sand:[true,false]};
const pending=draft.rowPendingHoles;
let r=mergeBackupRow({...copy(base),putts:[2,3]},local,2,base);
assert.deepEqual(r.merged,{...local,putts:[1,3]});assert.equal(r.changed,true);assert.equal(pending(local,base),2);
for(const col of Object.keys(base)){const b=copy(base);b[col][0]=null;assert.equal(pending(b,base),1,col+' deletion');assert.equal(mergeBackupRow(base,b,2,base).merged[col][0],null);}
assert.equal(pending(bundle(),base),2,'truncated arrays');assert.equal(pending(bundle([null],[1]),bundle([null],[null])),1,'stats-only');
assert.equal(mergeBackupRow(bundle([5]),bundle([4]),1).merged.scores[0],5,'legacy conservative');assert.equal(mergeBackupRow(bundle([null]),bundle([4]),1).merged.scores[0],4,'legacy gap');assert.equal(mergeBackupRow(bundle([5],[null]),bundle([5],[1]),1).changed,true,'stats recovered');
const source=fs.readFileSync(path.join(repo,'components/tournaments.tsx'),'utf8'),parsed=ts.createSourceFile('tournaments.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let callback,sendCallback,lockCallback;
function walk(n){
 if(ts.isVariableDeclaration(n)&&n.initializer&&ts.isCallExpression(n.initializer)){
  const name=n.name.getText(parsed),t=n.initializer.arguments[0]?.getText(parsed);
  if(name==='load'&&t?.includes('bootFromSnapshot'))callback=t;
  if(name==='scoreLockedForRow')lockCallback=t;
 }
 if(ts.isPropertyAssignment(n)&&n.name.getText(parsed)==='send'&&n.initializer.getText(parsed).includes('save_hole_stats'))sendCallback=n.initializer.getText(parsed);
 ts.forEachChild(n,walk);
}
walk(parsed);assert.ok(callback);assert.ok(sendCallback);assert.ok(lockCallback);
function compileArrow(text,env){const js=ts.transpileModule('const fn='+text+'; return fn;',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;return Function(...Object.keys(env),js)(...Object.values(env));}
function adapter(mode='ok'){
 let sent,stats=0;
 const client={async rpc(){stats++;return{error:mode==='rpc-error'?{message:'denied'}:null}},from(){const q={update(body){sent=copy(body);return q},eq(){return q},select(){return q},maybeSingle:async()=>{
  if(mode==='throw')throw Error('network');
  return{data:mode==='zero'?null:{id:'p',...base,...sent},error:mode==='error'?{message:'denied'}:null};
 }};return q}};
 return{send:compileArrow(sendCallback,{supabase:client}),get stats(){return stats}};
}
const code=ts.transpileModule('const load='+callback+'; return load;',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
function room(server,opts={}){
 const state={players:[]},scoreRevisionRef={current:0},gameRef={current:null};
 const client={from(table){const q={select(){return q},eq(){return q},single(){return q},is(){return q},then(resolve,reject){
  if(opts.throwRead)return Promise.reject(Error('Injected network failure')).then(resolve,reject);
  if(opts.duringRead){const fn=opts.duringRead;opts.duringRead=null;fn(scoreRevisionRef);}
  const response=table==='games'?{data:{id:'g',holes_meta:[{n:1,par:4},{n:2,par:4}],scores_reset_at:opts.resetAt}}:table==='game_players'?{data:copy(server),error:opts.failRead?{message:'denied'}:null}:table==='rounds'?{count:0}:{data:[]};return Promise.resolve(response).then(resolve,reject);
 },update(){throw Error('load must not upload')}};return q;}};
 const env={...draft,...require(path.join(repo,'lib/alt-shot-side-scores.ts')),mergeBackupRow,supabase:client,gameId:'g',user:{id:'u'},scoreRevisionRef,recoveryReadyRef:{current:false},loadRequestRef:{current:0},scoreWriterRef:{current:null},resettingRef:{current:false},gameRef,playersRef:{current:[]},navigator,setGame:v=>state.game=v,setPlayers:v=>state.players=v,setMe:()=>{},setAltShotScores:()=>{},setCourseTees:()=>{},setNeedsSetup:()=>{},setLoading:()=>{},setPostedRoundCount:()=>{},setSyncState:v=>state.sync=v};
 return{load:Function(...Object.keys(env),code)(...Object.values(env)),state};
}
function seed(b=local,w=base){window.localStorage.clear();draft.saveGameScores('g','p',b,true,100);if(w)draft.saveSyncedWatermark('g','p',w);}
function writer(env={}){let backup=copy(local),wm=copy(base),locked=false,paused=false,sends=[],fail=false,hold=null;
 const deps={backup:()=>backup,watermark:()=>wm,confirm:(_,x)=>wm=copy(x),locked:()=>locked,paused:()=>paused,revision:()=>{},send:async(id,body,l)=>{sends.push({id,body:copy(body),locked:l});if(hold)await hold;return !fail},...env};
 return{w:createGameScoreWriter(deps),sends,get wm(){return wm},set backup(x){backup=copy(x)},set fail(x){fail=x},set locked(x){locked=x},set paused(x){paused=x},set hold(x){hold=x}};
}
(async()=>{
seed();let a=room([{id:'p',user_id:'u',...base}]);await a.load();assert.deepEqual(a.state.players[0].scores,[4,null]);assert.deepEqual(draft.loadSyncedWatermark('g','p').scores,[5,6]);assert.equal(pending(draft.loadGameScores('g','p'),draft.loadSyncedWatermark('g','p')),2,'read is not upload acknowledgement');assert.equal(draft.loadGameScores('g','p').at,100);
for(const opts of [{failRead:true},{throwRead:true}]){seed();a=room([{id:'p',user_id:'u',...base}],opts);await a.load();assert.deepEqual(draft.loadGameScores('g','p').scores,[4,null]);assert.deepEqual(draft.loadSyncedWatermark('g','p'),base);assert.equal(a.state.sync,'error');}
seed();a=room([{id:'p',user_id:'u',...base}],{duringRead:ref=>ref.current++});await a.load();assert.deepEqual(a.state.players,[],'stale read rejected');assert.deepEqual(draft.loadSyncedWatermark('g','p'),base);
seed();a=room([{id:'p',user_id:'u',...bundle([null,null])}],{resetAt:new Date(200).toISOString()});await a.load();assert.deepEqual(a.state.players[0].scores,[null,null]);assert.equal(pending(draft.loadGameScores('g','p'),draft.loadSyncedWatermark('g','p')),0);
seed(base,null);a=room([{id:'p',user_id:'u',...base}]);await a.load();assert.equal(pending(draft.loadGameScores('g','p'),draft.loadSyncedWatermark('g','p')),0,'baseline seeded');
seed();draft.saveGameSnapshot('g',{game:{id:'g',holes_meta:[{},{}]},players:[{id:'p',user_id:'u',...base}]});navigator.onLine=false;a=room([]);await a.load();assert.deepEqual(a.state.players[0].scores,[4,null]);assert.equal(draft.loadGameScores('g','p').at,100);assert.deepEqual(draft.loadSyncedWatermark('g','p'),base);navigator.onLine=true;
// Exercise the actual adapter: Supabase errors and silent zero rows are failures.
for(const mode of ['error','zero','throw']){const adapterTest=adapter(mode);const w=writer({send:adapterTest.send});assert.equal(await w.w.write('p'),false,mode);assert.deepEqual(w.wm,base);}
let adapterTest=adapter();assert.equal(await adapterTest.send('p',{scores:[4,null]},false),true);
adapterTest=adapter('rpc-error');assert.equal(await adapterTest.send('p',{putts:[1,2]},true),false);assert.equal(adapterTest.stats,1);
adapterTest=adapter('zero');assert.equal(await adapterTest.send('p',{putts:[1,2]},true),false,'void stats RPC must confirm a visible row');
const playersRef={current:[{id:'p',user_id:'u',tee_group:1},{id:'marker',user_id:'other',tee_group:1,is_marker:true}]},gameRef={current:{marker_user_id:null}};
const locked=compileArrow(lockCallback,{playersRef,gameRef,user:{id:'u'}});
assert.equal(locked('p'),true);assert.equal(locked('missing'),true);playersRef.current[1].user_id='u';assert.equal(locked('p'),false);playersRef.current.pop();gameRef.current.marker_user_id='other';assert.equal(locked('p'),true,'whole-game marker fallback');
let t=writer();t.fail=true;assert.equal(await t.w.write('p'),false);assert.deepEqual(t.wm,base);t.fail=false;assert.equal(await t.w.write('p'),true);assert.deepEqual(t.wm,local);
t=writer({send:async()=>{throw Error('offline')}});assert.equal(await t.w.write('p'),false);assert.deepEqual(t.wm,base);
t=writer();t.locked=true;assert.equal(await t.w.write('p'),false);assert.ok(t.sends[0].locked);assert.ok(!('scores' in t.sends[0].body));assert.deepEqual(t.wm.scores,base.scores);assert.deepEqual(t.wm.putts,local.putts);
t=writer();let release;t.hold=new Promise(r=>release=r);const first=t.w.write('p');await Promise.resolve();await Promise.resolve();assert.equal(t.sends.length,1);t.backup={...local,scores:[3,null]};const second=t.w.write('p');await Promise.resolve();assert.equal(t.sends.length,1);release();assert.equal(await first,false);assert.equal(await second,true);assert.deepEqual(t.wm.scores,[3,null]);assert.deepEqual(t.sends[1].body.scores,[3,null]);await t.w.idle();assert.equal(t.w.busy,false);
t=writer();t.paused=true;assert.equal(await t.w.write('p'),false);assert.equal(t.sends.length,0);
assert.ok(source.includes('.select("id,scores,putts,fairways,penalties,sand").maybeSingle()'));assert.ok(source.includes('void pushRowColsRef.current(m.id, bundle)'));assert.ok(source.includes('await scoreWriterRef.current?.idle()'));
console.log('PASS: actual load + sync helpers: corrections/deletions/all stats, remote edits, legacy, cold launch, denied/thrown/late reads, reset, rejected writes, marker permissions, concurrent writes and queue freshness');dom.window.close();
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1});
