// Execute actual worker event handlers with MODELLED fetch/cache failures.
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../public/sw.js'),'utf8');
const origin='https://bnn-worker.test';
function setup({failAssets=false,quota=false,offline=false}={}) {
 const events={},stores=new Map(),windows=[{id:'page'}];let skipped=0,root='<script src="/chunk.js"></script>new shell';
 function store(name){if(!stores.has(name))stores.set(name,new Map());const data=stores.get(name);return{async match(req){return data.get(typeof req==='string'?new URL(req,origin).href:req.url)?.clone()},async put(req,response){if(quota)throw Error('quota');data.set(typeof req==='string'?new URL(req,origin).href:req.url,response.clone());}};}
 const caches={open:async name=>store(name),keys:async()=>[...stores.keys()],delete:async name=>stores.delete(name),async match(req){for(const name of stores.keys()){const r=await store(name).match(req);if(r)return r;}}};
 const self={location:{origin},addEventListener:(name,fn)=>events[name]=fn,skipWaiting:async()=>{skipped++},clients:{matchAll:async()=>windows}};
 const fetch=async(req)=>{if(offline)throw Error('offline');const url=typeof req==='string'?new URL(req,origin).href:req.url;return new Response(url.endsWith('/chunk.js')?(failAssets?'missing':'code'):root,{status:url.endsWith('/chunk.js')&&failAssets?404:200});};
 vm.runInNewContext(source,{self,caches,fetch,URL,Response,AbortController,setTimeout,clearTimeout,Uint8Array,atob,console});
 async function event(name,extra={}){const wait=[];let response;events[name]({...extra,waitUntil:p=>wait.push(p),respondWith:p=>{response=p}});const result=response?await response:undefined;await Promise.all(wait);return result;}
 const nav=()=>event('fetch',{request:{url:origin+'/',method:'GET',mode:'navigate'}});
 return {event,nav,caches,stores,windows,get skipped(){return skipped},setRoot:v=>root=v};
}
(async()=>{
 let s=setup();await s.event('install');assert.equal(s.skipped,0,'install does not restart older open pages');await s.event('message',{data:'SKIP_WAITING'});assert.equal(s.skipped,1,'existing production button explicitly activates without score gates');let cache=(await s.caches.keys()).find(k=>k.startsWith('bnn-shell-'));assert.equal(await(await(await s.caches.open(cache)).match('/chunk.js')).text(),'code','shell scripts cached before root commit');assert.match(await(await(await s.caches.open(cache)).match('/')).text(),/new shell/);s.setRoot('fresh online shell');assert.equal(await(await s.nav()).text(),'fresh online shell','network beats old cached HTML');
 s=setup({quota:true});assert.match(await(await s.nav()).text(),/new shell/,'cache quota never replaces successful fresh navigation with old content');
 s=setup({failAssets:true});await(await s.caches.open('bnn-shell-old')).put('/',new Response('old working shell'));await s.event('install');assert.equal(s.skipped,0,'failed asset download never activates automatically');cache=(await s.caches.keys()).find(k=>k!=='bnn-shell-old');assert.equal(await(await s.caches.open(cache)).match('/'),undefined,'incomplete shell not committed');
 await s.event('message',{data:{kind:'bnn-cleanup-shells',version:JSON.parse(source.match(/const SW_VERSION = ("[^"]+")/)[1])},source:{id:'page'}});assert.ok((await s.caches.keys()).includes('bnn-shell-old'),'cannot prune last working shell when new shell incomplete');
 s=setup({offline:true});await(await s.caches.open('bnn-shell-old')).put('/',new Response('old working shell'));assert.equal(await(await s.nav()).text(),'old working shell','offline install/restart falls back to working older shell');
 for(const pathname of ['/api/scores','/auth/callback','/live/token','/lineup/token','/app-version.json'])assert.equal(await s.event('fetch',{request:{url:origin+pathname,method:'GET',mode:'navigate'}}),undefined,'live/auth/version requests bypass worker');
 assert.equal(await s.event('fetch',{request:{url:origin+'/',method:'POST',mode:'cors'}}),undefined,'score POST never intercepted');
 console.log('automatic worker: PASS (actual handlers; modelled network/cache quota and asset failures, complete offline fallback, cache cleanup safety, API/auth/version bypass)');
})().catch(e=>{console.error(e);process.exitCode=1;});
