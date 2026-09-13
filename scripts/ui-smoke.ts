/** Read-only checks for the Operations redesign against a running local server. */
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
const base=process.env.UI_TEST_URL||'http://127.0.0.1:3000';
assert(['127.0.0.1','localhost'].includes(new URL(base).hostname),'Only run this smoke test against a local preview.');
const secret=process.env.DEMO_SESSION_SECRET||process.env.DEMO_PASSWORD;
assert(secret,'Set the preview session secret or demo password.');
function cookie(role:string){const body=Buffer.from(JSON.stringify({id:role==='ADMIN'?'ADMIN-001':'EMP-001',role,expires:Date.now()+60000})).toString('base64url');return 'nd_identity='+body+'.'+createHmac('sha256',secret!).update(body).digest('base64url');}
async function main(){
 const checks=[['/ops','Application funnel'],['/ops/applications','Interest confirmed'],['/ops/applications?status=JOINED','1 application'],['/ops/applications?q=no-such-candidate-qa','No applications match these filters.'],['/ops/reports','Download CSV'],['/ops/employers','Add employer'],['/ops/partners','Partners'],['/ops/matches','Job matches']];
 for(const [path,text] of checks){const response=await fetch(base+path,{headers:{Cookie:cookie('ADMIN')}});assert.equal(response.status,200,path);const html=(await response.text()).replace(/<!--.*?-->/g,'');assert(html.includes(text),path+' missing '+text);assert(!html.includes('"digest"'),path+' server error');console.log('PASS '+path);}
 const response=await fetch(base+'/ops/reports/download',{headers:{Cookie:cookie('ADMIN')}});assert.equal(response.status,200);assert(response.headers.get('content-disposition')?.includes('attachment'));const csv=await response.text();assert(csv.includes('"Metric","Value","Definition"'));assert(csv.includes('"Candidates","10"'));assert(csv.includes('"Referral rewards","75.00 INR"'));console.log('PASS CSV headers and database-backed totals');
 for(const role of [null,'EMPLOYER']){const response=await fetch(base+'/ops/reports/download',{headers:role?{Cookie:cookie(role)}:{}});assert.equal(response.status,403);console.log('PASS export denies '+(role||'anonymous')+' access');}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
