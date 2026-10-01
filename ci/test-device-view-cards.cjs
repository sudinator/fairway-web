// Actual scorecard components and DOM events: viewer controls and revocation/re-entry.
const path=require('path'),fs=require('fs'),Module=require('module'),assert=require('node:assert/strict');
const repo=path.resolve(__dirname,'..'),req=Module.createRequire(path.join(repo,'package.json')),ts=req('typescript');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,f);
const {JSDOM}=req('jsdom'),dom=new JSDOM('<html><body></body></html>',{url:'https://card-test.invalid'});
for(const[k,v]of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,Event:dom.window.Event,IS_REACT_ACT_ENVIRONMENT:true,requestAnimationFrame:cb=>setTimeout(cb,0),cancelAnimationFrame:clearTimeout}))Object.defineProperty(globalThis,k,{value:v,writable:true,configurable:true});
const React=req('react'),{act}=React,{createRoot}=req('react-dom/client');
const original=Module._load;Module._load=function(id,parent,isMain){if(id==='@/lib/supabase')return{createClient:()=>({})};if(id==='@/components/contests-view')return{ContestsSection:()=>null,ContestHoleChip:()=>null};if(id.startsWith('@/'))return original.call(this,path.join(repo,id.slice(2)),parent,isMain);return original.call(this,id,parent,isMain)};
const {ScoreEntryCard}=require(path.join(repo,'components/ui.tsx')),{GroupScorecard}=require(path.join(repo,'components/game/scorecard-views.tsx'));
const el=document.createElement('div');document.body.appendChild(el);const root=createRoot(el);let writes=0;
const entry={holes:[{n:1,par:4,si:1,strokes:5,putts:2,fairway:'hit',penalties:0,sand:false,recv:0}],hasHandicap:true,onSet:()=>writes++};
const game={id:'g',name:'Test',game_type:'stroke',status:'active',holes_meta:[{n:1,par:4,si:1}],allowance_pct:100,pairings:[],teams:[],foursomes:[],course_par:4};
const player={id:'p',user_id:'u',display_name:'Player',scores:[5],putts:[2],fairways:['hit'],penalties:[0],sand:[false],course_handicap:0,course_handicap_source:'manual'};
const group={game,players:[player],allPlayers:[player],user:{id:'u'},isMarker:true,markerName:'Player',onTakeOver:()=>{},onRelease:()=>{},onSetHole:()=>writes++};
const modal=()=>el.querySelector('[style*="position: fixed"]');
async function render(C,props,readOnly){await act(async()=>{root.render(React.createElement(C,{...props,readOnly}));await new Promise(r=>setTimeout(r,5))})}
async function click(node){assert.ok(node,'actual scoring cell exists');await act(async()=>node.click())}
(async()=>{
 await render(ScoreEntryCard,entry,true);await click(el.querySelector('#sehole-0'));assert.equal(modal(),null,'viewer cannot open own scores/stats picker');assert.equal(writes,0);
 await render(ScoreEntryCard,entry,false);await click(el.querySelector('#sehole-0'));assert.ok(modal(),'primary opens own picker');await render(ScoreEntryCard,entry,true);assert.equal(modal(),null,'revocation removes open picker');await render(ScoreEntryCard,entry,false);assert.equal(modal(),null,'re-entry never resurrects stale picker');
 const cell=()=>[...el.querySelectorAll('div')].find(x=>x.style.height==='56px'&&x.textContent.includes('5'));
 await render(GroupScorecard,group,true);await click(cell());assert.equal(modal(),null,'viewer cannot edit marker/own group cell');assert.match(el.textContent,/Viewing scores/);assert.equal(cell().style.cursor,'default');
 await render(GroupScorecard,group,false);await click(cell());assert.ok(modal(),'primary marker opens group picker');await render(GroupScorecard,group,true);assert.equal(modal(),null,'revocation removes marker picker');await render(GroupScorecard,group,false);assert.equal(modal(),null,'marker re-entry clears old picker');assert.equal(writes,0);
 await act(async()=>root.unmount());dom.window.close();console.log('PASS: actual own/group scorecards, DOM click-to-picker, viewer denial, primary admission, open-picker revocation and A-B-A re-entry');
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1});
