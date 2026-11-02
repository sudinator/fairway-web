/** 212.89 — executed component scenarios for the owner-approved match result presentation.
 * Scores are modelled. Real components/engines, state transitions and callbacks are executed.
 * No network, live data, score writes or migrations are exercised by these renders. */
import { renderScreen, ok, eq, report } from './screen-harness';
import * as React from 'react';
import { act } from 'react';
import { MatchView, FourballView, SkinsView, TrifectaContestRow } from '@/components/game/scoring-views';
import { ScrambleView } from '@/components/game/scramble-view';
import { scrambleResults } from '@/lib/scramble-game';
import type { Game, Player } from '@/lib/game-types';
import type { AltShotScoreRow } from '@/lib/alt-shot-side-scores';

const GOLD='rgb(201, 162, 39)',CREAM='rgb(247, 243, 232)';
const holes=(n=18)=>Array.from({length:n},(_,i)=>({n:i+1,par:4,si:i+1}));
const P=(id:string,name:string,team:string,scores:(number|null)[])=>({id:'row-'+id,user_id:id,display_name:name,team,handicap_index:0,course_handicap:0,course_handicap_source:'manual',scores,putts:[],fairways:[],tee_group:1,no_show:false} as unknown as Player);
function fixture(type:string,lead=2,thru=6,n=18,size=2){
 const a=Array.from({length:thru},(_,i)=>i<Math.abs(lead)&&lead>0?3:4),b=Array.from({length:thru},(_,i)=>i<Math.abs(lead)&&lead<0?3:4);
 const players=[P('x','Xavier','A',a),P('p','Priya','A',a),P('y','Yusuf','B',b),P('q','Quinn','B',b)];
 const f={id:'f1',name:'Match 1',a:['x','p'],b:['y','q'],a_hcp:0,b_hcp:0};
 for(let i=2;i<size;i++){const idA='a'+i,idB='b'+i;players.push(P(idA,i===2?'Amit':'Francis','A',a),P(idB,i===2?'Rajat':'PJ','B',b));f.a.push(idA);f.b.push(idB);}
 const game={id:'preview',name:'Results',status:'active',game_type:type,created_by:'owner',holes_meta:holes(n),course_par:n*4,allowance_pct:100,pairings:[{a:'x',b:'y'}],foursomes:[f],teams:[{key:'A',name:'Violet',color:'purple'},{key:'B',name:'Burgundy',color:'red'}],team_score_mode:'best_ball',scramble_mode:'match',scramble_handicap:'agreed',scramble_team_size:size} as unknown as Game;
 const rows:AltShotScoreRow[]=[];for(let i=0;i<thru;i++){rows.push({game_id:game.id,foursome_id:f.id,side:'a',hole_index:i,strokes:a[i]} as AltShotScoreRow,{game_id:game.id,foursome_id:f.id,side:'b',hole_index:i,strokes:b[i]} as AltShotScoreRow);}
 return {game,players,rows};
}
let changed=0;const onChanged=()=>{changed++;};
const four=(f:ReturnType<typeof fixture>,user='spectator',embedded=false)=><FourballView game={f.game} players={f.players} user={{id:user}} isCreator={false} mode="play" altShotScores={f.rows} onChanged={onChanged} embedded={embedded}/>;
const leaf=(el:Element,text:string)=>[...el.querySelectorAll<HTMLElement>('span')].find(e=>!e.children.length&&e.textContent===text)!;

