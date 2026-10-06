import test from 'node:test';
import assert from 'node:assert/strict';
import { requiredAgreement } from '../shared/consensus.ts';

test('whole-agent agreement rounds fractional votes upward without moving exact boundaries',()=>{
  assert.equal(requiredAgreement(20,.71),15);
  assert.equal(requiredAgreement(5,.01),1);
  assert.equal(requiredAgreement(5,1),5);
  assert.equal(requiredAgreement(100,.07),7);
  assert.equal(requiredAgreement(100,.070001),8);
});
