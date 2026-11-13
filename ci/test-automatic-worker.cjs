// Execute actual worker event handlers with MODELLED fetch/cache failures.
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../public/sw.js'),'utf8');
const origin='https://bnn-worker.test';
function setup({failAssets=false,redirectAssets=false,loginAssets=false,quota=false,offline=false}={}) {
 const events={},stores=new Map(),windows=[{id:'page'}];let skipped=0,rootResponse=null,root='<body data-bnn-app-shell="v1"><script src="/chunk.js"></script>new shell';
 function store(name){if(!stores.has(name))stores.set(name,new Map());const data=stores.get(name);return{async match(req){return data.get(typeof req==='string'?new URL(req,origin).href:req.url)?.clone()},async put(req,response){if(quota)throw Error('quota');data.set(typeof req==='string'?new URL(req,origin).href:req.url,response.clone());}};}
 const caches={open:async name=>store(name),keys:async()=>[...stores.keys()],delete:async name=>stores.delete(name),async match(req){for(const name of stores.keys()){const r=await store(name).match(req);if(r)return r;}}};
 const self={location:{origin},addEventListener:(name,fn)=>events[name]=fn,skipWaiting:async()=>{skipped++},clients:{matchAll:async()=>windows}};
 const fetch=async(req)=>{if(offline)throw Error('offline');const url=typeof req==='string'?new URL(req,origin).href:req.url;if(rootResponse&&!url.endsWith('/chunk.js'))return rootResponse;if(url.endsWith('/chunk.js')&&(redirectAssets||loginAssets)){const r=new Response('Sign in',{headers:{'Content-Type':loginAssets?'text/html':'application/javascript'}});Object.defineProperty(r,'redirected',{value:redirectAssets});return r;}return new Response(url.endsWith('/chunk.js')?(failAssets?'missing':'code'):root,{status:url.endsWith('/chunk.js')&&failAssets?404:200});};
 vm.runInNewContext(source,{self,caches,fetch,URL,Response,AbortController,setTimeout,clearTimeout,Uint8Array,atob,console});
 async function event(name,extra={}){const wait=[];let response;events[name]({...extra,waitUntil:p=>wait.push(p),respondWith:p=>{response=p}});const result=response?await response:undefined;await Promise.all(wait);return result;}
 const nav=()=>event('fetch',{request:{url:origin+'/',method:'GET',mode:'navigate'}});
 return {event,nav,caches,stores,windows,get skipped(){return skipped},setRoot:v=>root=v,setResponse:v=>rootResponse=v};
}
(async()=>{
 let s=setup();await s.event('install');assert.equal(s.skipped,0,'install does not restart older open pages');await s.event('message',{data:'SKIP_WAITING'});assert.equal(s.skipped,1,'existing production button explicitly activates without score gates');let cache=(await s.caches.keys()).find(k=>k.startsWith('bnn-shell-'));assert.equal(await(await(await s.caches.open(cache)).match('/chunk.js')).text(),'code','shell scripts cached before root commit');assert.match(await(await(await s.caches.open(cache)).match('/')).text(),/new shell/);s.setRoot('fresh online shell');assert.equal(await(await s.nav()).text(),'fresh online shell','network beats old cached HTML');
 s=setup({quota:true});assert.match(await(await s.nav()).text(),/new shell/,'cache quota never replaces successful fresh navigation with old content');
 s=setup({failAssets:true});await(await s.caches.open('bnn-shell-old')).put('/',new Response('old working shell'));await s.event('install');assert.equal(s.skipped,0,'failed asset download never activates automatically');cache=(await s.caches.keys()).find(k=>k!=='bnn-shell-old');assert.equal(await(await s.caches.open(cache)).match('/'),undefined,'incomplete shell not committed');
 await s.event('message',{data:{kind:'bnn-cleanup-shells',version:JSON.parse(source.match(/const SW_VERSION = ("[^"]+")/)[1])},source:{id:'page'}});assert.ok((await s.caches.keys()).includes('bnn-shell-old'),'cannot prune last working shell when new shell incomplete');
 s=setup({offline:true});await(await s.caches.open('bnn-shell-old')).put('/',new Response('old working shell'));assert.equal(await(await s.nav()).text(),'old working shell','offline install/restart falls back to working older shell');
 for(const pathname of ['/api/scores','/auth/callback','/live/token','/lineup/token','/app-version.json'])assert.equal(await s.event('fetch',{request:{url:origin+pathname,method:'GET',mode:'navigate'}}),undefined,'live/auth/version requests bypass worker');
 assert.equal(await s.event('fetch',{request:{url:origin+'/',method:'POST',mode:'cors'}}),undefined,'score POST never intercepted');
 for(const options of [{redirectAssets:true},{loginAssets:true}]) {
  s=setup(options);await(await s.caches.open('bnn-shell-old')).put('/',new Response('old working shell'));await s.event('install');
  const currentCache=(await s.caches.keys()).find(k=>k!=='bnn-shell-old');
  assert.equal(await(await s.caches.open(currentCache)).match('/'),undefined,'login/redirected asset cannot commit a broken offline shell');
  assert.equal(await(await(await s.caches.open('bnn-shell-old')).match('/')).text(),'old working shell','old offline app retained after asset access failure');
 }
 // Navigation redirects are responses to forward, not offline failures.
 for(const response of [{type:'opaqueredirect',status:0,ok:false}, ...[301,302,303,307,308].map(status=>new Response(null,{status,headers:{Location:'/sign-in'}}))]) {
  s=setup();await(await s.caches.open('bnn-shell-old')).put('/',new Response('old working shell'));s.setResponse(response);
  assert.equal(await s.nav(),response,'redirect passes through before cached fallback');
  assert.equal(await(await(await s.caches.open('bnn-shell-old')).match('/')).text(),'old working shell','redirect never overwrites offline shell');
 }
 s=setup();const login=new Response('<title>Sign in</title>');Object.defineProperty(login,'redirected',{value:true});s.setResponse(login);await s.event('install');
 assert.equal((await s.caches.keys()).length,0,'followed login response is not installed as offline shell');
 await(await s.caches.open('bnn-shell-old')).put('/',new Response('old working shell'));assert.equal(await s.nav(),login,'a followed login page stays visible to the browser');
 assert.equal(await(await(await s.caches.open('bnn-shell-old')).match('/')).text(),'old working shell','followed login never replaces cached app');
 s=setup();s.setResponse(new Response('<title>Deployment sign-in</title>'));await s.event('install');
 assert.equal(await(await s.caches.open('bnn-shell-'+JSON.parse(source.match(/const SW_VERSION = ("[^"]+")/)[1]))).match('/'),undefined,'200 login without app marker is not cached');
 s=setup();await(await s.caches.open('bnn-shell-old')).put('/',new Response('old working shell'));s.setResponse(new Response('temporarily unavailable',{status:503}));
 assert.equal(await(await s.nav()).text(),'old working shell','server outage retains offline scoring fallback');
 console.log('automatic worker: PASS (actual handlers; modelled network/cache quota and asset failures, complete offline fallback, cache cleanup safety, API/auth/version bypass)');
})().catch(e=>{console.error(e);process.exitCode=1;});
