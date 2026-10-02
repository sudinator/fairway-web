// Execute the actual device controller with two independent tab runtimes and shared browser storage.
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),Module=require('module');
const repo=path.resolve(__dirname,'..'),req=Module.createRequire(path.join(repo,'package.json')),ts=req('typescript');
const source=ts.transpileModule(fs.readFileSync(path.join(repo,'lib/scoring-device.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
function storage(){const map=new Map();return{get length(){return map.size},key:i=>[...map.keys()][i]??null,getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k),clear:()=>map.clear()};}
const shared=storage(),leases=new Map();let online=true,fail=false,holderIdle=false;
Object.defineProperty(globalThis,'navigator',{value:{get onLine(){return online}},configurable:true});
function tab(session=storage()){
 const m=new Module('device-controller',module);m._compile(source,'device-controller.js');
 const window={localStorage:shared,sessionStorage:session,location:{reload(){window.reloads++}},reloads:0};
 return{api:m.exports,window,async check(takeover=false,uid='u1'){global.window=window;await m.exports.checkScoringDevice(client,uid,takeover)},use(){global.window=window;return m.exports}};
}
const client={async rpc(name,args){assert.equal(name,'claim_scoring_device');if(fail)return{data:null,error:{message:'offline'}};const current=leases.get('u1');let active=!current||current===args.p_token||current===args.p_previous||args.p_takeover;let superseded=false;
 // 0166: a holder silent for the idle window is superseded without asking.
 if(!active&&holderIdle){active=true;superseded=true;}
 if(active)leases.set('u1',args.p_token);if(current!==args.p_token&&active)holderIdle=false;return{data:{active,resumed:!!current&&current===args.p_previous,...(superseded?{superseded:true}:{})},error:null};}};
(async()=>{
 const phone=tab();await phone.check();assert.equal(phone.api.scoringDeviceState(),'primary');
 const phoneToken=phone.api.scoringDeviceToken();phone.use().scoringStorage().setItem('bnn_round_draft_v1','phone offline score 4');
 const desktop=tab();await desktop.check();assert.equal(desktop.api.scoringDeviceState(),'viewer');assert.equal(leases.get('u1'),phoneToken,'opening desktop never transfers');
 assert.equal(desktop.use().scoringStorage().getItem('bnn_round_draft_v1'),null,'viewer cannot consume phone outbox');
 online=false;await phone.check();assert.equal(phone.api.scoringDeviceState(),'primary','primary stays usable offline');
 online=true;await desktop.check(true);assert.equal(desktop.api.scoringDeviceState(),'primary');assert.equal(desktop.window.reloads,1);
 const desktopToken=desktop.api.scoringDeviceToken();assert.notEqual(desktopToken,phoneToken);
 phone.use().scoringStorage().setItem('bnn_game_scores_g_p','late phone offline work');phone.use().scoringStorage().setItem('bnn_round_draft_v1','stale phone score 9');
 assert.equal(desktop.use().scoringStorage().getItem('bnn_game_scores_g_p'),null,'old tab cannot poison new primary outbox');
 await phone.check();assert.equal(phone.api.scoringDeviceState(),'viewer');assert.equal(phone.use().scoringStorage().getItem('bnn_round_draft_v1'),'stale phone score 9','revocation retains offline work');
 await phone.check();assert.equal(leases.get('u1'),desktopToken,'old phone never automatically takes control back');
 desktop.use().scoringStorage().setItem('bnn_game_scores_g_p','desktop saved 6');
 const reload=tab(desktop.window.sessionStorage);await reload.check();assert.equal(reload.api.scoringDeviceState(),'primary');assert.notEqual(reload.api.scoringDeviceToken(),desktopToken,'reload fences previous runtime');assert.equal(reload.use().scoringStorage().getItem('bnn_game_scores_g_p'),'desktop saved 6','normal reload recovers prior tab work');
 await desktop.check();assert.equal(desktop.api.scoringDeviceState(),'viewer','duplicate tab token rotation fences original');
 fail=true;await reload.check();assert.equal(reload.api.scoringDeviceState(),'primary','failed read is not revocation');fail=false;
 await phone.check(true);assert.equal(phone.api.scoringDeviceState(),'primary');assert.equal(phone.use().scoringStorage().getItem('bnn_round_draft_v1'),'phone offline score 4','same-browser explicit resume uses current primary backup, never stale 9');
 const archives=JSON.parse(shared.getItem('bnn_scoring_recovery_v1'));assert.ok(archives.some(a=>Object.values(a.data).includes('stale phone score 9')),'archived work remains recoverable');
 const offlineReload=tab(phone.window.sessionStorage);online=false;await offlineReload.check();assert.equal(offlineReload.api.scoringDeviceState(),'primary','known primary resumes offline');
 phone.api.releaseScoringDeviceRuntime();offlineReload.api.releaseScoringDeviceRuntime(); /* app fully closed: no runtime left to answer */ const closedMobile=tab();await closedMobile.check();assert.equal(closedMobile.api.scoringDeviceState(),'primary','known mobile resumes offline even when sessionStorage was lost');
 const freshOffline=tab();freshOffline.window.localStorage=storage();await freshOffline.check();assert.equal(freshOffline.api.scoringDeviceState(),'checking','unknown device cannot claim offline');online=true;
 leases.clear();online=true;
 const mobile=tab();mobile.window.localStorage=storage();const computer=tab();computer.window.localStorage=storage();await mobile.check();mobile.use().scoringStorage().setItem('bnn_round_draft_v1','offline mobile 8');await computer.check();assert.equal(computer.api.scoringDeviceState(),'viewer');await computer.check(true);computer.use().scoringStorage().setItem('bnn_round_draft_v1','desktop 3');await mobile.check();assert.equal(mobile.api.scoringDeviceState(),'viewer');assert.equal(mobile.use().scoringStorage().getItem('bnn_round_draft_v1'),'offline mobile 8');await mobile.check(true);assert.equal(mobile.use().scoringStorage().getItem('bnn_round_draft_v1'),null,'physical-device transfer back never replays stale offline 8');assert.ok(mobile.window.localStorage.getItem('bnn_scoring_recovery_v1').includes('offline mobile 8'));
 mobile.use().scoringStorage().setItem('bnn_round_draft_v1','same mobile pending 7');const mobileToken=mobile.api.scoringDeviceToken();
 const dupTab=tab();dupTab.window.localStorage=mobile.window.localStorage;await dupTab.check();assert.equal(dupTab.api.scoringDeviceState(),'viewer','a second tab while the first is still open is a duplicate, not a relaunch');assert.equal(leases.get('u1'),mobileToken,'the open tab keeps the lease');dupTab.api.releaseScoringDeviceRuntime();
 mobile.api.releaseScoringDeviceRuntime(); /* the app is killed: its runtime can no longer answer */ const closedOnline=tab();closedOnline.window.localStorage=mobile.window.localStorage;await closedOnline.check();assert.equal(closedOnline.api.scoringDeviceState(),'primary','193.3: the same installation relaunched online (sessionStorage lost) resumes silently, no prompt');assert.equal(closedOnline.window.reloads,0,'a silent resume does not reload');assert.notEqual(closedOnline.api.scoringDeviceToken(),mobileToken,'resume rotates the token so the dead runtime is fenced');assert.equal(closedOnline.use().scoringStorage().getItem('bnn_round_draft_v1'),'same mobile pending 7','known installation resume retains its still-current pending work');assert.equal(leases.get('u1'),closedOnline.api.scoringDeviceToken());
 const otherDevice=tab();otherDevice.window.localStorage=storage();await otherDevice.check();assert.equal(otherDevice.api.scoringDeviceState(),'viewer','a different device still gets the prompt');assert.equal(leases.get('u1'),closedOnline.api.scoringDeviceToken(),'a different device opening never takes the lease');
 const strangerInstall=tab();strangerInstall.window.localStorage=storage();strangerInstall.window.localStorage.setItem('bnn_primary_scoring_owner_v1',JSON.stringify({user:'u1',token:'stale-token-from-last-month'}));await strangerInstall.check();assert.equal(strangerInstall.api.scoringDeviceState(),'viewer','an installation whose remembered token is no longer the lease stays a viewer');
 // 0166: the holder (closedOnline) goes silent; a different device opened later takes over without a prompt
 // and starts clean (its old outbox archived, not replayed); the old holder is fenced when it returns.
 closedOnline.use().scoringStorage().setItem('bnn_round_draft_v1','holder work before going silent');
 const idleLaptop=tab();idleLaptop.window.localStorage=storage();idleLaptop.window.localStorage.setItem('bnn_primary_scoring_owner_v1',JSON.stringify({user:'u1',token:'laptop-old-token'}));
 idleLaptop.window.localStorage.setItem('bnn_device_scores:u1:laptop-old-token:bnn_round_draft_v1','laptop stale outbox from last month');
 holderIdle=true;await idleLaptop.check();assert.equal(idleLaptop.api.scoringDeviceState(),'primary','idle holder is superseded silently');assert.equal(idleLaptop.window.reloads,0);
 assert.equal(idleLaptop.use().scoringStorage().getItem('bnn_round_draft_v1'),null,'superseding device never replays its own stale outbox');
 assert.ok(idleLaptop.window.localStorage.getItem('bnn_scoring_recovery_v1').includes('laptop stale outbox from last month'),'stale outbox archived for download');
 await closedOnline.check();assert.equal(closedOnline.api.scoringDeviceState(),'viewer','silent holder is fenced when it returns');
 assert.equal(closedOnline.use().scoringStorage().getItem('bnn_round_draft_v1'),'holder work before going silent','fenced holder keeps its unsynced work');
 holderIdle=false;const liveLaptop2=tab();liveLaptop2.window.localStorage=storage();await liveLaptop2.check();assert.equal(liveLaptop2.api.scoringDeviceState(),'viewer','a live holder still fences every other device');
 await closedOnline.check(true);assert.equal(closedOnline.api.scoringDeviceState(),'primary','explicit takeover still works');
 // Execute the shipped Supabase fetch adapter: capture a token at request time,
 // preserve auth headers, retain the response, and surface database fencing.
 const httpModule=new Module('device-http',module);httpModule.require=id=>id==='./scoring-device'?closedOnline.api:id==='@supabase/ssr'?{createBrowserClient:(_url,_key,options)=>({send:options.global.fetch})}:require(id);
 httpModule._compile(ts.transpileModule(fs.readFileSync(path.join(repo,'lib/supabase.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,'device-http.js');
 const realFetch=global.fetch;let sentHeaders;global.fetch=async(_input,init)=>{sentHeaders=init.headers;return new Response(JSON.stringify({message:'Scoring is active on another device. Make this device primary to continue; your local scores are preserved.'}),{status:400,headers:{'content-type':'application/json'}})};
 const response=await httpModule.exports.createClient().send(new Request('https://api.invalid/score',{headers:{Authorization:'Bearer test-token'}}));assert.equal(sentHeaders.get('authorization'),'Bearer test-token');assert.equal(sentHeaders.get('x-bnn-scoring-device'),closedOnline.api.scoringDeviceToken());assert.equal(closedOnline.api.scoringDeviceState(),'viewer','database rejection reaches UI controller');assert.equal(response.status,400);assert.match((await response.json()).message,/Scoring is active/);global.fetch=realFetch;
 console.log('PASS: actual controller phone-first, silent same-installation relaunch, passive desktop, offline primary, explicit transfer, tab fencing, isolated outboxes, retained/archived work, normal and offline reload, failed-read retention');
})().catch(e=>{console.error(e);process.exitCode=1});
