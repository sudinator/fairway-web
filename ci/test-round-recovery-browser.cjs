// Real component in Chromium; callback persistence is covered by test-round-recovery.cjs.
const path=require('path'),http=require('http'),assert=require('node:assert/strict'),esbuild=require('esbuild');
const {chromium}=require('playwright'),{launchUpdateChromium}=require('./playwright-browser.cjs');
const root=path.resolve(__dirname,'..');
(async()=>{
 const bundle=await esbuild.build({stdin:{contents:`import React from 'react'; import {createRoot} from 'react-dom/client'; import {RoundRecovery} from './components/round-recovery';
 const local={id:'a',status:'in_progress',course:'Francis Byrne Golf Course',played_at:'2026-11-14',holes:[{strokes:5},{strokes:6}]};
 window.mount=(mode='same')=>createRoot(document.getElementById('root')).render(<RoundRecovery draft={mode==='server'?null:local} server={mode==='local'?null:{...local,id:mode==='different'?'b':'a'}} count={1} onResume={r=>window.lastResume=r} onComplete={r=>window.lastComplete=r} onDelete={r=>window.lastDelete=r} onDiscardAll={()=>{}}/>);window.mount();`,resolveDir:root,loader:'tsx'},bundle:true,write:false,platform:'browser',alias:{'@':root},define:{'process.env.NODE_ENV':'"test"','process.env.NEXT_PUBLIC_SUPABASE_URL':'"https://example.supabase.co"','process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY':'"placeholder"'}});
 const server=http.createServer((req,res)=>{if(req.url==='/app.js'){res.setHeader('Content-Type','application/javascript');res.end(bundle.outputFiles[0].text)}else{res.setHeader('Content-Type','text/html');res.end('<meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;padding:16px;background:#0e3b2e;font-family:system-ui}*{box-sizing:border-box}</style><div id="root"></div><script src="/app.js"></script>')}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await launchUpdateChromium(chromium);
 try{for(const width of [360,390,430]){const page=await browser.newPage({viewport:{width,height:850}});await page.goto(`http://127.0.0.1:${server.address().port}`);await page.locator('[data-round-recovery]').waitFor();assert.equal(await page.locator('[data-round-recovery]').count(),1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.getByRole('button',{name:/Round in progress/}).click();assert.equal(await page.evaluate(()=>window.lastResume.id),'a');
 await page.locator('summary').click();assert.equal(await page.locator('details').getAttribute('open'),'');await page.getByRole('button',{name:'Mark complete',exact:true}).click();assert.equal(await page.evaluate(()=>window.lastComplete.id),'a');await page.getByRole('button',{name:'Delete',exact:true}).click();assert.equal(await page.evaluate(()=>window.lastDelete.id),'a');
 await page.locator('summary').click();assert.equal(await page.locator('details').getAttribute('open'),null);
 if(width===390)await page.screenshot({path:process.env.BNN_RECOVERY_SCREENSHOT||'/tmp/bnn-round-recovery.png'});await page.close();}
 console.log('round recovery browser: PASS (actual yellow component; 360/390/430px, one card, no page overflow, Resume, options open/close, complete/delete callbacks)');
 }finally{await browser.close();await new Promise(r=>server.close(r))}
})().catch(e=>{console.error(e);process.exit(1)});
