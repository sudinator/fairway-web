// 212.31 — many browser tabs share one localStorage (owner, Oct 23: most members use the browser and leave old tabs
// open). Runs the REAL lib/scoring-device controller with N tab runtimes over one shared storage and checks storage
// stays bounded: suspended old tabs hand over by MOVING backups (no duplication); live old tabs keep the lease and new
// tabs are viewers; 50 abandoned tabs stay far under the ~5 MB browser limit.
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),Module=require('module');
const repo=path.resolve(__dirname,'..'),req=Module.createRequire(path.join(repo,'package.json')),ts=req('typescript');
const source=ts.transpileModule(fs.readFileSync(path.join(repo,'lib/scoring-device.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
function storage(){const map=new Map();return{map,get length(){return map.size},key:i=>[...map.keys()][i]??null,getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k),clear:()=>map.clear()};}
const leases=new Map();
Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
if(!globalThis.crypto)globalThis.crypto=require('crypto').webcrypto;
const client={async rpc(n,a){const c=leases.get('u1');const active=!c||c===a.p_token||c===a.p_previous||a.p_takeover;if(active)leases.set('u1',a.p_token);return{data:{active,resumed:!!c&&c===a.p_previous},error:null};}};
function tab(shared){const m=new Module('dc',module);m._compile(source,'dc.js');const w={localStorage:shared,sessionStorage:storage(),location:{reload(){}}};
 return{api:m.exports,async check(t=false){global.window=w;await m.exports.checkScoringDevice(client,'u1',t)},use(){global.window=w;return m.exports}};}
const card=(h)=>JSON.stringify({at:Date.now(),scores:Array.from({length:4},()=>Array.from({length:18},(_,i)=>i<h?4+(i%3):null)),putts:Array.from({length:4},()=>Array(18).fill(2)),fairways:[],penalties:[],sand:[]});
const bytes=s=>[...s.map].reduce((n,[k,v])=>n+k.length+v.length,0)*2;
const backups=s=>[...s.map.keys()].filter(k=>k.startsWith('bnn_device_scores:')).length;
(async()=>{
 // 1. phone browser: a new tab each time, old ones suspended (cannot answer the liveness ping)
 let s=storage();const open=[];
 for(let i=1;i<=10;i++){open.forEach(o=>o.api.releaseScoringDeviceRuntime());const t=tab(s);await t.check();open.push(t);t.use().scoringStorage().setItem('bnn_game_scores_G1',card(i));}
 assert.equal(open.at(-1).api.scoringDeviceState(),'primary','the newest tab scores');
 assert.equal(backups(s),1,'ten tab hand-overs leave ONE backup (moved, never copied)');
 assert.ok(open.at(-1).use().scoringStorage().getItem('bnn_game_scores_G1').includes('"at"'),'the newest tab holds the work');
 // 2. computer: old tab still alive -> new tabs are viewers, the first keeps scoring
 s=storage();leases.clear();const first=tab(s);await first.check();
 for(let i=0;i<10;i++){const t=tab(s);await t.check();assert.equal(t.api.scoringDeviceState(),'viewer','a second live tab is a viewer');}
 assert.equal(first.api.scoringDeviceState(),'primary','the open tab keeps the lease');
 // 3. worst case: 50 abandoned tabs, each with a different game's unsent backup
 s=storage();leases.clear();for(let i=0;i<50;i++){const t=tab(s);await t.check();t.use().scoringStorage().setItem('bnn_game_scores_G'+i,card(18));}
 assert.ok(bytes(s)<500*1024,`50 abandoned tabs stay under 500 KB (got ${(bytes(s)/1024).toFixed(1)} KB)`);
 console.log(`PASS: multi-tab storage — 10 hand-overs keep 1 backup; live tabs fence new ones; 50 tabs = ${(bytes(s)/1024).toFixed(1)} KB`);
})().catch(e=>{console.error(e);process.exit(1);});
