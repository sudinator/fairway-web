import React from 'react';
import {createRoot} from 'react-dom/client';
import * as DashboardModule from '@/components/dashboard';
import {ChartTip} from '@/components/charts/chart-tip';
const Dashboard=DashboardModule.Dashboard,AdaptiveTrend=(DashboardModule as any).AdaptiveTrend;
import {FormBars,withRolling} from '@/components/charts/form-bars';
import * as ManageModule from '@/components/manage';
const AdminEngagement=(ManageModule as any).AdminEngagement,AdminAnalytics=(ManageModule as any).AdminAnalytics;
import {SeasonCardView} from '@/components/season-story';
import * as PlayerCardModule from '@/components/player-card';
const FormChart=(PlayerCardModule as any).FormChart;
import * as InsightsModule from '@/components/insights';
const Bars=(InsightsModule as any).Bars;
import {ShotSynthesis} from '@/components/compare-stats';
const root=createRoot(document.getElementById('root')!);
(window as any).renderAudit=({kind,n=29,mode='varied',long=false}:any)=>{
const renderId = ((window as any).auditRenderId = ((window as any).auditRenderId || 0) + 1);
const val=(i:number)=>mode==='flat'?25:mode==='zero'?0:mode==='hundred'?100:mode==='negative'?-12+(i%8):mode==='large'?1000+i*13:(i*17)%61;
const date=(i:number)=>new Date(Date.UTC(2026,0,1+i*9)).toISOString().slice(0,10);
const course=long?'The Extremely Long Championship Golf Course and Country Club at Berkshire Valley':'Berkshire Valley';
const data=Array.from({length:n},(_,i)=>({i:i+1,playedAt:date(i),name:date(i),course,value:val(i),val:val(i),roll: i<4?null:val(i),roll5:i<4?null:val(i)}));
const rounds=Array.from({length:n},(_,i)=>({id:'r'+i,course,played_at:date(i),status:'final',rating:72,slope:113,course_par:72,handicap_index:12,course_handicap:12,holes:Array.from({length:18},(_,j)=>({hole_number:j+1,par:j%3===0?3:j%3===1?4:5,stroke_index:j+1,strokes:j%3===0?3:5+(i%3),putts:2+(i%2),fairway:(j+i)%2===0?'hit':'left',penalties:0,sand:true}))}));
(window as any).auditRpc= {weekend_series:data.map((d)=>({week:d.name,golfers:d.val,rounds:d.val})),weekly_new_returning:data.map(d=>({week:d.name,new:d.val,returning:d.val})),active:{series:data.map(d=>({day:d.name,n:d.val}))},formats:{fourball:100,match:20,skins:1},features:{avatars_set:50},totals:{},health:{}};
let el:any;
if(kind==='dashboard')el=<Dashboard key={JSON.stringify({n,mode,long})} rounds={rounds as any} name="Audit" currentIndex={12} saveIndex={()=>{}} onOpen={()=>{}}/>;
if(kind==='form')el=<div style={{height:212}}><FormBars data={data} avg={25}/></div>;
if(kind==='dense')el=<div style={{height:222}}><AdaptiveTrend data={data} valueKey="val" rollKey="roll5" avg={25} lowerBetter={false} pctStat={mode!=='negative'&&mode!=='large'} nameMap={{val:'GIR',roll5:'5-rd avg'}} fmt={String}/></div>;
if(kind==='admin')el=<AdminEngagement key={JSON.stringify({n,mode})}/>;
if(kind==='analytics')el=<AdminAnalytics key={JSON.stringify({n,mode})}/>;
if(kind==='season')el=<div style={{padding:16}}><SeasonCardView card={{kind:'index',start:12,end:11,low:10,series:data.map(d=>({date:d.name,index:d.val})),diffs:data.map(d=>({date:d.name,course,value:d.val}))} as any} name="Audit" year={2026}/></div>;
if(kind==='profile')el=<div style={{padding:16,overflow:'hidden'}}><FormChart data={data.map(d=>d.val)}/></div>;
if(kind==='insights')el=<Bars title="BY DIFFICULTY" buckets={data.slice(0,4).map((d,i)=>({key:String(i),label:i===0?'hardest holes (stroke index 1–6)':'Par 4s',avgToPar:d.val,netAvg:1.2,holes:519}))}/>;
if(kind==='tip')el=<ChartTip active payload={[{dataKey:'value',value:25,payload:{course,name:'Jan 1, 2026'}}]} nameMap={{value:'Differential'}} fmt={String}/>;
if(kind==='shots')el=<ShotSynthesis fir={{hit:20,total:100}} gir={{hit:20,total:100}} puttsPerRound={36} scramble={{hit:10,total:100}} index={12} goalHcp={10} setGoalHcp={()=>{}} detailRounds={n}/>;
root.render(<div data-audit={kind} data-audit-render={renderId} style={{background:'#1B5A46',padding:16,borderRadius:14}}>{el}</div>);
};

