// Actual yellow component + extracted Home handlers. Database/editor are MODELLED.
const fs=require('fs'),path=require('path'),Module=require('module'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),req=Module.createRequire(path.join(root,'package.json')),ts=req('typescript');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,f);
const original=Module._load;Module._load=function(id,parent,main){return original.call(this,id.startsWith('@/')?path.join(root,id.slice(2)):id,parent,main)};
require('../lib/test-dom.ts');const React=req('react'),{act,useState}=React,{createRoot}=req('react-dom/client');
const {RoundRecovery,recoveryRounds}=require('../components/round-recovery.tsx'),draft=require('../lib/draft.ts');
const source=fs.readFileSync(path.join(root,'components/home.tsx'),'utf8'),parsed=ts.createSourceFile('home.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const names=['clearRecoveredDraft','deleteRound','markRoundComplete','discardAllInProgress','resumePersonalRound','completeRecoveredRound'];const declarations=[];let panel;
function walk(n){if(ts.isVariableDeclaration(n)&&names.includes(n.name.getText(parsed)))declarations.push('const '+n.getText(parsed)+';');if(ts.isJsxSelfClosingElement(n)&&n.tagName.getText(parsed)==='RoundRecovery')panel=n.getText(parsed);ts.forEachChild(n,walk)}walk(parsed);
assert.equal(declarations.length,names.length);assert.ok(panel);assert.ok(!source.includes('"You have an unfinished round"'), 'independent green recovery panel must not return');assert.equal((source.match(/<RoundRecovery /g)||[]).length,1);
const js=ts.transpileModule(declarations.join('\n')+'\nfunction Panel(){return ('+panel+');}',{compilerOptions:{target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.React}}).outputText;
let checks=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++};
const round=(id,strokes=5)=>({id,draft_session_id:id,status:'in_progress',course:'Francis Byrne',played_at:'2026-11-14',holes:[{hole_number:1,par:4,stroke_index:1,strokes}],rating:72,slope:113,course_par:72});
async function fixture({local=round('a',6),server=round('a',5),pending=true,fail=false,count=1,confirm=true,returned=['a'],delay=false}={}){
 localStorage.clear();if(local){draft.saveDraft(local,true);if(!pending)draft.savePersonalRoundAck(local)}
 let db=server,write=[],notes=[],alerts=[],stageValue=null,release;const gate=delay?new Promise(r=>release=r):Promise.resolve();
 const supabase={from(table){eq(table,'rounds');const filters={};let patch;const q={update(p){patch=p;return q},eq(k,v){filters[k]=v;return q},is(k,v){filters[k]=v;return q},select(){return q},then(resolve){write.push({patch,filters});if(!fail)db=null;return gate.then(()=>({error:fail?{message:'injected failure'}:null,data:returned.map(id=>({id}))})).then(resolve)}};return q}};
 window.confirm=()=>confirm;window.alert=m=>alerts.push(m);
 const el=document.createElement('div');document.body.append(el);const renderer=createRoot(el);
 let back;
 function Host(){
 const [draftRound,setDraftRound]=useState(local),[dbInProgress,setDbInProgress]=useState(server),[stage,setStage]=useState(null);
 const refreshDraft=()=>setDraftRound(draft.loadDraft()?.round||null),loadRounds=async()=>setDbInProgress(db);
 const create=Function('React','RoundRecovery','draftRound','dbInProgress','inProgressCount','supabase','rounds','user','displayName','logActivity','clearDraft','refreshDraft','loadRounds','loadDraft','sameDraftRound','personalRoundFingerprint','personalDraftIsPending','notifyInfo','failureMessage','alert','setStage','setViewing','setTab',js+'return Panel;');
 const Panel=create(React,RoundRecovery,draftRound,dbInProgress,count,supabase,[],{id:'owner'},'Owner',async()=>{},draft.clearDraft,refreshDraft,loadRounds,draft.loadDraft,draft.sameDraftRound,draft.personalRoundFingerprint,draft.personalDraftIsPending,m=>notes.push(m),(_,e)=>e.message,m=>alerts.push(m),v=>{stageValue=v;setStage(v)},()=>{},()=>{});
 back=()=>setStage(null);return stage?React.createElement('div',{'data-editor':true},stage.round.holes[0].strokes):React.createElement(Panel);
 }
 await act(async()=>renderer.render(React.createElement(Host)));
 return {el,write,notes,alerts,async release(){await act(async()=>{release();await new Promise(r=>setTimeout(r,0))})},get stage(){return stageValue},async click(text){const b=[...el.querySelectorAll('button')].find(x=>x.textContent.includes(text));assert.ok(b,text);await act(async()=>{b.click();await new Promise(r=>setTimeout(r,0))})},async back(){await act(async()=>back())},async close(){await act(async()=>renderer.unmount());el.remove()}};
}
(async()=>{
 eq(recoveryRounds(round('a'),round('a')).length,1);eq(recoveryRounds(round('a'),round('b')).length,2);eq(recoveryRounds(null,null).length,0);eq(recoveryRounds(round('a'),null).length,1);eq(recoveryRounds(null,round('a')).length,1);
 eq(recoveryRounds({...round(''),draft_session_id:'session'}, {...round(''),draft_session_id:'session'}).length,1);
 let f=await fixture();eq(f.el.querySelectorAll('[data-round-recovery]').length,1);eq(f.el.querySelector('[data-round-recovery]').style.background,'rgb(201, 162, 39)');
 await f.click('Resume');eq(f.stage.round.holes[0].strokes,6);eq(f.write.length,0);eq(f.el.querySelectorAll('[data-round-recovery]').length,0);await f.back();eq(f.el.querySelectorAll('[data-round-recovery]').length,1);
 await f.click('Mark complete');eq(f.write.length,0);eq(f.stage.round.holes[0].strokes,6);eq(f.notes.length,1);await f.close();
 f=await fixture({pending:false});await f.click('Mark complete');eq(f.write[0].patch.gross_score,6);eq(draft.loadDraft(),null);eq(f.el.querySelectorAll('[data-round-recovery]').length,0);await f.close();
 f=await fixture({pending:false,fail:true});await f.click('Mark complete');eq(f.alerts,['injected failure']);eq(draft.loadDraft().round.id,'a');eq(f.el.querySelectorAll('[data-round-recovery]').length,1);await f.close();
 f=await fixture({pending:false,delay:true});await f.click('Mark complete');draft.saveDraft(round('a',9),true);await f.release();eq(draft.loadDraft().round.holes[0].strokes,9);await f.close();
 f=await fixture({delay:true});await f.click('Delete');draft.saveDraft(round('a',9),true);await f.release();eq(draft.loadDraft().round.holes[0].strokes,9);await f.close();
 f=await fixture({pending:false,returned:[]});await f.click('Mark complete');eq(draft.loadDraft().round.id,'a');eq(f.alerts.length,1);await f.close();
 f=await fixture({returned:[]});await f.click('Delete');eq(draft.loadDraft().round.id,'a');eq(f.alerts.length,1);await f.close();
 f=await fixture({count:2,fail:true});await f.click('Discard all');eq(draft.loadDraft().round.id,'a');eq(f.alerts,['injected failure']);await f.close();
 f=await fixture({count:2,confirm:false});await f.click('Discard all');eq(f.write.length,0);eq(draft.loadDraft().round.id,'a');await f.close();
 f=await fixture({confirm:false});await f.click('Delete');eq(f.write.length,0);eq(draft.loadDraft().round.id,'a');await f.close();
 f=await fixture({fail:true});await f.click('Delete');eq(draft.loadDraft().round.id,'a');eq(f.alerts,['injected failure']);await f.close();
 f=await fixture();await f.click('Delete');eq(draft.loadDraft(),null);eq(f.el.querySelectorAll('[data-round-recovery]').length,0);await f.close();
 f=await fixture({local:round('b')});eq(f.el.querySelectorAll('[data-round-recovery]').length,2);await f.click('Delete');eq(draft.loadDraft().round.id,'b');eq(f.el.querySelectorAll('[data-round-recovery]').length,1);await f.close();
 f=await fixture({count:2});await f.click('Discard all');eq(draft.loadDraft(),null);eq(f.el.querySelectorAll('[data-round-recovery]').length,0);await f.close();
 f=await fixture({count:2,returned:['other']});await f.click('Discard all');eq(draft.loadDraft().round.id,'a');await f.close();
 for(const [local,server,want] of [[null,round('a'),1],[round('a'),null,1],[null,null,0]]){f=await fixture({local,server});eq(f.el.querySelectorAll('[data-round-recovery]').length,want);await f.close()}
 console.log(`round recovery: PASS (${checks} assertions; actual component/Home handlers, MODELLED database/editor)`);
})().catch(e=>{console.error(e);process.exit(1)});
