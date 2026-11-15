// Actual selector JSX + actual handler; MODELLED database, policy and reload.
const fs=require('fs'),path=require('path'),Module=require('module'),assert=require('node:assert/strict');
const repo=path.resolve(__dirname,'..'),req=Module.createRequire(path.join(repo,'package.json')),ts=req('typescript');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,f);
const {gameTeeOptions}=require('../lib/game-tee-options.ts');require('../lib/test-dom.ts');
const React=req('react'),{createRoot}=req('react-dom/client'),{act}=React,golf=require('../lib/golf.ts');
function extract(file,predicate){const src=fs.readFileSync(path.join(repo,file),'utf8'),p=ts.createSourceFile(file,src,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let out;function walk(n){if(predicate(n,p))out=n.getText(p);ts.forEachChild(n,walk)}walk(p);assert.ok(out);return out}
const declaration=extract('components/tournaments.tsx',(n,p)=>ts.isVariableDeclaration(n)&&n.name.getText(p)==='setPlayerTee');
const baselineSource=fs.readFileSync(path.join(__dirname,'fixtures/tee-save-212101.txt'),'utf8');
const oldStart=baselineSource.indexOf('  const setPlayerTee = async'),oldEnd=baselineSource.indexOf('\n  };',oldStart)+5;
const baselineCode=ts.transpileModule(baselineSource.slice(oldStart,oldEnd),{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
const handlerCode=ts.transpileModule('const '+declaration+';',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
const selector=extract('components/game/organizer-panel.tsx',(n,p)=>ts.isJsxElement(n)&&n.openingElement.tagName.getText(p)==='select'&&n.getText(p).includes('teeOptions.map'));
const selectCode=ts.transpileModule('function View(){return ('+selector+')}',{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2020}}).outputText;
const blue={name:'Blue',rating:72,slope:130,par:72},white={name:'White',rating:70,slope:120,par:72};let assertions=0;
function eq(a,b){assert.deepEqual(a,b);assertions++}
async function scenario({library=[white],snapshots=[{tee_name:'Blue',rating:72,slope:130}],denied=false,fail=false,index=12,baseline=false}={}){
 let p={id:'target',tee_name:'White',rating:70,slope:120,handicap_index:index,course_handicap:11,scores:[5,null],putts:[2,null]},players=[p,...snapshots],game={course_par:72},writes=[],alerts=[],notices=[],reloads=0;
 const supabase = {
   from(table) {
     eq(table, 'game_players');
     return {
       update(patch) {
         return {
           async eq(col, id) {
             eq([col,id], ['id','target']);
             writes.push(patch);
             if (!fail) p = {...p,...patch};
             return {error: fail ? {message:'write refused'} : null};
           }
         };
       }
     };
   }
 };

 const handler=()=>Function('game','players','courseTees','allowSetupChange','gameTeeOptions','courseHandicap','supabase','saved','load','alert',(baseline?baselineCode:handlerCode)+'return setPlayerTee;')(game,players,library,()=>!denied,gameTeeOptions,golf.courseHandicap,supabase,(err,_what,ok)=>notices.push(err?err.message:ok),async()=>{reloads++;players=[p,...snapshots]},m=>alerts.push(m));
 const el=document.createElement('div');document.body.append(el);const root=createRoot(el);
 async function render(){const View=Function('React','p','teeOptions','onSetTee','blocked','reasonFor','inputStyle','COMPACT','C',selectCode+'return View;')(React,p,gameTeeOptions(library,players,72),handler(),()=>denied,()=>undefined,{},{},golf.C);await act(async()=>root.render(React.createElement(View)))}await render();
 return {el,async choose(name){const select=el.querySelector('select');select.value=name;await act(async()=>{select.dispatchEvent(new window.Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,0))});await render()},async direct(name){await handler()(p,name);await render()},get p(){return p},writes,alerts,notices,get reloads(){return reloads},async close(){await act(async()=>root.unmount());el.remove()}};
}
(async()=>{
 eq(gameTeeOptions([blue],[{tee_name:'Blue',rating:60,slope:90}],72),[blue]);
 for(const invalid of [null,undefined,NaN,Infinity,0,-1]){eq(gameTeeOptions([{...blue,rating:invalid}],[],72),[]);eq(gameTeeOptions([],[{tee_name:'Blue',rating:72,slope:invalid}],72),[])}
 let oldBroken=await scenario({baseline:true});await oldBroken.choose('Blue');eq(oldBroken.writes.length,0);eq(oldBroken.p.tee_name,'White');await oldBroken.close();
 let s=await scenario();eq([...s.el.querySelectorAll('option')].map(x=>x.value),['','White','Blue']);await s.choose('Blue');eq(s.p.tee_name,'Blue');eq(s.p.course_handicap,golf.courseHandicap(12,130,72,72));eq(s.p.scores,[5,null]);eq(s.p.putts,[2,null]);eq(s.reloads,1);eq(s.el.querySelector('select').value,'Blue');await s.choose('White');eq(s.p.tee_name,'White');await s.choose('Blue');eq(s.p.tee_name,'Blue');eq(s.writes.length,3);await s.close();
 s=await scenario({library:[white,blue],snapshots:[]});await s.choose('Blue');eq(s.p.rating,72);await s.close();
 s=await scenario({denied:true});eq(s.el.querySelector('select').disabled,true);await s.direct('Blue');eq(s.writes.length,0);eq(s.reloads,0);await s.close();
 s=await scenario({fail:true});await s.choose('Blue');eq(s.p.tee_name,'White');eq(s.el.querySelector('select').value,'White');eq(s.notices,['write refused']);eq(s.reloads,1);await s.close();
 s=await scenario();await s.direct('Missing');eq(s.writes.length,0);eq(s.alerts.length,1);await s.choose('Blue');eq(s.p.tee_name,'Blue');await s.close();
 s=await scenario({index:null});await s.choose('Blue');eq(s.p.course_handicap,null);await s.close();
 // Same-name recovery never substitutes an unrelated player's tee.
 eq(gameTeeOptions([],[{tee_name:'Red',rating:68,slope:115}],72).some(t=>t.name==='Blue'),false);
 eq(gameTeeOptions([],[{tee_name:'Blue',rating:null,slope:130}],72),[]);
 for(const index of [null,0,6,12,24,36])for(const tee of [blue,white]){s=await scenario({library:[blue,white],snapshots:[],index});await s.direct(tee.name);eq(s.writes[0],{rating:tee.rating,slope:tee.slope,tee_name:tee.name,course_handicap:index==null?null:golf.courseHandicap(index,tee.slope,tee.rating,72)});const old=await scenario({library:[blue,white],snapshots:[],index,baseline:true});await old.direct(tee.name);eq(s.writes,old.writes);eq(s.p,old.p);eq(s.notices,old.notices);eq(s.reloads,old.reloads);await old.close();await s.close()}
 console.log(`tee options/selector/save: PASS (${assertions} assertions; extracted JSX/handler, MODELLED database/policy/reload)`);
})().catch(e=>{console.error(e);process.exit(1)});
