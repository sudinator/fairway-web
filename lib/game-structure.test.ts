import type { Game } from "./game-types";
import {
  buildFormatPatch,
  buildSkinsStylePatch,
  buildMatchTeamPatch,
  addPairing,
  removePairing,
  addFoursome,
  removeFoursome,
  renameFoursome,
  assignFoursomePlayer,
  unassignFoursomePlayer,
  deriveTeeGroupsFromFoursomes,
} from "./game-structure";

type F = NonNullable<Game["foursomes"]>[number];
const same = (a: unknown, b: unknown, msg: string) => {
  const aa = JSON.stringify(a), bb = JSON.stringify(b);
  if (aa !== bb) throw new Error(`${msg}\nold=${aa}\nnew=${bb}`);
};
const baseGame = (o: Partial<Game> = {}): Game => ({
  id: "g", group_id: "grp", code: "ABC123", name: "Test", course: "Course", course_par: 72,
  holes_meta: [], game_type: "stableford", pairings: [], created_by: "u", created_at: "x", ...o,
});

// Frozen pre-extraction implementations copied from 177.47 runtime logic.
function oldFormatPatch(game: Game, next: Game["game_type"]): Record<string, unknown> {
  const suggested = next === "fourball" || next === "trifecta" ? 85 : 100;
  const patch: Record<string, unknown> = { game_type: next, allowance_pct: suggested };
  if (next === "trifecta" && !game.team_score_mode) patch.team_score_mode = "best_ball";
  if (next === "trifecta" && !game.trifecta_scoring) patch.trifecta_scoring = "per_hole";
  if (next === "stroke" && !game.stroke_basis) patch.stroke_basis = "net";
  return patch;
}
function oldSkinsPatch(game: Game, active: number, style: "individual" | "team_11" | "team_2v2") {
  const g = game as any;
  const liveTeams = Array.isArray(g.teams) && g.teams.length === 2 ? g.teams : null;
  const liveFour = Array.isArray(g.foursomes) ? g.foursomes : null;
  const livePair = Array.isArray(g.pairings) ? g.pairings : [];
  const prev = g.structure_stash || {};
  const stash = { teams: liveTeams ?? prev.teams ?? null, foursomes: liveFour ?? prev.foursomes ?? null, pairings: (livePair.length ? livePair : prev.pairings) ?? [] };
  const defTeams = [{ key: "A", name: "Team 1" }, { key: "B", name: "Team 2" }];
  let teams: any = null, foursomes: any = null, pairings: any = [];
  if (style === "team_11") { teams = stash.teams ?? defTeams; foursomes = null; pairings = stash.pairings ?? []; }
  else if (style === "team_2v2") { teams = stash.teams ?? defTeams; foursomes = stash.foursomes ?? []; pairings = stash.pairings ?? []; }
  const patch: Record<string, unknown> = { game_type: "skins", teams, foursomes, pairings, structure_stash: stash };
  let flippedSplit = false;
  if (style === "individual" && g.skins_mode === "split" && active > 4) { patch.skins_mode = "carryover"; flippedSplit = true; }
  return { patch, flippedSplit };
}
function oldMatchPatch(game: Game, on: boolean) {
  const g = game as any;
  const liveTeams = Array.isArray(g.teams) && g.teams.length === 2 ? g.teams : null;
  const prev = g.structure_stash || {};
  const stash = { ...prev, teams: liveTeams ?? prev.teams ?? null };
  const teams = on ? (stash.teams ?? [{ key: "A", name: "Team 1" }, { key: "B", name: "Team 2" }]) : null;
  return { teams, structure_stash: stash };
}
function oldAddPairing(ps: {a:string;b:string}[], a:string, b:string) {
  if (!a || !b || a === b) return ps;
  const dup = ps.some((pr) => (pr.a === a && pr.b === b) || (pr.a === b && pr.b === a));
  return dup ? ps : [...ps, {a,b}];
}
const oldRemovePairing = (ps:{a:string;b:string}[], idx:number) => ps.filter((_,i)=>i!==idx);
const oldAddF = (fs:F[], id:string):F[] => [...fs, {id, name:`Foursome ${fs.length+1}`, a:[], b:[]}];
const oldRemoveF = (fs:F[], id:string) => fs.filter(f=>f.id!==id);
const oldRenameF = (fs:F[], id:string, name:string) => fs.map(f=>f.id===id?{...f,name}:f);
function oldAssign(fs:F[], fId:string, team:"a"|"b", uid:string):F[] {
  const cleared=fs.map(f=>({...f,a:f.a.filter(x=>x!==uid),b:f.b.filter(x=>x!==uid)}));
  return cleared.map(f=>{ if(f.id!==fId)return f; const side=f[team]; if(side.length>=2)return f; return {...f,[team]:[...side,uid]}; });
}
const oldUnassign=(fs:F[],fId:string,team:"a"|"b",uid:string)=>fs.map(f=>f.id===fId?{...f,[team]:f[team].filter(x=>x!==uid)}:f);
function oldGroups(fs:F[]){const out:Record<string,number>={};fs.forEach((f,i)=>{[...f.a,...f.b].forEach(uid=>{out[uid]=i+1;});});return out;}

