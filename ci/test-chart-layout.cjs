// Real React/Recharts components; MODELLED read-only fixtures, never a live database.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http'),os=require('node:os'),cp=require('node:child_process');
const esbuild=require('esbuild'),{chromium}=require('playwright'),{launchUpdateChromium}=require('./playwright-browser.cjs');
const root=path.resolve(__dirname,'..');let checks=0;function ok(value,message){checks++;assert.ok(value,message)}
(async()=>{const bundle=await esbuild.build({entryPoints:[path.join(__dirname,'fixtures/chart-browser.tsx')],bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',tsconfig:path.join(root,'tsconfig.json'),define:{'process.env.NEXT_PUBLIC_SUPABASE_URL':'"https://example.supabase.co"','process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY':'"fixture"'},plugins:[{name:'read-only-chart-fixtures',setup(b){
 b.onLoad({filter:/components\/(dashboard|manage|player-card|insights)\.tsx$/},args=>{const names={'dashboard.tsx':'AdaptiveTrend','manage.tsx':'AdminEngagement, AdminAnalytics','player-card.tsx':'FormChart','insights.tsx':'Bars'};return{contents:fs.readFileSync(args.path,'utf8')+'\nexport { '+names[path.basename(args.path)]+' };',loader:'tsx'};});
 b.onResolve({filter:/lib\/supabase$/},()=>({path:'supabase',namespace:'chart-fixture'}));b.onLoad({filter:/.*/,namespace:'chart-fixture'},()=>({contents:`const q=new Proxy(()=>q,{get:(_,p)=>p==='then'?((r)=>Promise.resolve({data:[],error:null}).then(r)):()=>q,apply:()=>q});export function createClient(){return{rpc:()=>Promise.resolve({data:window.auditRpc,error:null}),from:()=>q,auth:{getUser:()=>Promise.resolve({data:{user:null}}),getSession:()=>Promise.resolve({data:{session:null}})},channel:()=>q}}`,loader:'js'}));
 }}]});
 const server=http.createServer((req,res)=>{res.setHeader('Cache-Control','no-store');if(req.url==='/bundle.js'){res.setHeader('Content-Type','application/javascript');res.end(bundle.outputFiles[0].text);}else{res.setHeader('Content-Type','text/html');res.end('<style>body{margin:0;background:#0E3B2E;color:#F7F3E8;font:500 16px Arial}*{box-sizing:border-box}#root{padding:16px}</style><div id="root"></div><script>window.process={env:{}}</script><script src="/bundle.js"></script>');}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let browser;try{browser=await launchUpdateChromium(chromium);const page=await browser.newPage({ hasTouch: true });const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>!!window.renderAudit);checks+=await page.evaluate(()=>window.chartMathChecks());let cases=0;
 async function render(spec){await page.evaluate(s=>window.renderAudit(s),spec);await page.waitForTimeout(80);}
 async function geometry(){return page.evaluate(()=>{const issues=[];let chartCount=0,minGap=Infinity;for(const chart of document.querySelectorAll('.recharts-wrapper')){chartCount++;const cb=chart.getBoundingClientRect();if(cb.right>innerWidth+.5||cb.left<-.5)issues.push('chart overflow');const texts=[...chart.querySelectorAll('text')];for(const text of texts){const r=text.getBoundingClientRect();if(!r.width||getComputedStyle(text).visibility==='hidden')continue;if(r.left<cb.left-.6||r.right>cb.right+.6||r.top<cb.top-.6||r.bottom>cb.bottom+.6)issues.push('clipped '+text.textContent+' '+JSON.stringify({r:r.toJSON(),cb:cb.toJSON()}));if(parseFloat(getComputedStyle(text).fontSize)<11)issues.push('small '+text.textContent);}
 const countLabels=[...chart.querySelectorAll('.recharts-label-list text')].filter(t=>getComputedStyle(t).visibility!=='hidden');for(let i=1;i<countLabels.length;i++){const a=countLabels[i-1].getBoundingClientRect(),b=countLabels[i].getBoundingClientRect();if(a.right>b.left+.5&&a.top<b.bottom&&a.bottom>b.top)issues.push('count-label collision');}
 const xs=[...chart.querySelectorAll('.recharts-xAxis-tick-labels text')],ys=[...chart.querySelectorAll('.recharts-yAxis-tick-labels text')];for(const x of xs)for(const y of ys){const a=x.getBoundingClientRect(),b=y.getBoundingClientRect(),gap=Math.hypot(Math.max(a.left-b.right,b.left-a.right,0),Math.max(a.top-b.bottom,b.top-a.bottom,0));minGap=Math.min(minGap,gap);if(gap<8)issues.push('cross-axis '+x.textContent+'/'+y.textContent+': '+gap);}
 for(const axis of [xs,ys])for(let i=1;i<axis.length;i++){const a=axis[i-1].getBoundingClientRect(),b=axis[i].getBoundingClientRect();if(a.right>b.left+.5&&a.left<b.right-.5&&a.bottom>b.top+.5&&a.top<b.bottom-.5)issues.push('tick collision');}}
 return{issues,chartCount,minGap:Number.isFinite(minGap)?minGap:null};});}
 for(const width of [320,390,430,768]){await page.setViewportSize({width,height:1100});for(const kind of ['dashboard','form','dense','admin','analytics','season','profile','insights','shots'])for(const [n,mode] of [[0,'varied'],[1,'varied'],[5,'flat'],[12,'large'],[29,'varied'],[31,'zero'],[60,'hundred'],[120,'negative'],[52,'large']]){
 await render({kind,n,mode,long:true});if(kind==='dashboard'&&n){await page.getByText('GIR',{exact:true}).first().click();await page.waitForTimeout(80);}const g=await geometry();ok(!g.issues.length,JSON.stringify({width,kind,n,mode,...g}));cases++;}
 // Every detail view is opened from the real Dashboard, including hidden More sections.
 await render({kind:'dashboard',n:29,long:true});while(await page.getByRole('button',{name:'＋ More',exact:true}).count())await page.getByRole('button',{name:'＋ More',exact:true}).first().click({force:true});
 for(const label of ['Rounds','Avg vs par','Best round','Avg differential','Stableford avg','Avg on par 3s','Avg on par 4s','Avg on par 5s','Fairways hit','GIR','Scrambling','Putts / round','Sand saves','3+ putts / round','Penalties']){await page.getByText(label,{exact:true}).first().click({force:true});await page.waitForTimeout(50);const title=page.getByText('· TREND',{exact:false}).last();ok(await title.count(),label+' trend opens');const g=await geometry();ok(!g.issues.length,JSON.stringify({width,label,...g}));await page.getByRole('button',{name:'Close',exact:true}).last().click({force:true});}
 }
 // Approved recent-form UI: real selectors, baseline colours, eligibility and reversible range changes.
 await page.setViewportSize({width:390,height:1100});
 await render({kind:'dashboard',n:32,long:true});
 const form = page.getByText('SCORING FORM · DIFFERENTIAL',{exact:true}).locator('..');
 const firstHeadline = await form.locator('[data-trend-latest]').textContent();
 const firstDots = await form.locator('circle[data-round-value]').evaluateAll(es=>es.map(e=>[e.getAttribute('data-round-value'),e.getAttribute('fill')]));
 ok(firstDots.length===32,'scoring form preserves every eligible round');
 for(const [value,fill] of firstDots)ok(['#4ADE80','#FB7185'].includes(fill),'visible round marker '+value);
 await page.getByRole('button',{name:'Last 5',exact:true}).click();await page.waitForTimeout(120);
 ok(await form.locator('circle[data-round-value]').count()===5,'Last 5 updates chart points');
 ok(!(await form.textContent()).includes('Previous 5:'),'short range has no invented comparison');
 await page.getByRole('button',{name:'All',exact:true}).click();await page.waitForTimeout(120);
 ok(await form.locator('[data-trend-latest]').textContent()===firstHeadline,'All -> Last 5 -> All headline');
 ok(JSON.stringify(await form.locator('circle[data-round-value]').evaluateAll(es=>es.map(e=>[e.getAttribute('data-round-value'),e.getAttribute('fill')])))===JSON.stringify(firstDots),'range round trip restores values and colours');
 ok((await form.textContent()).includes('Previous 5:'),'preceding-five comparison available');
 while(await page.getByRole('button',{name:'＋ More',exact:true}).count())await page.getByRole('button',{name:'＋ More',exact:true}).first().click({force:true});
 for(const label of ['Avg differential','Stableford avg','Fairways hit','GIR','Scrambling','Putts / round','Sand saves','Penalties']){
   await page.getByText(label,{exact:true}).first().click({force:true});await page.waitForTimeout(120);
   const detail=page.getByText('· TREND',{exact:false}).last().locator('../..');
   const points=detail.locator('circle[data-round-value]');
   const n=await points.count();ok(n>0,label+' retains eligible observations');
   ok(await detail.locator('[data-trend-overview]').count()===1,label+' recent summary rendered');
   for(const p of await points.evaluateAll(es=>es.map(e=>({good:e.getAttribute('data-round-better'),fill:e.getAttribute('fill'),r:+e.getAttribute('r')})))){
     ok(p.r===3.6&&p.fill===(p.good==='true'?'#4ADE80':'#FB7185'),label+' marker direction and visibility');
   }
   if(['Fairways hit','GIR','Scrambling','Sand saves'].includes(label))ok((await detail.textContent()).includes('recorded opportunities'),label+' denominator disclosed');
   await page.getByRole('button',{name:'Close',exact:true}).last().click({force:true});
 }
 // Tap a real round: selected marker, course/date/value/baseline context, close and re-entry.
 await form.scrollIntoViewIfNeeded();const dot=await form.locator('circle[data-round-value]').nth(12).boundingBox();
 await page.touchscreen.tap(dot.x+dot.width/2,dot.y+dot.height/2);await page.waitForTimeout(140);
 ok(await form.locator('.recharts-active-dot').count()>0,'selected round highlighted');
 const tip=page.locator('.recharts-tooltip-wrapper').filter({has:page.getByText('vs overall average',{exact:true})});
 ok((await tip.textContent()).includes('The Extremely Long Championship'),'tooltip retains course');
 ok((await tip.textContent()).includes('Recent form'),'tooltip reports recent form');
 await tip.getByRole('button',{name:'Close',exact:true}).tap();await page.waitForTimeout(120);
 ok(await form.locator('circle[data-round-value]').count()===32,'tooltip close preserves data');
 // Real responsive transitions A -> B -> A, with opposite-axis clearance rechecked each time.
 for(const kind of ['profile','form','dense','admin','season']){await render({kind,n:29,mode:'negative'});for(const width of [390,320,768,390]){await page.setViewportSize({width,height:1100});await page.waitForTimeout(100);const g=await geometry();ok(!g.issues.length,JSON.stringify({kind,width,...g}));}}
 // Tooltip dismissal and reopening retain the plotted data and the current range.
 for(const kind of ['dashboard','profile','admin']){await page.setViewportSize({width:390,height:1100});await render({kind,n:12,mode:'varied',long:true});if(kind==='dashboard'){await page.getByText('GIR',{exact:true}).first().click();await page.waitForTimeout(150);}const chart=page.locator('.recharts-wrapper').last();await chart.scrollIntoViewIfNeeded();const bb=await chart.boundingBox();await page.mouse.move(bb.x+bb.width/2,bb.y+bb.height/2);await page.waitForTimeout(180);const close=page.locator('.recharts-tooltip-wrapper').getByRole('button',{name:'Close',exact:true});ok(await close.count(),kind+' tooltip opens');await close.last().click({force:true});await page.waitForTimeout(100);ok(await page.locator('.recharts-tooltip-wrapper').evaluateAll(es=>es.every(e=>getComputedStyle(e).visibility!=='visible')),kind+' tooltip closes');const again=await page.locator('.recharts-wrapper').last().boundingBox();await page.mouse.move(0,0);await page.mouse.move(again.x+again.width/2,again.y+again.height/2);await page.waitForTimeout(150);ok(await page.locator('.recharts-tooltip-wrapper').getByRole('button',{name:'Close',exact:true}).count(),kind+' tooltip reopens');}
 for(const kind of ['dashboard','profile','admin']){await page.mouse.move(0,0);await render({kind,n:12,long:true});if(kind==='dashboard'){await page.getByText('GIR',{exact:true}).first().click();await page.waitForTimeout(100);}const c=page.locator('.recharts-wrapper').last();await c.scrollIntoViewIfNeeded();const r=await c.boundingBox();await page.touchscreen.tap(r.x+r.width*.6,r.y+r.height*.4);await page.waitForTimeout(120);const close=page.locator('.recharts-tooltip-wrapper').getByRole('button',{name:'Close',exact:true});ok(await close.count(),kind+' touch tooltip opens');await close.last().tap();await page.waitForTimeout(120);ok(await page.locator('.recharts-tooltip-wrapper').evaluateAll(es=>es.every(e=>getComputedStyle(e).visibility!=='visible')),kind+' touch close remains closed');const r2=await page.locator('.recharts-wrapper').last().boundingBox();await page.touchscreen.tap(r2.x+r2.width*.4,r2.y+r2.height*.4);await page.waitForTimeout(120);ok(await page.locator('.recharts-tooltip-wrapper').getByRole('button',{name:'Close',exact:true}).count(),kind+' touch next point reopens');}
 ok(!errors.length,'browser errors: '+errors.join('; '));
 // A mutation fixture proves SVG attribute syntax is covered by the shipped minimum-font guard.
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'bnn-chart-font-'));try{fs.mkdirSync(path.join(temp,'components'));for(const syntax of ['fontSize="9"','fontSize={9}','fontSize: 9']){fs.writeFileSync(path.join(temp,'components/probe.tsx'),syntax);const run=cp.spawnSync('python3',[path.join(root,'ci/check-min-fontsize.py')],{cwd:temp,encoding:'utf8'});ok(run.status===1,'font guard rejects '+syntax);}}finally{fs.rmSync(temp,{recursive:true,force:true});}
 console.log(`chart layout: ${checks} assertions; ${cases} data/viewport cases, all 15 dashboard trends, responsive round trips, mouse/touch close/reopen, font-guard mutations and historical calculation/render differential checks PASS`);
 }finally{await browser?.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exit(1)});
