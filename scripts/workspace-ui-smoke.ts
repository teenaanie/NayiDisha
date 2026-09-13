/** Read-only route checks for each workspace. Uses existing demo identities; never resets data. */
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
const base=process.env.UI_TEST_URL||'http://127.0.0.1:3000';
assert(['localhost','127.0.0.1'].includes(new URL(base).hostname),'Local preview only.');
const secret=process.env.DEMO_SESSION_SECRET||process.env.DEMO_PASSWORD;
assert(secret,'Use the same session secret or password as the preview server.');
function token(role:string,id:string){const body=Buffer.from(JSON.stringify({id,role,expires:Date.now()+3600000})).toString('base64url');return body+'.'+createHmac('sha256',secret!).update(body).digest('base64url');}
const groups=[
 {role:'ADMIN',id:'ADMIN-001',paths:['/','/demo','/ops','/ops/employers','/ops/employers/EMP-001/edit','/ops/new-employer','/ops/partners','/ops/partners/PAR-001/edit','/ops/new-partner','/ops/candidates','/ops/candidates/CAN-001','/ops/jobs','/ops/matches','/ops/applications','/ops/attribution','/ops/exceptions','/ops/credit-requests','/ops/reports','/ops/configurations','/ops/manage',...['localities','roles','matching','fields','configurations','commercial'].map(s=>'/ops/manage/'+s),'/ops/replacements','/ops/fraud','/ops/data-requests','/ops/audit']},
 {role:'EMPLOYER',id:'EMP-001',paths:['/employer','/employer/profile','/employer/jobs','/employer/job/JOB-001','/employer/jobs/JOB-001/edit','/employer/new-job','/employer/hiring','/employer/credit-requests','/employer/billing','/employer/outcomes']},
 {role:'PARTNER',id:'PAR-001',paths:['/partner','/partner/profile','/partner/sites','/partner/candidates','/partner/alerts','/partner/rewards','/partner/conduct']},
 {role:'FINANCE',id:'FIN-001',paths:['/finance','/finance/balances','/finance/payouts','/finance/ledger']},
 {role:'CANDIDATE',id:'CAN-001',paths:['/wa','/wa/profile','/wa/applications','/wa/suggestions','/wa/inbox','/wa/preferences','/wa/rights']},
];
let passed=0;const failures:string[]=[];
async function page(path:string,role?:string,id?:string,expected?:string){try{const headers=role?{Cookie:'nd_identity='+token(role,id!)+'; nd_admin='+token('ADMIN','ADMIN-001')}:undefined;const r=await fetch(base+path,{headers,signal:AbortSignal.timeout(45000)});assert.equal(r.status,200);const html=(await r.text()).replace(/<!--.*?-->/g,'');assert(!/An error occurred in the Server Components render|We could not complete that request|We couldn’t open this page/.test(html),'Server render failed');assert(html.includes('nd-shell'),'Workspace shell missing');if(expected)assert(html.includes(expected),'Expected content missing: '+expected);passed++;console.log('PASS '+path);}catch(e){failures.push(path+': '+String(e));console.error('FAIL '+path+': '+String(e));}}
async function main(){for(const group of groups){for(const path of group.paths)await page(path,group.role,group.id);}await page('/sign-in',undefined,undefined,'Returning job seekers');await page('/invite/invalid-preview-token',undefined,undefined,'Invitation unavailable');for(const path of ['/ops/employers','/ops/partners','/ops/candidates','/ops/jobs'])await page(path+'?q=not-a-real-record-qa','ADMIN','ADMIN-001',path.endsWith('candidates')?'No candidates found':'No matching');await page('/ops/employers?q=EMP-001','ADMIN','ADMIN-001','DEMO Sahyadri Bank');console.log(`\n${passed} passed, ${failures.length} failed`);if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}}
main();
