// Actual Home loader + draft helpers + yellow component; database responses MODELLED.
const fs=require('fs'),path=require('path'),Module=require('module'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),req=Module.createRequire(path.join(root,'package.json')),ts=req('typescript');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,f);
const orig=Module._load;Module._load=function(id,parent,main){return orig.call(this,id.startsWith('@/')?path.join(root,id.slice(2)):id,parent,main)};
require('../lib/test-dom.ts');const React=req('react'),{act}=React,{createRoot}=req('react-dom/client');
const draft=require('../lib/draft.ts'),{prepareRound}=require('../lib/round-prep.ts'),{dedupeHoles}=require('../lib/golf.ts'),{RoundRecovery}=require('../components/round-recovery.tsx');
const src=fs.readFileSync(path.join(root,'components/home.tsx'),'utf8'),tree=ts.createSourceFile('home.tsx',src,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let loader;
function walk(n){if(ts.isVariableDeclaration(n)&&n.name.getText(tree)==='loadRounds')loader=n.getText(tree);ts.forEachChild(n,walk)}walk(tree);assert.ok(loader);
const js=ts.transpileModule('const '+loader+';',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
const local={id:'a',status:'in_progress',course:'Recovered course',played_at:'2026-11-14',rating:72,slope:113,course_par:72,holes:[{hole_number:1,par:4,stroke_index:1,strokes:5}]};
(async()=>{let checks=0;
 for(const spec of [{status:'final',pending:false,want:0},{status:'final',pending:true,want:1},{status:'in_progress',pending:false,want:1},{status:'final',pending:false,readFail:true,want:1},{status:'final',pending:false,holesFail:true,want:1},{status:'final',pending:false,missing:true,want:1},{status:'final',pending:false,offline:true,want:1}]){
 localStorage.clear();draft.saveDraft(local,true);if(!spec.pending)draft.savePersonalRoundAck(local);
 Object.defineProperty(navigator,'onLine',{value:!spec.offline,configurable:true});let localState=local,db=null,finished=[];
 const q=new Proxy(()=>q,{get:()=>()=>q,apply:()=>q});
 const vars={useCallback:f=>f,user:{id:'owner'},supabase:{from:()=>q},fetchAll:async()=>{if(spec.readFail)throw Error('injected read');return spec.missing?[]:[{...local,status:spec.status}]},fetchAllIn:async()=>{if(spec.holesFail)throw Error('injected holes');return local.holes.map(h=>({...h,round_id:'a'}))},prepareRound,dedupeHoles,loadDraft:draft.loadDraft,personalDraftIsPending:draft.personalDraftIsPending,clearDraft:draft.clearDraft,refreshDraft:()=>localState=draft.loadDraft()?.round||null,setRounds:r=>finished=r,setDbInProgress:r=>db=r,setInProgressCount:()=>{},setLoading:()=>{}};
 const load=Function(...Object.keys(vars),js+'return loadRounds;')(...Object.values(vars));await load();
 const host=document.createElement('div');document.body.append(host);const renderer=createRoot(host);await act(async()=>renderer.render(React.createElement(RoundRecovery,{draft:localState,server:db,count:db?1:0,onResume:()=>{},onComplete:()=>{},onDelete:()=>{},onDiscardAll:()=>{}})));
 assert.equal(host.querySelectorAll('[data-round-recovery]').length,spec.want);checks++;
 assert.equal(!!draft.loadDraft(),!!spec.want);checks++;
 if(!spec.want){assert.equal(finished.length,1);checks++}
 await act(async()=>renderer.unmount());host.remove();
 }Object.defineProperty(navigator,'onLine',{value:true,configurable:true});
 console.log(`stale-round reconciliation: PASS (${checks} assertions; actual Home loader/draft/component, MODELLED reads; acknowledged final clears, pending/offline/error/missing preserves)`);
})().catch(e=>{console.error(e);process.exit(1)});
