// Actual Operations component; read-only RPC responses are MODELLED.
const fs=require('fs'),path=require('path'),Module=require('module'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),req=Module.createRequire(path.join(root,'package.json')),ts=req('typescript');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,f);
const orig=Module._load;Module._load=function(id,parent,main){return orig.call(this,id.startsWith('@/')?path.join(root,id.slice(2)):id,parent,main)};
require('../lib/test-dom.ts');const React=req('react'),{act,useState,useEffect}=React,{createRoot}=req('react-dom/client'),{C}=require('../lib/golf.ts');
const source=fs.readFileSync(path.join(root,'components/manage.tsx'),'utf8'),p=ts.createSourceFile('manage.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const node=p.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='OpsMetrics');assert.ok(node);
const js=ts.transpileModule(node.getText(p).replace("export function", "function"),{compilerOptions:{target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.React}}).outputText;
(async()=>{let count=0;for(const job of [{scheduled:true,last_run:null},{scheduled:true,last_run:{finished_at:'2026-11-14T09:00:00Z',completed_games:3,deleted_games:2,reviewed_games:1,completed_rounds:4,failures:0}},{scheduled:false,last_run:{failures:2}}]){
 const el=document.createElement('div');document.body.append(el);const r=createRoot(el);const Ops=Function('React','useState','useEffect','supabase','rpcAll','failureMessage','C','useAnalyticsRpc','AnalyticsReadStatus',js+'return OpsMetrics;')(React,useState,useEffect,{rpc:()=>Promise.resolve({data:{stale_job:job},error:null})},()=>Promise.resolve({data:[]}),()=>'',C,require('../components/analytics-read.tsx').useAnalyticsRpc,require('../components/analytics-read.tsx').AnalyticsReadStatus);
 await act(async()=>{r.render(React.createElement(Ops));await new Promise(x=>setTimeout(x,0))});assert.ok(el.textContent.includes('Daily cleanup · 4 a.m. Eastern'));count++;
 assert.ok(el.textContent.includes(job.scheduled?'Scheduled':'Not scheduled'));count++;
 if(!job.last_run)assert.ok(el.textContent.includes('No daily cleanup run recorded yet.'));else assert.ok(el.textContent.includes(`${job.last_run.failures} failures`));count++;
 await act(async()=>r.unmount());el.remove();
 }console.log(`stale Operations: PASS (${count} rendered assertions; actual component, MODELLED read-only RPC)`);
})().catch(e=>{console.error(e);process.exit(1)});
