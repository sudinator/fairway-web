// Execute the shipped organizer callback; simulated Supabase/network, not a browser pass.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'../components/tournaments.tsx'),'utf8');
const parsed=ts.createSourceFile('tournaments.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let callback;
function walk(n){if(ts.isVariableDeclaration(n)&&n.name.getText(parsed)==='resetScores')callback=n.initializer.getText(parsed);ts.forEachChild(n,walk)}walk(parsed);assert.ok(callback);
const js=ts.transpileModule('const fn='+callback+'; return fn;',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
function scenario({confirm=true,fail=false,viewer=false}={}){
 const state={players:[{id:'p',scores:[5],putts:[2]}],draft:[4],altDraft:[7],loads:0,clears:0,rpcs:0,alerts:[],events:[]};
 const env={isPrimaryScoringDevice:()=>!viewer,game:{id:'g',name:'Reset test',holes_meta:[{}]},user:{id:'u'},displayName:'User',resettingRef:{current:false},scoreRevisionRef:{current:0},scoreWriterRef:{current:{idle:async()=>state.events.push('idle')}},confirm:()=>confirm,alert:s=>state.alerts.push(s),setPlayers:f=>{state.players=f(state.players);state.events.push('clear-ui')},setMe:()=>{},clearAllGameScores:()=>{state.draft=null;state.clears++;state.events.push('clear-draft')},clearAllAltShotDrafts:()=>{state.altDraft=null},supabase:{rpc:async()=>{state.rpcs++;state.events.push('rpc');return{error:fail?{message:'injected reset failure'}:null}}},logActivity:async()=>{},load:async()=>{state.loads++;state.events.push('load')}};
 return{state,env,run:Function(...Object.keys(env),js)(...Object.values(env))};
}
(async()=>{
 let t=scenario({confirm:false});await t.run();assert.equal(t.state.rpcs,0);assert.deepEqual(t.state.draft,[4]);assert.equal(t.env.resettingRef.current,false);
 t=scenario({viewer:true});await t.run();assert.equal(t.state.rpcs,0);assert.deepEqual(t.state.draft,[4]);assert.equal(t.state.alerts.length,1);
 t=scenario({fail:true});await t.run();assert.deepEqual(t.state.players[0].scores,[5]);assert.deepEqual(t.state.draft,[4]);assert.deepEqual(t.state.altDraft,[7]);assert.equal(t.state.clears,0);assert.equal(t.state.loads,1);assert.equal(t.env.resettingRef.current,false);
 t=scenario();await t.run();assert.deepEqual(t.state.players[0].scores,[null]);assert.equal(t.state.draft,null);assert.equal(t.state.altDraft,null);assert.ok(t.state.events.indexOf('rpc')<t.state.events.indexOf('clear-draft'));assert.ok(t.state.events.indexOf('idle')<t.state.events.indexOf('rpc'));assert.equal(t.env.resettingRef.current,false);
 console.log('PASS: actual reset callback, viewer denial, cancel, idle-before-reset, failed reset retains UI/player/side drafts, confirmed reset clears after success and reloads');
})().catch(e=>{console.error(e);process.exitCode=1});
