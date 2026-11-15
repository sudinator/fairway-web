// Actual hook/status. Deferred RPCs model failures, latency and out-of-order responses.
const fs=require('fs'),path=require('path'),Module=require('module'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),ts=require('typescript');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,f);
const orig=Module._load;Module._load=function(id,parent,main){return orig.call(this,id.startsWith('@/')?path.join(root,id.slice(2)):id,parent,main)};
require('../lib/test-dom.ts');const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
const {useAnalyticsRpc,AnalyticsReadStatus}=require('../components/analytics-read.tsx');
let n=0;const ok=(v,s)=>{n++;assert.ok(v,s)};const wait=()=>new Promise(r=>setTimeout(r,0));
(async()=>{
 const el=document.createElement('div');document.body.append(el);const r=createRoot(el);let current,queue=[];
 const db={rpc:(name,args)=>new Promise((resolve,reject)=>queue.push({name,args,resolve,reject}))};
 function Probe({scope}){current=useAnalyticsRpc(db,'analytics',{scope});return React.createElement('div',null,React.createElement(AnalyticsReadStatus,current),React.createElement('output',null,current.data==null?'No figures':String(current.data.count)));}
 const render=async scope=>act(async()=>{r.render(React.createElement(Probe,{scope}));await wait()});
 const settle=async(i,value)=>act(async()=>{queue[i].resolve(value);await wait()});
 await render('A');ok(el.textContent.includes('Updating'),'visible initial loading');
 await settle(0,{data:{count:0}});ok(el.querySelector('output').textContent==='0'&&!el.querySelector('[role=alert]'),'successful zero is not failure');ok(current.loadedAt,'freshness recorded');
 await act(async()=>{current.retry();await wait()});await settle(1,{data:null,error:{message:'network'}});
 ok(el.textContent.includes('last loaded figures')&&el.querySelector('output').textContent==='0','same-scope failure retains good figures with warning');ok(el.textContent.includes('Retry'),'retry available');
 await act(async()=>{current.retry();await wait()});await settle(2,{data:{count:7}});ok(!el.querySelector('[role=alert]')&&el.querySelector('output').textContent==='7','retry clears failure and updates data');
 await render('B');ok(current.data===null&&!current.loadedAt,'new scope never displays A data');
 await render('A');await settle(4,{data:{count:8}});await settle(3,{data:{count:99}});ok(current.data.count===8,'late B cannot overwrite new A');
 await render('C');await settle(5,{data:null});ok(el.querySelector('[role=alert]')&&!current.loadedAt&&current.data===null,'empty response is visible error, never zero');
 // Capture only the real hook deadline; leave React and the test event loop untouched.
 const originalTimer=global.setTimeout;let deadline;
 global.setTimeout=(fn,ms,...args)=>ms===20000?(deadline=fn,originalTimer(()=>{},200000)):originalTimer(fn,ms,...args);
 await render('timeout');global.setTimeout=originalTimer;await act(async()=>{deadline();await wait()});
 ok(el.textContent.includes('too long')&&!current.loading,'timeout stops spinner with recovery');await settle(6,{data:{count:88}});ok(current.data===null,'timed-out result cannot masquerade as fresh data');
 await render('unmounted');await act(async()=>r.unmount());await settle(7,{data:{count:42}});ok(!el.textContent,'unmounted response ignored');el.remove();
 console.log(`analytics read: ${n} passed, 0 failed`);
})().catch(e=>{console.error(e);process.exitCode=1});
