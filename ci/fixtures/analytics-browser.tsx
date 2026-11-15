// Actual components with read-only synthetic data for browser scenario/visual checks.
import React, {useState} from 'react';
import {RoundDetail} from '@/components/round-detail';
import {HeadToHead} from '@/components/head-to-head';
import {createRoot} from 'react-dom/client';
import {Dashboard} from '@/components/dashboard';
import {AdminAnalytics,AdminEngagement,AdminPowerUsers,AdminDailyReport,AdminExtraStats,OpsMetrics} from '@/components/manage';
import {PersonalBestsCard} from '@/components/personal-bests-card';
function RoundPreview(){const [round,setRound]=useState({...rounds[1],penalties_tracked:false});return <RoundDetail round={round as any} onBack={()=>{}} onEdit={()=>{}} onDelete={()=>{}} onRoundUpdated={r=>setRound(r as any)}/>;}
const root=createRoot(document.getElementById('root')!);
const rounds=Array.from({length:32},(_,i)=>({id:'r'+i,course:i%2?'Pine Valley':'Oak Hollow',tee_name:i%4<2?'Blue':'White',played_at:new Date(Date.UTC(2026,9,1+i)).toISOString(),status:'final',penalties_tracked:i%3!==0,rating:72,slope:113,course_par:i%5?72:36,handicap_index:12,course_handicap:12,holes:Array.from({length:i%5?18:9},(_,j)=>({hole_number:j+1,par:4,stroke_index:j+1,strokes:i%2?6:4,putts:i%3?2:null,fairway:i%3?'hit':null,penalties:0}))}));
const metric={totals:{users:64,active_groups:5,games:120,rounds:214},active:{dau:8,wau:21,mau:38,series:[]},formats:{stroke:21,scramble:18,alt_shot:9},features:{avatars_set:40,ai_summaries:6,live_shared:7},health:{completion_pct:73,round_completion_pct:89,abandoned_pct:12,avg_holes:17,activation_cohort:{n:18,d:40,pct:45},second_round_cohort:{n:12,d:30,pct:40},retention_w1:{n:22,d:40,pct:55},retention_w4:{n:15,d:30,pct:50}},funnels:{repeat_clubs:{n:3,d:5,pct:60},formats:[{game_type:'scramble',players:24,repeat_players:10}],reminders:{sent:12,resumed:5,completed:4},feature_use:[{action:'analytics_insights_open',uses:42,users:17,repeat_users:8,returned:{n:6,d:12,pct:50}}]},quality:{feature_note:'Observed actions start with this release. Return cohorts need 28 days.',lifecycle_note:'Deleted drafts remain in historical game counts; earlier deleted games cannot be reconstructed.'}};
(window as any).analyticsData=(fn:string,args:any)=>fn==='set_round_penalties_tracked'?args.p_tracked:['get_power_users','admin_stat_users','admin_stale_games'].includes(fn)?[]:fn==='get_ops_metrics'?{stale_job:{scheduled:true,last_run:{finished_at:'2026-11-14T09:00Z',completed_games:3,deleted_games:1,reviewed_games:2,completed_rounds:4,failures:0}}}:metric;
const partnerGames=Array.from({length:15},(_,i)=>({id:'partner-game-'+i,status:'ended',game_type:'fourball',played_at:'2026-10-01',course_par:72,holes_meta:Array.from({length:18},(_,j)=>({n:j+1,par:4,si:j+1})),allowance_pct:100,team_score_mode:'best_ball',foursomes:[{id:'f'+i,a:['me',i<12?'frequent':'unbeaten'],b:['opponent-1','opponent-2']}]}));
const partnerPlayers=partnerGames.flatMap((g,i)=>['me',i<12?'frequent':'unbeaten','opponent-1','opponent-2'].map((id,j)=>({id:g.id+'-'+id,game_id:g.id,user_id:id,display_name:({me:'Sample member',frequent:'Frequent Partner',unbeaten:'Unbeaten Partner'} as any)[id]||'Opponent '+j,scores:Array(18).fill(j<2?(i<6||i>=12?4:6):5),course_handicap:0,course_handicap_source:'manual',handicap_index:0,rating:72,slope:113,no_show:false})));
(window as any).analyticsRows=(table:string)=>table==='games'?partnerGames:table==='game_players'?partnerPlayers:[];
(window as any).renderAnalytics=(kind='dashboard')=>{let element:any;
 if(kind==='round')element=<RoundPreview/>;
 if(kind==='partners')element=<HeadToHead user={{id:'me'}}/>;
 if(kind==='dashboard')element=<Dashboard rounds={rounds as any} name="Sample member" currentIndex={12} saveIndex={()=>{}} onOpen={()=>{}} savedCoach={{text:'A saved summary from an earlier selection.',date:'2026-11-01T12:00Z',rounds:20}}/>;
 if(kind==='admin')element=<AdminAnalytics/>;
 if(kind==='engagement')element=<AdminEngagement/>;
 if(kind==='power')element=<AdminPowerUsers/>;
 if(kind==='daily')element=<AdminDailyReport/>;
 if(kind==='devices')element=<AdminExtraStats/>;
 if(kind==='ops')element=<OpsMetrics/>;
 if(kind==='bests')element=<PersonalBestsCard rounds={[rounds[1],{...rounds[1],id:'tied',played_at:'2026-11-14'}] as any} now={new Date('2026-11-15T12:00Z')} onOpen={()=>{}}/>;
 root.render(<main key={kind} data-analytics-fixture={kind} style={{padding:16}}>{element}</main>);
};
