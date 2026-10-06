import test from 'node:test';
import assert from 'node:assert/strict';
import { explicitCriteria, criteriaConflicts, rewriteCriteriaText } from '../shared/criteria.ts';
import { defaultConfig } from '../server/config.ts';
test('explicit numeric prose cannot be weakened by a smaller structured predicate',()=>{
 const c=defaultConfig().criteria;
 assert.deepEqual(explicitCriteria(c.text),{minCompanies:50,signalPercent:80,independentSources:2,saturationAttempts:40,requireContacts:true});
 assert.equal(criteriaConflicts(c).length,0);assert.ok(criteriaConflicts({...c,minCompanies:3}).length);
 const text=rewriteCriteriaText(c.text,'minCompanies',3);assert.equal(explicitCriteria(text).minCompanies,3);assert.equal(criteriaConflicts({...c,text,minCompanies:3}).length,0);
});
