import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Store } from '../server/store.ts';
import { defaultConfig } from '../server/config.ts';
import type { GraphNode, Invocation } from '../shared/types.ts';
function setup(){const dir=mkdtempSync(join(tmpdir(),'swarm-store-'));return {dir,store:new Store(dir)};}
function config(){return {...defaultConfig(),mode:'demo' as const,connectorIds:['fixture-web'],swarmSize:5};}
function chunk(runId:string):GraphNode{const body='Captured original passage';return {id:'chunk-1',category:'source_chunk',title:'Original',tenantId:'local',runId,originRunId:runId,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),version:1,access:{tenantId:'local',connectorIds:['fixture-web']},body,aliases:[],tags:[],evidence:[],source:{connectorId:'fixture-web',provider:'fixture',invocationId:'invocation-1',locator:null,sourceIdentity:'original',origin:'fixture',contentHash:createHash('sha256').update(body).digest('hex'),mimeType:'text/plain',format:'text',publishedAt:null,eventAt:null,fetchedAt:new Date().toISOString(),offsets:{start:0,end:body.length}}};}
function invocation(runId:string):Invocation{return {id:'invocation-1',runId,agentId:'agent-1',taskId:'task-1',connectorId:'fixture-web',provider:'fixture',operation:'search',query:'original',queryHash:'query',status:'succeeded',startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),chunkIds:['chunk-1'],returnedCount:1,cost:0,reservedCost:0,truncated:false};}

