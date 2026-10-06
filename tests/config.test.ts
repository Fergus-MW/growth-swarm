import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig, validateConfig } from '../server/config.ts';
import type { Connector } from '../shared/types.ts';
const connector:Connector={id:'fixture-web',name:'Fixture',provider:'fixture',account:'local',mode:'fixture',capabilities:['search'],available:true,freshness:'Fixture',scope:'local',estimatedCost:'0',costPerCall:0,quotaKey:'fixture',version:'1',private:false};
const valid=()=>({...defaultConfig(),mode:'demo' as const,connectorIds:['fixture-web']});
test('admission enforces roster, explicit caps and source allowlist',()=>{
 assert.equal(validateConfig(valid(),[connector]).swarmSize,20);
 for(const swarmSize of [0,4,101,5.5])assert.throws(()=>validateConfig({...valid(),swarmSize},[connector]),/Agent count/);
 assert.throws(()=>validateConfig({...valid(),threshold:0},[connector]),/threshold/);
 assert.throws(()=>validateConfig({...valid(),connectorIds:['unselected']},[connector]),/Unknown source/);
 assert.throws(()=>validateConfig({...valid(),budget:{...valid().budget,money:Infinity}},[connector]),/Money cap/);
 assert.throws(()=>validateConfig({...valid(),agentConnectorIds:{'agent-1':['tavily']}},[connector]),/narrow/);
 assert.throws(()=>validateConfig({...valid(),connectorIds:[]},[connector]),/enabled source/);
});
