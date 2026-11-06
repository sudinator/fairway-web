/** EXECUTED UI/loader scenarios with MODELLED database responses. No live database. */
import { renderScreen, ok, eq, report } from './screen-harness';
import React, { act } from 'react';
import { buildClubReport } from './club-report';
import { buildClubEngagement, clubEngagementPeriod } from "./club-engagement";
import { ClubHub } from '@/components/club-hub';
import { clubDirectorySummary, filterClubDirectory, loadClubDirectory, type ClubDirectoryRow } from '@/lib/club-directory';
const now=Date.now(),iso=(days:number)=>new Date(now-days*86400000).toISOString();
const profiles:any[]=[{id:'a',display_name:'Alice Admin',handicap_index:0,last_active:iso(1)},{id:'b',display_name:'Bo Member',handicap_index:null,last_active:iso(31)},{id:'s',display_name:'Support Person',last_active:iso(1)},{id:'c',display_name:'Club B Member',handicap_index:12,phone:'+1 202-555-0147',last_active:iso(2)}];
let memberships:any[]=[{id:'m1',group_id:'g1',user_id:'a',email:'alice@test',role:'admin',status:'active',is_support:false},{id:'m2',group_id:'g1',user_id:'b',email:'bo@test',role:'member',status:'active',is_support:false},{id:'m3',group_id:'g1',user_id:null,email:'invite@test',role:'member',status:'invited',is_support:false},{id:'m4',group_id:'g1',user_id:'s',email:'support@test',role:'admin',status:'active',is_support:true},{id:'m5',group_id:'g2',user_id:'c',email:'club-b@test',role:'member',status:'active',is_support:false}];
const rows=()=>memberships.filter(m=>m.group_id==='g1').map(m=>({...m,profiles:profiles.find(p=>p.id===m.user_id)||null}));
const s=clubDirectorySummary(rows(),now);eq(s.members,2,'members exclude invitations and support');eq(s.opened30,1,'30-day app open is not membership status');eq(s.invited,1,'invited players separate');eq(s.admins,1,'support is not a real club admin count');
const edges:ClubDirectoryRow[]=[...rows(),{...rows()[0],id:'duplicate'},...['invalid','missing','future','boundary','removed'].map((id,i)=>({id,user_id:id,email:id,role:'member',status:id==='removed'?'removed':'active',profiles:{last_active:["invalid",null,new Date(now+1).toISOString(),iso(30),iso(1)][i]}}))];
const es=clubDirectorySummary(edges,now);eq(es.members,6,'deduplicate users and exclude removed');eq(es.opened30,2,'inclusive exact 30-day cutoff, future excluded');eq(es.unknownActivity,2,'missing/invalid activity is unknown');eq(clubDirectorySummary([],now).members,0,'empty club is zero');
eq(filterClubDirectory(rows(),'BO','all').length,1,'case-insensitive name/email search');eq(filterClubDirectory(rows(),'','admin').length,1,'admin filter excludes support');eq(filterClubDirectory(rows(),'','invited').length,1,'invitation filter');eq(filterClubDirectory(rows(),'','handicap').length,1,'handicap zero is present');
let holdClubA=false, releaseClubA:(()=>void)|null=null;
let failRead=false,failWrite=false,reportState:'none'|'error'|'yes'='none',writes=0;
(globalThis as any).confirm=()=>true;
(globalThis as any).fetch=async(input:any,init:any)=>{
 const url=new URL(String(input?.url??input), "https://screen.test");const method=String(init?.method||input?.method||'GET').toUpperCase();const table=url.pathname.split('/').pop()!;
 if(table==='group_members'&&method==='GET'&&holdClubA&&url.searchParams.get('group_id')==='eq.g1')await new Promise<void>(resolve=>{releaseClubA=resolve;});
 if(table==='group_members'&&method==='PATCH'){writes++;if(failWrite)return new Response(JSON.stringify({message:'Write rejected'}),{status:400});const id=(url.searchParams.get('id')||'').replace('eq.','');const patch=JSON.parse(init.body);memberships=memberships.map(m=>m.id===id?{...m,...patch}:m);}
 if(table==='group_members'&&failRead)return new Response(JSON.stringify({message:'Read unavailable'}),{status:400});
 if(table==='club_reports'&&reportState==='error')return new Response(JSON.stringify({message:'Report unavailable'}),{status:400});
 const gid=(url.searchParams.get('group_id')||'').replace('eq.','');
 const body=table==='club-engagement'?buildClubEngagement(gid,clubEngagementPeriod(Date.now()),['a','b'],[]):table==='group_members'?memberships.filter(m=>m.group_id===gid&&m.status!=='removed'):table==='profiles'?profiles:table==='club_reports'&&reportState==='yes'?[{snapshot:buildClubReport('Main',{key:'2026-Q3',label:'July–September 2026',from:'2026-07-01',to:'2026-09-30'},[])}]:[];
 return new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});
};
const settle=()=>act(async()=>{await new Promise(r=>setTimeout(r,35));});
const groups:any=[{id:'g1',name:'Main',role:'admin',status:'active'},{id:'g2',name:'Other club',role:'member',status:'active'}];
function View(){const [gid,setGid]=React.useState('g1');return <><button onClick={()=>setGid(gid==='g1'?'g2':'g1')}>Switch test club</button><ClubHub user={{id:'a',email:'alice@test'}} groups={groups} activeGroupId={gid} onGroupsChanged={()=>{}} onActiveGroupChange={setGid}/></>;}
function tab(t:ReturnType<typeof renderScreen>,name:string){const b=[...t.el.querySelectorAll<HTMLElement>('[role="tab"]')].find(e=>e.textContent===name)!;act(()=>b.click());}
(async()=>{
 const t=renderScreen(<View/>);await settle();
 ok(![...t.el.querySelectorAll('button')].some(b=>b.textContent==='Invite members'),'redundant header invite shortcut removed');
 const summary=()=>t.el.querySelector('[data-club-summary]')!.textContent!;
 ok(summary().includes('2Total club members')&&summary().includes('1Opened BNN'),'top counts from current memberships/app opens');ok(!t.el.textContent?.includes('Support Person'),'support not in directory');
 const search=t.el.querySelector<HTMLInputElement>('[aria-label="Search club members"]')!;
 function searchFor(value:string){act(()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')!.set!.call(search,value);search.dispatchEvent(new Event('input',{bubbles:true}));});}
 searchFor('Bo');ok(!t.el.textContent?.includes('Alice Admin')&&t.el.textContent?.includes('Bo Member'),'search changes rendered cards');searchFor('');ok(t.el.textContent?.includes('Alice Admin'),'clearing search restores directory');
 t.click('Missing handicap');ok(t.el.textContent?.includes('Bo Member')&&!t.el.textContent?.includes('Alice Admin'),'missing handicap filter rendered');t.click('All');
 ok(![...t.el.querySelectorAll('[role="tab"]')].some(e=>e.textContent==='Activity'),'Activity tab removed');
 ok(t.el.textContent?.includes('No published club report'),'no invented report directly in Members');
 t.click('See courses & participation');await settle();ok(t.el.textContent?.includes('Hide course details'),'inline details expand');
 ok(t.el.querySelector('[role="tab"][aria-selected="true"]')?.textContent==='Members','expansion keeps directory selected');
 t.click('Hide course details');await settle();ok(t.el.textContent?.includes('See courses & participation'),'inline details collapse');
 searchFor('Bo');tab(t,'Club settings');tab(t,'Members');ok(search.value==='Bo'&&t.el.textContent?.includes('Bo Member'),'member search survives Settings round trip');searchFor('');
 reportState='error';t.click('Switch test club');await settle();t.click('Switch test club');await settle();ok(t.el.textContent?.includes("Couldn't load the club report"),'report errors differ from no report');
 reportState='yes';t.click('Retry');await settle();ok(t.el.textContent?.includes('CLUB REPORT · JULY–SEPTEMBER 2026'),'report retry loads actual fixture period, not a monthly label');
 t.click('See the report');await settle();ok(!!t.el.querySelector('[data-club-latest-report]')&& !t.el.textContent?.includes('See the report →'),'actual published report expands');
 tab(t,'Club settings');await settle();ok(t.el.querySelectorAll('[data-club-latest-report]').length===1&&t.el.querySelector('[data-club-latest-report]')?.parentElement?.hidden,'single report stays in hidden Members pane, not Settings');ok(t.el.textContent?.includes('Generate invite link'),'invitation controls retained');
 tab(t,'Members');ok(t.el.textContent?.includes('Alice Admin'),'directory remains across subtab round trip');
 failWrite=true;const before=writes;t.click('Make club admin');await settle();eq(writes,before+1,'one attempted role write');ok(t.el.textContent?.includes("Couldn't change this role"),'failed write visible');ok(t.el.textContent?.includes('Bo Member'),'failed write retains roster');
 failWrite=false;t.click('Make club admin');await settle();ok(t.el.textContent?.includes('Remove club admin'),'role retry refreshes visible role');
 t.click('See courses & participation');await settle();t.click('Switch test club');await settle();ok(t.el.textContent?.includes('See courses & participation')&&!t.el.textContent?.includes('Hide course details'),'new club resets inline details');ok(!t.el.textContent?.includes('Alice Admin')&&!t.el.textContent?.includes('Bo Member'),'old club data cleared');ok(t.el.textContent?.includes('Club B Member'),'new club loaded');ok(!t.el.textContent?.includes('Invite members')&&!t.el.textContent?.includes('Make club admin'),'member role has no management actions');
 ok(!!t.el.querySelector('a[href="tel:+1 202-555-0147"]'),'ordinary club member sees saved phone');
 t.click('Club B Member');await settle();ok(!!t.el.querySelector('[aria-label="Close"]'),'name opens peer profile');ok(t.el.textContent?.includes('Say hi'),'peer profile retains Say hi');ok(!!t.el.querySelector('a[href="sms:+1 202-555-0147"]'),'peer profile retains Text');t.click('Say hi');await settle();ok(!!t.el.querySelector('textarea'),'Say hi opens composer without sending');act(()=>t.el.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click());await settle();ok(!t.el.querySelector('textarea'),'closing profile returns to directory');
 t.click('Switch test club');await settle();ok(t.el.textContent?.includes('Alice Admin'),'A-B-A round trip reloads correct club');t.unmount();
 failRead=true;const bad=renderScreen(<View/>);await settle();ok(bad.el.querySelector('[role="alert"]'),'read failure visible');ok(bad.el.querySelector('[data-club-summary]')!.textContent!.includes('—'),'read failure is not zero members');tab(bad,'Club settings');await settle();ok(!bad.el.textContent?.includes('Delete club'),'unknown membership count never offers delete');failRead=false;tab(bad,'Members');const retry=bad.el.querySelector('[role="alert"] button') as HTMLButtonElement;act(()=>retry.click());await settle();ok(bad.el.textContent?.includes('Alice Admin'),'read retry recovers');bad.unmount();
 const empty=renderScreen(<ClubHub user={{id:'a'}} groups={[]} activeGroupId={null} onGroupsChanged={()=>{}} onActiveGroupChange={()=>{}}/>);await settle();ok(empty.el.textContent?.includes('Submit request'),'no-club member can still request a club');empty.unmount();
 const shortcut=renderScreen(<ClubHub user={{id:'a'}} groups={groups} activeGroupId="g1" initialPane="settings" onGroupsChanged={()=>{}} onActiveGroupChange={()=>{}}/>);await settle();ok(shortcut.el.querySelector('[role="tab"][aria-selected="true"]')?.textContent==='Club settings','Admin settings shortcut selects correct pane');ok(shortcut.el.textContent?.includes('Generate invite link'),'settings shortcut retains invite action');shortcut.unmount();
 holdClubA=true;const race=renderScreen(<View/>);await settle();ok(!!releaseClubA,'old club request deliberately held');race.click('Switch test club');await settle();ok(race.el.textContent?.includes('Club B Member'),'new club loads while old response pending');holdClubA=false;await act(async()=>{releaseClubA?.();await new Promise(r=>setTimeout(r,35));});ok(!race.el.textContent?.includes('Alice Admin')&&race.el.textContent?.includes('Club B Member'),'late old-club response cannot overwrite new club');race.unmount();
 // Loader pagination is exercised with 1,001 memberships, not only tiny fixtures.
 const many=Array.from({length:1001},(_,i)=>({id:String(i).padStart(5,'0'),user_id:'p'+i,email:'p'+i+'@test',role:'member',status:'active'}));let membershipPages=0;
 const db={from:(table:string)=>{let lo=0,hi=999,ids:string[]=[];let proxy:any;proxy=new Proxy({}, {get(_,key){if(key==='then')return(resolve:any,reject:any)=>Promise.resolve({data:table==='group_members'?many.slice(lo,hi+1):ids.map(id=>({id,display_name:id,handicap_index:0})),error:null}).then(resolve,reject);return(...args:any[])=>{if(key==='range'){[lo,hi]=args;if(table==='group_members')membershipPages++;}if(key==='in')ids=args[1];return proxy;};}});return proxy;}};
 const loaded=await loadClubDirectory(db,'g');eq(loaded.length,1001,'all 1,001 memberships read');eq(membershipPages,2,'membership query is paged');ok(loaded.every(r=>r.profiles?.handicap_index===0),'profiles chunked and joined without losing zero');
 report('combined club directory');
})().catch(e=>{console.error(e);process.exit(1)});
