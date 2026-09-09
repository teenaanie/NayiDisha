const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');const ts=require('typescript');
let account=null,status='VERIFIED',actor={id:'OPS-001',role:'OPERATIONS'},session=null;const deleted=[];
const passwordModule=load('src/lib/demo-password.ts',{});
const sql=async(strings,...v)=>{
 const q=strings.join('?');
 if(q.includes('SELECT version'))return [{version:account.version}];
 if(q.includes('SELECT status'))return [{status}];
 if(q.includes('INSERT INTO app.demo_account')){account={...account,entity_id:v[0],role:v[1],invite_hash:v[2],invite_expires_at:Date.now()+86400000,version:account?.version||0};return [];}
 if(q.includes('SELECT * FROM app.demo_account WHERE invite_hash'))return account&&account.invite_hash===v[0]&&account.invite_expires_at>Date.now()?[{...account}]:[];
 if(q.includes('SELECT * FROM app.demo_account WHERE entity_id'))return account?.entity_id===v[0]?[{...account}]:[];
 if(q.includes('SET password_hash')){Object.assign(account,{password_hash:v[0],invite_hash:null,invite_expires_at:null,failed_attempts:0,locked_until:null,version:account.version+1});return [];}
 if(q.includes('SET failed_attempts=CASE')){account.failed_attempts=account.locked_until?1:(account.failed_attempts||0)+1;account.locked_until=!account.locked_until&&account.failed_attempts>=5?new Date(Date.now()+900000):null;return [];}
 if(q.includes('SET failed_attempts=0')){account.failed_attempts=0;account.locked_until=null;return [];}
 if(q.includes('SELECT id FROM app.candidate'))return v[0]==='+910000000042'?[{id:'CAN-042'}]:[];
 if(q.includes('INSERT INTO app.action_audit'))return [];
 throw new Error('Unexpected query '+q);
};sql.begin=async fn=>fn(sql);
function load(file,mocks){const exports={};const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText;vm.runInNewContext(js,{exports,require:n=>n in mocks?mocks[n]:require(n),Buffer,console,Date,Promise,setTimeout,clearTimeout,process:{env:{NODE_ENV:"test"}}},{filename:file});return exports;}
const a=load('src/app/sign-in/actions.ts',{
 'next/headers':{cookies:async()=>({delete:n=>deleted.push(n)})},
 'next/navigation':{redirect:path=>{throw new Error('REDIRECT:'+path)}},
 'next/cache':{revalidatePath(){}},'@/lib/db':{sql},'@/lib/read-query':{readQuery:q=>q},
 '@/lib/auth':{requireRole:async roles=>{if(!roles.includes(actor.role))throw new Error('Forbidden');return actor;},setIdentity:async(id,role,name,version)=>{session={id,role,version};}},
 '@/lib/demo-password':passwordModule
});
const form=o=>{const f=new FormData;for(const [k,v]of Object.entries(o))f.set(k,v);return f;};
(async()=>{
 const hash=await passwordModule.hashPassword('demo-password-one');assert(await passwordModule.checkPassword('demo-password-one',hash));assert(!await passwordModule.checkPassword('wrong',hash));await assert.rejects(()=>passwordModule.hashPassword('short'));
 actor.role='PARTNER';await assert.rejects(()=>a.issueInvitation('EMPLOYER','EMP-001'),/Forbidden/);actor.role='OPERATIONS';
 status='PENDING';await assert.rejects(()=>a.issueInvitation('EMPLOYER','EMP-001'),/Approve/);status='VERIFIED';
 const first=await a.issueInvitation('EMPLOYER','EMP-001');const second=await a.issueInvitation('EMPLOYER','EMP-001');
 assert((await a.acceptInvitation(form({token:first.split('/').pop(),password:'demo-password-one'}))).error);
 account.invite_expires_at=Date.now()-1;assert((await a.acceptInvitation(form({token:second.split('/').pop(),password:'demo-password-one'}))).error);account.invite_expires_at=Date.now()+10000;
 await assert.rejects(()=>a.acceptInvitation(form({token:second.split('/').pop(),password:'demo-password-one'})),/REDIRECT:\/employer/);assert.equal(session.version,1);assert(deleted.includes('nd_admin'));
 assert((await a.acceptInvitation(form({token:second.split('/').pop(),password:'demo-password-one'}))).error);
 for(let i=0;i<5;i++)assert((await a.signIn(form({id:'EMP-001',password:'incorrect-password'}))).error);
 assert((await a.signIn(form({id:'EMP-001',password:'demo-password-one'}))).error);account.locked_until=new Date(Date.now()-1);
 await assert.rejects(()=>a.signIn(form({id:'EMP-001',password:'demo-password-one'})),/REDIRECT:\/employer/);
 const reset=await a.issueInvitation('EMPLOYER','EMP-001');await assert.rejects(()=>a.acceptInvitation(form({token:reset.split('/').pop(),password:'new-demo-password'})),/REDIRECT:\/employer/);assert.equal(session.version,2);assert((await a.signIn(form({id:'EMP-001',password:'demo-password-one'}))).error);
 status='SUSPENDED';assert((await a.signIn(form({id:'EMP-001',password:'demo-password-one'}))).error);status='VERIFIED';
 assert((await a.candidateSignIn(form({phone:'+910000000042',code:'999999'}))).error);
 await assert.rejects(()=>a.candidateSignIn(form({phone:'+910000000042',code:'123456'})),/REDIRECT:\/wa/);assert.equal(session.id,'CAN-042');
 const jar=new Map();const auth=load('src/lib/auth.ts',{'next/headers':{cookies:async()=>({get:n=>jar.has(n)?{value:jar.get(n)}:undefined,set:(n,v)=>jar.set(n,v)})},'./db':{sql},'./read-query':{readQuery:q=>q}});
 status='VERIFIED';await auth.setIdentity('EMP-001','EMPLOYER','nd_identity',1);await assert.rejects(()=>auth.requireRole(['EMPLOYER']),/access was reset/);await auth.setIdentity('EMP-001','EMPLOYER','nd_identity',2);await auth.requireRole(['EMPLOYER']);await assert.rejects(()=>auth.scopePage('employer','EMP-OTHER'),/another account/);status='SUSPENDED';await assert.rejects(()=>auth.requireRole(['EMPLOYER']),/not approved/);
 console.log('Passed password hashing, role restriction, approval requirement, replaced/expired/used invitation rejection, activation, login, lockout, suspension, and returning-candidate checks (mock database).');
})().catch(e=>{console.error(e);process.exitCode=1;});
