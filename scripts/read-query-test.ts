import assert from 'node:assert/strict';
import {readQuery} from '../src/lib/read-query';
async function main(){
 let cancelled=0;
 const ready=Object.assign(Promise.resolve(['profile']),{cancel(){cancelled++;}});
 assert.deepEqual(await readQuery(ready,20),['profile']);
 await new Promise(r=>setTimeout(r,30)); assert.equal(cancelled,0);
 const failing=Object.assign(Promise.reject(new Error('database unavailable')),{cancel(){cancelled++;}});
 await assert.rejects(readQuery(failing,20),/database unavailable/);
 const hanging=Object.assign(new Promise<never>(()=>{}),{cancel(){cancelled++;}});
 await assert.rejects(readQuery(hanging,10),/taking too long/);assert.equal(cancelled,1);
 console.log('Read timeout checks passed: success, query failure, stalled query cancellation.');
}
main();
