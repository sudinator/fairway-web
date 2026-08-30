declare const process: { exit(code:number): never };
import { canonicalAltShotGross, upsertAltShotScoreLocal } from "./alt-shot-side-scores";
let pass=0, fail=0;
const eq=(n:string,a:any,b:any)=>{ if(JSON.stringify(a)!==JSON.stringify(b)){console.error("FAIL",n,a,b);fail++;}else pass++; };
const rows=[{game_id:"g",foursome_id:"f1",side:"a" as const,hole_index:1,strokes:5}];
eq("canonical overrides only scored hole", canonicalAltShotGross(rows,"f1","a",3,[4,4,4]), [4,5,4]);
eq("other side ignores row", canonicalAltShotGross(rows,"f1","b",3,[6,6,6]), [6,6,6]);
let x:any[]=[]; x=upsertAltShotScoreLocal(x,"g","f1","a",0,5); eq("insert",x.map(r=>r.strokes),[5]);
x=upsertAltShotScoreLocal(x,"g","f1","a",0,4); eq("replace",x.map(r=>r.strokes),[4]);
x=upsertAltShotScoreLocal(x,"g","f1","a",0,null); eq("clear leaves canonical tombstone",x.map(r=>r.strokes),[null]);
eq("clear tombstone masks legacy duplicated score", canonicalAltShotGross(x,"f1","a",3,[9,9,9]), [null,9,9]);
for(let i=0;i<5000;i++){
  const h=i%18, s=(i%12)+2; x=upsertAltShotScoreLocal(x,"g","f1",i%2?"a":"b",h,s);
  const g=canonicalAltShotGross(x,"f1",i%2?"a":"b",18,Array(18).fill(null));
  if(g[h]!==s){console.error("FAIL randomized",i);fail++;break;} pass++;
}
console.log(`alt shot side score model: ${pass} passed, ${fail} failed`); if(fail) process.exit(1);