// The reused Trifecta row keeps leading-side score semantics for either side, finals and ties.
for(const [lead,thru,settled,result] of [[2,6,false,''],[-2,6,false,''],[0,6,false,''],[3,16,true,'3 & 2'],[-3,16,true,'3 & 2'],[0,18,true,'AS'],[0,0,false,'']] as [number,number,boolean,string][]){
 const t=renderScreen(<TrifectaContestRow c={{kind:'team',lead,thru,settled,result}} aNames="Xavier & Priya" bNames="Yusuf & Quinn" open={false} onToggle={()=>{}}/>);
 const a=leaf(t.el,'Xavier & Priya'),b=leaf(t.el,'Yusuf & Quinn');
 eq(a.style.color,lead>0?GOLD:lead<0&&settled?'rgb(178, 203, 189)':CREAM,'side A emphasis');
 eq(b.style.color,lead<0?GOLD:lead>0&&settled?'rgb(178, 203, 189)':CREAM,'side B emphasis');
 if(thru){const e=leaf(t.el,`thru ${thru}`);ok(e,'one contiguous thru label');eq(e.style.whiteSpace,'nowrap','thru never splits');}
 ok(!t.el.textContent?.includes('YOU'),'neutral row for every viewer');t.unmount();
}
for(const type of ['fourball','alt_shot'])for(const lead of [2,-2,0])for(const n of [9,18]){
 const f=fixture(type,lead,6,n),before=JSON.stringify(f);const t=renderScreen(four(f));
 const card=t.el.querySelector('[data-group-results]')!;
 ok(card.textContent?.includes('VIOLET')&&card.textContent?.includes('BURGUNDY'),`${type} team headers preserved`);
 ok(card.textContent?.includes('Xavier & Priya')&&card.textContent?.includes('Yusuf & Quinn'),`${type} both pairs identified`);
 const a=leaf(card,'Xavier & Priya'),b=leaf(card,'Yusuf & Quinn');
 eq(a.style.color,lead>0?GOLD:CREAM,`${type} A leader highlight`);eq(b.style.color,lead<0?GOLD:CREAM,`${type} B leader highlight`);
 ok(card.textContent?.includes(lead?'2 UP':'AS'),`${type} live score`);
 const row=a.parentElement!.parentElement as HTMLElement;act(()=>row.click());
 ok(card.textContent?.includes('HOLE')&&card.textContent?.includes('NET'),`${type} click opens original hole details`);
 act(()=>row.click());ok(!card.textContent?.includes('HOLE'),`${type} second click closes details`);
 act(()=>row.click());ok(card.textContent?.includes('HOLE'),`${type} details can reopen`);
 eq(JSON.stringify(f),before,`${type} display never mutates props`);t.unmount();
 const re=renderScreen(four(f));ok(!re.el.textContent?.includes('HOLE'),`${type} remount starts collapsed`);re.unmount();
}
for(const type of ['fourball','alt_shot'])for(const lead of [3,-3,0]){
 const f=fixture(type,lead,lead?16:18);const t=renderScreen(four(f));const card=t.el.querySelector('[data-group-results]')!;
 ok(card.textContent?.includes('Final'),`${type} final header`);ok(card.textContent?.includes(lead?'3 & 2':'Halved'),`${type} official closeout shown`);ok(!card.textContent?.includes('3 UP'),`${type} no contradictory running score beside final`);t.unmount();
 const embedded=renderScreen(four(f,'y',true));ok(embedded.el.textContent?.includes('Match status'),`${type} embedded scorecard remains reachable`);ok(embedded.el.textContent?.includes('Xavier & Priya'),`${type} embedded names visible`);embedded.unmount();
}
for(const type of ['fourball','alt_shot']){const f=fixture(type,0,0);const t=renderScreen(four(f));ok(t.el.textContent?.includes('Not started'),`${type} no-scores state`);t.unmount();}
// Singles live remains leader-only; final halves are symmetric and use the actual match length.
for(const n of [9,18])for(const thru of [0,6,n]){
 const f=fixture('match',0,thru,n);f.game.teams=null;f.players=[f.players[0],f.players[2]];
 for(const id of ['x','y','spectator']){
 const t=renderScreen(<MatchView game={f.game} players={f.players} user={{id}} isCreator={false} mode="play" onChanged={onChanged}/>);
 const card=t.el.querySelector('[data-pairing-card]')!;const txt=card.textContent||'';
 eq((txt.match(/Halved/g)||[]).length,thru===n?2:0,'only full-length level match has two Halved labels');
 eq(txt.includes('Final'),thru===n,'Final only after full-length tie');
 eq(txt.includes('AS'),thru>0&&thru<n,'AS only on a live tie');ok(!txt.includes('you'),'no YOU on singles');t.unmount();
 }}