test('creation is durable and idempotent; conflicting retries cannot create a second run',()=>{
 const {dir,store}=setup();try{const first=store.create(config(),'same-key');assert.equal(store.create(config(),'same-key').id,first.id);assert.equal(store.readCheckpoint(first.id).run.outcome,'ready');assert.throws(()=>store.create({...config(),objective:'Different'},'same-key'),/different inputs/);assert.equal(store.list().length,1);}finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('execution claim is single owner, fenced writes roll back, graph freezes during evaluation',()=>{
 const {dir,store}=setup();try{const run=store.create(config(),'execution');const fence=store.claimExecution(run.id);assert.throws(()=>store.claimExecution(run.id),/already started/);assert.throws(()=>store.mutate(run.id,fence-1,s=>{s.run.title='Bad';}),/stale/);store.mutate(run.id,fence,s=>{s.run.outcome='evaluating';});assert.throws(()=>store.mutate(run.id,fence,s=>{s.nodes.push(chunk(run.id));}),/frozen/);assert.equal(store.getState(run.id).nodes.length,0);assert.throws(()=>store.mutate(run.id,fence,s=>{s.run.config.threshold=.01;}),/frozen/);assert.equal(store.getRun(run.id).config.threshold,.7);}finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('captures survive checkpoint lag and interrupted executions are fenced on restart',()=>{
 const {dir,store}=setup();const run=store.create(config(),'capture');const fence=store.claimExecution(run.id);store.capture(run.id,fence,invocation(run.id),[chunk(run.id)],{original:'Captured original passage'});store.capture(run.id,fence,invocation(run.id),[chunk(run.id)],{});assert.equal(store.getState(run.id).nodes.length,1);store.close();
 const restored=new Store(dir);try{const s=restored.getState(run.id);assert.equal(s.run.outcome,'failed');assert.ok(s.run.fence>fence);assert.equal(s.nodes[0].body,'Captured original passage');assert.equal(s.invocations.length,1);assert.equal(restored.readCheckpoint(run.id).nodes.length,1);}finally{restored.close();rmSync(dir,{recursive:true,force:true});}
});
test('child retains source provenance, resets assessments/votes and never modifies parent',()=>{
 const {dir,store}=setup();try{const run=store.create(config(),'parent');const fence=store.claimExecution(run.id);store.capture(run.id,fence,invocation(run.id),[chunk(run.id)],{});store.finish(run.id,fence,'criteria_unmet');const before=JSON.stringify(store.readCheckpoint(run.id));const child=store.create({...config(),objective:'New question'},'child',run.id);const s=store.getState(child.id);assert.equal(s.run.parentGeneration,run.generation+2);assert.equal(s.nodes[0].originRunId,run.id);assert.equal(s.nodes[0].runId,child.id);assert.equal(s.votes.length,0);assert.equal(s.tasks.length,0);assert.equal(s.run.usage.spent,0);assert.equal(JSON.stringify(store.readCheckpoint(run.id)),before);}finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('checkpoint integrity is verified before restore or export',()=>{
 const {dir,store}=setup();try{const run=store.create(config(),'checksum');writeFileSync(join(dir,'runs',run.id,'generations','1','state.json'),'{}');assert.throws(()=>store.readCheckpoint(run.id),/checksum/);}finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('reopening a saved terminal parent preserves its exact checkpoint and catalogue generation',()=>{
 const {dir,store}=setup();const run=store.create(config(),'terminal-parent');store.finish(run.id,run.fence,'stopped_by_user');const before=JSON.stringify(store.readCheckpoint(run.id));const catalogue=JSON.stringify(store.getState(run.id));store.close();
 const restored=new Store(dir);try{assert.equal(JSON.stringify(restored.readCheckpoint(run.id)),before);assert.equal(JSON.stringify(restored.getState(run.id)),catalogue);}finally{restored.close();rmSync(dir,{recursive:true,force:true});}
});
test('durable capture descriptor replays after crash before journal and graph registration',()=>{
 const {dir,store}=setup();const run=store.create(config(),'disk-journal');const fence=store.claimExecution(run.id);const before=store.getState(run.id);store.capture(run.id,fence,invocation(run.id),[chunk(run.id)],{original:'Captured original passage'});
 // The descriptor and raw response made it to disk, but SQLite effects did not.
 store.db.prepare('DELETE FROM captures WHERE run_id=?').run(run.id);store.db.prepare('DELETE FROM events WHERE run_id=?').run(run.id);store.db.prepare('UPDATE runs SET state=? WHERE id=?').run(JSON.stringify(before),run.id);store.close();
 const restored=new Store(dir);try{const after=restored.getState(run.id);assert.equal(after.nodes.length,1);assert.equal(after.invocations[0].status,'succeeded');assert.ok(after.run.revision>before.run.revision);assert.ok(after.run.sequence>before.run.sequence);assert.ok(after.run.usage.bytes>0);assert.equal(restored.readCheckpoint(run.id).nodes.length,1);}finally{restored.close();rmSync(dir,{recursive:true,force:true});}
});
test('capture byte accounting is idempotent and an oversize response is retained before stopping',()=>{
 const {dir,store}=setup();try{const run=store.create({...config(),budget:{...config().budget,maxBytes:100}},'storage-cap');const fence=store.claimExecution(run.id);store.capture(run.id,fence,invocation(run.id),[chunk(run.id)],{large:'x'.repeat(1000)});const after=store.getState(run.id);assert.equal(after.run.outcome,'budget_storage');assert.ok(after.run.usage.bytes>1000);assert.equal(after.nodes.length,1);assert.equal(store.readCheckpoint(run.id).nodes.length,1);assert.match(readFileSync(after.invocations[0].rawPath!,'utf8'),/xxx/);store.capture(run.id,fence,invocation(run.id),[chunk(run.id)],{});assert.equal(store.getRun(run.id).usage.bytes,after.run.usage.bytes);}finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('exclusive process lock rejects concurrent stores and is released on close',()=>{
 const {dir,store}=setup();assert.throws(()=>new Store(dir),/Another research process/);store.close();const reopened=new Store(dir);reopened.close();rmSync(dir,{recursive:true,force:true});
});
test('stale process locks are recovered without affecting a live owner',()=>{
 const dir=mkdtempSync(join(tmpdir(),'swarm-lock-'));writeFileSync(join(dir,'worker.lock'),JSON.stringify({pid:99999999,token:'stale'}));const store=new Store(dir);try{assert.equal(JSON.parse(readFileSync(join(dir,'worker.lock'),'utf8')).pid,process.pid);}finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('a storage stop still captures already dispatched responses, then terminal fencing rejects late work',()=>{
 const {dir,store}=setup();try{const run=store.create({...config(),budget:{...config().budget,maxBytes:100}},'inflight-cap');const fence=store.claimExecution(run.id);const second={...invocation(run.id),id:'invocation-2',chunkIds:['chunk-2']};const secondChunk={...chunk(run.id),id:'chunk-2',source:{...chunk(run.id).source!,invocationId:'invocation-2'}};
 store.mutate(run.id,fence,s=>{s.invocations.push({...second,status:'pending'});});store.capture(run.id,fence,invocation(run.id),[chunk(run.id)],{});assert.equal(store.getRun(run.id).outcome,'budget_storage');store.capture(run.id,fence,second,[secondChunk],{});assert.equal(store.getState(run.id).nodes.length,2);store.finish(run.id,fence,'budget_storage');assert.throws(()=>store.capture(run.id,fence,second,[secondChunk],{}),/Stale capture/);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