import {chartXAxis,formatChartDate,showCountLabels} from "@/lib/chart-axis";
import {niceDomain as currentDomain} from "@/components/charts/form-bars";
import {niceDomain as oldDomain,withRolling as oldRolling} from "./chart-math-21294";
import {ChartTip as OldTip} from "./chart-tip-21294";
import {renderToStaticMarkup} from "react-dom/server";
(window as any).chartMathChecks=()=>{
 let assertions=0;const eq=(a:any,b:any)=>{assertions++;if(JSON.stringify(a)!==JSON.stringify(b))throw new Error(JSON.stringify({a,b}));};
 for(let n=0;n<80;n++){const points=Array.from({length:n},(_,i)=>({value:Math.sin(i*7)*25,course:'Course',name:'Date'}));for(const pad of [1,2,3])eq(currentDomain(points.map(p=>p.value),pad),oldDomain(points.map(p=>p.value),pad));for(const w of [1,3,5,10]){const current=withRolling(points,w).map(({i,name,course,value,roll})=>({i,name,course,value,roll}));eq(current,oldRolling(points,w));}}
 for(const active of [true,false])for(const value of [null,0,12.4]){const props={active,payload:[{value,dataKey:'value',payload:{course:'Course',name:'Date'}}],nameMap:{value:'Differential'}};eq(renderToStaticMarkup(<ChartTip {...props}/>),renderToStaticMarkup(<OldTip {...props}/>));}
 for(const raw of [null,undefined,'','2026-02-30','not a date'])eq(formatChartDate(raw),'Date unavailable');
 eq(formatChartDate('2026-01-01T01:00:00+09:00'),'Jan 1, 2026');eq(chartXAxis([]).ticks,[]);
 const make=(n:number)=>Array.from({length:n},(_,i)=>({i:i+1,playedAt:new Date(Date.UTC(2026,0,i*12+1)).toISOString()}));
 eq(chartXAxis(make(5)).tickFormatter(1),'1');eq(chartXAxis(make(20)).tickFormatter(1),'Jan ’26');eq(chartXAxis(make(20).map(x=>({...x,playedAt:'bad'}))).tickFormatter(1),'1');
 const same=make(20).map(x=>({...x,playedAt:'2026-01-01'}));eq(chartXAxis(same).ticks.length,20);
 const w=chartXAxis([{week:'2026-02-01'}],'week','week');eq(w.tickFormatter('2026-02-01'),'Feb 1');
 eq(showCountLabels([1000,1001,1002,1003,1004,1005,1006,1007,1008,1009,1010,1011],220),false);
 eq(showCountLabels([1000,1001,1002,1003,1004,1005,1006,1007,1008,1009,1010,1011],768),true);
 eq(showCountLabels([],300),false);eq(showCountLabels([NaN],300),false);eq(showCountLabels([1,2,3,4,5],300),true);
 return assertions;
};