// Invalid/incomplete legacy metadata must not announce a halved final before play.
{const f=fixture('match',0,0,0);f.game.teams=null;const t=renderScreen(<MatchView game={f.game} players={f.players} user={{id:'spectator'}} isCreator={false} mode="play" onChanged={onChanged}/>);const card=t.el.querySelector('[data-pairing-card]')!;ok(!card.textContent?.includes('Halved')&&!card.textContent?.includes('Final'),'empty hole metadata is not a final halve');t.unmount();}
// Trifecta variants stay on the shared row, including swapped and 2 v 1 contests.
for(const swap of [false,true])for(const odd of [false,true]){
 const f=fixture('trifecta');f.game.foursomes![0].swap=swap;if(odd)f.game.foursomes![0].b=['y'];
 const t=renderScreen(four(f));const labels=[...t.el.querySelectorAll('span')].filter(e=>e.textContent==='thru 6');ok(labels.length>=2,'Trifecta retains all contest rows');ok(labels.every(e=>(e as HTMLElement).style.whiteSpace==='nowrap'),'all Trifecta thru labels stay on one line');t.unmount();
}
// Scramble: 2,3,4 per side; either leader, AS, unstarted, early closeout, final halve and field mode.
for(const size of [2,3,4])for(const [lead,thru] of [[2,6],[-2,6],[0,6],[0,0],[3,16],[-3,16],[0,18]]){
 const f=fixture('scramble',lead,thru,18,size),before=JSON.stringify(f);const engine=scrambleResults(f.game,f.players,f.rows);
 const t=renderScreen(<ScrambleView game={f.game} players={f.players} altShotScores={f.rows}/>);
 const card=t.el.querySelector('[data-scramble-match]')!,status=card.querySelector<HTMLElement>('[data-scramble-status]')!,a=card.querySelector<HTMLElement>('[data-scramble-roster="a"]')!,b=card.querySelector<HTMLElement>('[data-scramble-roster="b"]')!;
 eq(status.textContent,engine.matches[0].line,'Scramble official engine sentence unchanged');eq(status.style.fontSize,a.style.fontSize,'result same size as roster');eq(status.style.color,GOLD,'result gold');eq(card.querySelector<HTMLElement>('[data-scramble-match-name]')!.style.color,CREAM,'Match 1 white/cream');
 eq(a.querySelector<HTMLElement>('[data-scramble-members]')!.style.color,lead>0?GOLD:'rgb(178, 203, 189)','Scramble A highlight follows leader');eq(b.querySelector<HTMLElement>('[data-scramble-members]')!.style.color,lead<0?GOLD:'rgb(178, 203, 189)','Scramble B highlight follows leader');
 for(const p of f.players)eq((card.textContent!.match(new RegExp(p.display_name!,'g'))||[]).length,1,`${p.display_name} listed once`);
 eq((card.textContent!.match(/team hcp/g)||[]).length,2,'handicap once per team');eq(JSON.stringify(f),before,'Scramble props immutable');t.unmount();
}
{const f=fixture('scramble');f.game.scramble_mode='field';const t=renderScreen(<ScrambleView game={f.game} players={f.players} altShotScores={f.rows}/>);ok(t.el.querySelector('[data-scramble-board]'),'field leaderboard preserved');ok(!t.el.querySelector('[data-scramble-status]'),'no match status in field mode');t.unmount();}
{const f=fixture('scramble');f.game.foursomes=[];const t=renderScreen(<ScrambleView game={f.game} players={f.players} altShotScores={[]}/>);ok(t.el.textContent?.includes('Make the teams first'),'incomplete setup degrades gracefully');t.unmount();}
// Team Skins keeps skins totals and carries; no match-play UP conversion.
for(const bestBall of [true,false]){
 const f=fixture('skins');if(!bestBall)f.game.foursomes=null;
 const t=renderScreen(<SkinsView game={f.game} players={f.players} user={{id:'spectator'}} isCreator={false} mode="play" onChanged={onChanged}/>);
 ok(t.el.textContent?.includes('Violet')&&t.el.textContent?.includes('Burgundy'),'Team Skins team identities retained');
 if(bestBall){ok(t.el.textContent?.includes('VIOLET')&&t.el.textContent?.includes('BURGUNDY'),'2 v 2 uses actual team names above players');ok(!t.el.textContent?.includes('PAIR 1'),'named team no longer labelled Pair 1');}
 ok(t.el.textContent?.includes('2–0'),'skins counts unchanged');ok(t.el.textContent?.includes('carrying'),'unresolved carry retained');ok(!t.el.textContent?.includes('2 UP'),'skins are never match-play UP');t.unmount();
}
eq(changed,0,'opening/closing results triggers no mutation callback');
report('approved match results presentation');
