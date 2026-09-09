import assert from 'node:assert/strict';
import {summarizeCreditEntries} from '../src/modules/commercial';
const summary=summarizeCreditEntries([{entry_type:'INCLUDED_GRANT',credit_delta:10},{entry_type:'PURCHASE',credit_delta:3},{entry_type:'UNLOCK_CONSUME',credit_delta:-1},{entry_type:'UNLOCK_CONSUME',credit_delta:-1},{entry_type:'REPLACEMENT_RESTORE',credit_delta:1},{entry_type:'EXPIRY',credit_delta:-2}]);
assert.deepEqual(summary,{granted:10,purchased:3,consumed:2,restored:1,expired:2,available:10,includedRemaining:8});
assert.equal(summarizeCreditEntries([]).available,0);
assert.equal(summarizeCreditEntries([{entry_type:'INCLUDED_GRANT',credit_delta:1},{entry_type:'UNLOCK_CONSUME',credit_delta:-2}]).available,-1);
console.log('Credit summaries: grants, purchases, unlocks, replacements, expiry, empty ledger and deficit passed.');