const formats: Game["game_type"][] = ["stableford","stroke","match","fourball","skins","trifecta"];
for (const next of formats) {
  for (const teamMode of [null, "best_ball"] as const) {
    for (const tri of [null, "per_hole"] as const) {
      for (const stroke of [null, "gross"] as const) {
        const g=baseGame({team_score_mode:teamMode,trifecta_scoring:tri,stroke_basis:stroke});
        same(buildFormatPatch(g,next),oldFormatPatch(g,next),`format ${next}`);
      }
    }
  }
}

const teams=[{key:"A",name:"Alpha"},{key:"B",name:"Beta"}];
const pairings=[{a:"p1",b:"p2"}];
const foursomes:F[]=[{id:"f1",name:"Foursome 1",a:["p1","p3"],b:["p2"]}];
for (const style of ["individual","team_11","team_2v2"] as const) {
  for (const active of [2,4,5,12]) {
    for (const variant of [
      baseGame({game_type:"skins",skins_mode:"carryover"}),
      baseGame({game_type:"skins",skins_mode:"split",teams,pairings,foursomes}),
      baseGame({game_type:"skins",structure_stash:{teams,foursomes,pairings}}),
      baseGame({game_type:"skins",teams:null,foursomes:[],pairings:[],structure_stash:{teams,foursomes,pairings}}),
    ]) same(buildSkinsStylePatch(variant,active,style),oldSkinsPatch(variant,active,style),`skins ${style}/${active}`);
  }
}
for (const on of [false,true]) {
  for (const g of [baseGame({game_type:"match"}),baseGame({game_type:"match",teams}),baseGame({game_type:"match",structure_stash:{teams}})]) {
    same(buildMatchTeamPatch(g,on),oldMatchPatch(g,on),`match ${on}`);
  }
}

let seed=17748;
const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
const ri=(n:number)=>Math.floor(rnd()*n);
const ids=["p1","p2","p3","p4","p5","p6"];
let assertions=0;
for(let i=0;i<5000;i++){
  const ps:{a:string;b:string}[]=[];
  for(let j=0;j<ri(5);j++){const a=ids[ri(ids.length)],b=ids[ri(ids.length)]; if(a!==b)ps.push({a,b});}
  const a=ids[ri(ids.length)], b=ids[ri(ids.length)];
  same(addPairing(ps,a,b),oldAddPairing(ps,a,b),"pair add"); assertions++;
  const idx=ri(ps.length+2)-1; same(removePairing(ps,idx),oldRemovePairing(ps,idx),"pair remove"); assertions++;

  let fs:F[]=[]; const count=ri(4);
  for(let j=0;j<count;j++) fs.push({id:`f${j}`,name:`F${j}`,a:ids.slice(j,j+ri(3)),b:ids.slice(j+2,j+2+ri(3))});
  const fid=fs.length?fs[ri(fs.length)].id:"none", uid=ids[ri(ids.length)], side=rnd()<.5?"a":"b" as "a"|"b";
  same(addFoursome(fs,"new"),oldAddF(fs,"new"),"f add"); assertions++;
  same(removeFoursome(fs,fid),oldRemoveF(fs,fid),"f remove"); assertions++;
  same(renameFoursome(fs,fid,"Renamed"),oldRenameF(fs,fid,"Renamed"),"f rename"); assertions++;
  same(assignFoursomePlayer(fs,fid,side,uid),oldAssign(fs,fid,side,uid),"f assign"); assertions++;
  same(unassignFoursomePlayer(fs,fid,side,uid),oldUnassign(fs,fid,side,uid),"f unassign"); assertions++;
  same(deriveTeeGroupsFromFoursomes(fs),oldGroups(fs),"tee groups"); assertions++;
}
console.log(`game-structure differential: ${assertions} randomized assertions + fixed transition matrix PASS`);
