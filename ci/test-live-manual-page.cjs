// Execute the actual public page's function without changing Next's page export contract.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
const golf=require('../.testout-screens/lib/golf.js'),shape=require('../.testout-screens/lib/game-shape.js'),live=require('../.testout-screens/lib/live-scoring.js');
const source=fs.readFileSync(path.join(root,'app/live/[token]/page.tsx'),'utf8');
const ast=ts.createSourceFile('live.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const decl=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='computePlayer');assert.ok(decl);
const code=ts.transpileModule(decl.getText(ast)+'\ncomputePlayer;', {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const compute=vm.runInNewContext(code,{...golf,live_scoring_1:live,liveCh:live.liveCh});
for(const holes of [9,18]) for(const source of ['manual','derived',null]) for(const allowance of [100,85,50]) {
 const meta=Array.from({length:holes},(_,i)=>({n:i+1,par:4,si:i+1}));
 const p={id:'p',display_name:'Player',course_handicap:12,course_handicap_source:source,ch:12,scores:Array(holes).fill(5),putts:[],fairways:[],penalties:[],sand:[]};
 const result=compute(p,meta,allowance),basis=shape.chBasis(p,holes*4,holes);
 const alloc=golf.allocateStrokes(meta.map(m=>({hole_number:m.n,stroke_index:m.si})),golf.applyAllowance(basis,allowance));
 assert.equal(result.net,holes*5-Object.values(alloc).reduce((a,b)=>a+b,0));
 if(holes===9&&source==='manual'&&allowance===100) assert.equal(result.net,33);
}
console.log('PASS actual public computePlayer: 18 manual/derived/legacy, length and allowance cases');
