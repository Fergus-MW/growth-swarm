import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.ts';
import { defaultConfig } from '../server/config.ts';
import { claimTask, commitDraft, executeRun } from '../server/engine.ts';
import type { RunState, Task } from '../shared/types.ts';

function harness() {
  const dir=mkdtempSync(join(tmpdir(),'swarm-engine-')),store=new Store(dir);
  const config=defaultConfig();config.mode='demo';config.connectorIds=['fixture-web'];config.swarmSize=5;config.criteria.minCompanies=5;config.criteria.saturationAttempts=3;
  const run=store.create(config,crypto.randomUUID());
  return {dir,store,run,cleanup:()=>{store.close();rmSync(dir,{recursive:true,force:true});}};
}
test('five-agent fictional research captures evidence before writes and reaches honest configured-roster consensus',async()=>{
  const h=harness();try{
    const fence=h.store.claimExecution(h.run.id);await executeRun(h.store,h.run.id,fence,new AbortController().signal);
    const s=h.store.getState(h.run.id);
    assert.equal(s.run.outcome,'consensus',JSON.stringify({error:s.run.error,gaps:s.run.quality?.gaps,failed:s.tasks.filter(t=>t.error).map(t=>t.error)},null,2));
    assert.equal(s.run.quality?.qualifiedCompanies,5);assert.equal(s.run.quality?.contactCompanies,5);
    assert.equal(s.nodes.filter(n=>n.entityType==='person'&&n.title==='Alex Morgan').length,2,'same name at different companies remains distinct');
    assert.equal(s.nodes.filter(n=>n.status==='excluded').length,1);
    const epoch=s.votes.at(-1)!.epoch,votes=s.votes.filter(v=>v.epoch===epoch);assert.equal(votes.length,5);assert.equal(new Set(votes.map(v=>v.revision)).size,1);assert.equal(votes.filter(v=>v.yes).length,5);
    assert.ok(s.invocations.every(inv=>inv.rawPath&&inv.chunkIds.every(id=>s.nodes.some(n=>n.id===id))));
    assert.equal(s.run.usage.spent,0);assert.ok(s.invocations.every(i=>i.provider==='fixture'));
    assert.ok(s.nodes.filter(n=>n.category==='source_chunk').every(n=>n.body.includes('FICTIONAL')));
    for(const edge of s.edges.filter(e=>e.relation==='evidences')){
      const assertion=s.assertions.find(a=>a.id===edge.assertionId);
      assert.ok(assertion,'Every evidence edge binds an assertion');assert.equal(assertion.ownerId,edge.target);assert.equal(assertion.revisionId,edge.revisionId);
      for(const ref of edge.evidence)assert.ok(assertion.evidence.some(bound=>JSON.stringify(bound)===JSON.stringify(ref)),'Evidence span belongs to its exact field or prose assertion');
    }
    assert.equal(h.store.readCheckpoint(h.run.id).run.outcome,'consensus');
  }finally{h.cleanup();}
});
test('a smaller universe reports unmet counts without weakening criteria',async()=>{
  const h=harness();try{
    // Recreate with the default 50-company requirement.
    const c={...h.run.config,criteria:{...h.run.config.criteria,minCompanies:50}};
    const run=h.store.create(c,'fifty');const fence=h.store.claimExecution(run.id);await executeRun(h.store,run.id,fence,new AbortController().signal);
    const s=h.store.getState(run.id);assert.equal(s.run.outcome,'criteria_unmet');assert.equal(s.run.config.criteria.minCompanies,50);assert.equal(s.run.quality?.qualifiedCompanies,5);assert.ok(s.votes.every(v=>!v.yes));
  }finally{h.cleanup();}
});
test('an agent with no enabled connector never dispatches that connector',async()=>{
  const h=harness();try{
    const config={...h.run.config,agentConnectorIds:Object.fromEntries(Array.from({length:5},(_,i)=>[`agent-${i+1}`,[]]))};const run=h.store.create(config,'disabled');
    await executeRun(h.store,run.id,h.store.claimExecution(run.id),new AbortController().signal);
    const s=h.store.getState(run.id);assert.equal(s.invocations.length,0);assert.equal(s.run.usage.calls,0);assert.equal(s.run.outcome,'criteria_unmet');
  }finally{h.cleanup();}
});
test('expired claims are replaced and stale commits cannot author graph changes',()=>{
  const h=harness();try{
    const fence=h.store.claimExecution(h.run.id);let old:Task|undefined,newClaim:Task|undefined;
    h.store.mutate(h.run.id,fence,s=>{s.tasks.push({id:'task',kind:'discovery',payload:{segment:'x'},targetIds:[],priority:1,status:'open',attempts:0,owner:null,leaseExpiresAt:null,claimToken:null,dedupeKey:'goal',assessmentVersion:s.run.assessmentVersion,createdAt:new Date().toISOString(),calls:0});old=claimTask(s,'agent-1');s.tasks[0].leaseExpiresAt=new Date(0).toISOString();newClaim=claimTask(s,'agent-2');});
    assert.notEqual(old!.claimToken,newClaim!.claimToken);
    assert.throws(()=>h.store.mutate(h.run.id,fence,s=>commitDraft(s,old!,{nodes:[],edges:[],summary:'late'})),/Stale task claim/);
    assert.equal(h.store.getState(h.run.id).tasks[0].owner,'agent-2');
  }finally{h.cleanup();}
});
test('disconnect fences new dispatch and finalizes an inspectable partial run',async()=>{
  const h=harness();try{
    const abort=new AbortController();const timer=setTimeout(()=>abort.abort(),30);
    await executeRun(h.store,h.run.id,h.store.claimExecution(h.run.id),abort.signal);clearTimeout(timer);
    const s=h.store.getState(h.run.id);assert.equal(s.run.outcome,'disconnected');assert.ok(s.invocations.every(i=>i.status!=='pending'));assert.equal(h.store.readCheckpoint(h.run.id).run.outcome,'disconnected');
  }finally{h.cleanup();}
});
test('continuation requalifies historical companies, contacts and signals without mutating the parent',async()=>{
  const h=harness();try{
    await executeRun(h.store,h.run.id,h.store.claimExecution(h.run.id),new AbortController().signal);
    const parent=JSON.stringify(h.store.readCheckpoint(h.run.id));
    const config={...h.run.config,objective:h.run.config.objective+' Prioritize finance process owners.'};
    const child=h.store.create(config,'child-refresh',h.run.id);
    await executeRun(h.store,child.id,h.store.claimExecution(child.id),new AbortController().signal);
    const s=h.store.getState(child.id);
    assert.equal(s.run.outcome,'consensus',JSON.stringify({gaps:s.run.quality?.gaps,errors:s.tasks.filter(t=>t.error).map(t=>t.error)}));
    assert.equal(s.run.quality?.qualifiedCompanies,5);assert.equal(s.run.quality?.signalCompanies,5);assert.equal(s.run.quality?.contactCompanies,5);
    assert.equal(s.nodes.filter(n=>n.entityType==='company').length,6);assert.equal(s.nodes.filter(n=>n.entityType==='person').length,10);
    assert.equal(JSON.stringify(h.store.readCheckpoint(h.run.id)),parent);
  }finally{h.cleanup();}
});
test('fictional blank briefs do not claim arbitrary qualitative completion',async()=>{
  const h=harness();try{
    const run=h.store.create({...h.run.config,profile:'blank',objective:'Explain volcanoes and their regional hazards'},'blank');
    await executeRun(h.store,run.id,h.store.claimExecution(run.id),new AbortController().signal);
    const s=h.store.getState(run.id);assert.equal(s.run.outcome,'criteria_unmet');assert.ok(s.votes.every(v=>!v.yes));assert.ok(s.nodes.some(n=>n.semanticKind==='topic'));assert.ok(s.nodes.every(n=>n.semanticKind!=='pain'));
  }finally{h.cleanup();}
});
test('call cap stops dispatch independently of consensus and retains unsettled invocation status',async()=>{
  const h=harness();try{
    const config={...h.run.config,budget:{...h.run.config.budget,maxCalls:1}};
    const run=h.store.create(config,'one-call');await executeRun(h.store,run.id,h.store.claimExecution(run.id),new AbortController().signal);
    const s=h.store.getState(run.id);assert.equal(s.run.outcome,'budget_connector');assert.equal(s.run.usage.calls,1);assert.equal(s.invocations.length,1);assert.ok(s.invocations.every(i=>i.status!=='pending'));
  }finally{h.cleanup();}
});
test('fair queues reserve room for contacts even when discovery has a large frontier',()=>{
  const h=harness();try{
    const fence=h.store.claimExecution(h.run.id),selected:string[]=[];
    h.store.mutate(h.run.id,fence,s=>{
      for(let i=0;i<30;i++)s.tasks.push({id:`discovery-${i}`,kind:'discovery',payload:{},targetIds:[],priority:1,status:'open',attempts:0,owner:null,leaseExpiresAt:null,claimToken:null,dedupeKey:`d-${i}`,assessmentVersion:s.run.assessmentVersion,createdAt:new Date().toISOString(),calls:0});
      s.tasks.push({...s.tasks[0],id:'contact',kind:'contacts',dedupeKey:'contact'});
      for(let i=0;i<5;i++){const task=claimTask(s,`agent-${i+1}`);if(task)selected.push(task.kind);}
    });
    assert.ok(selected.includes('contacts'));assert.equal(selected.length,5);
  }finally{h.cleanup();}
});

test('seven percent of a 100-agent roster requires exactly seven votes',async()=>{
  const h=harness();try{
    const run=h.store.create({...h.run.config,swarmSize:100,threshold:.07},'seven-percent');
    await executeRun(h.store,run.id,h.store.claimExecution(run.id),new AbortController().signal);
    const state=h.store.getState(run.id);
    assert.ok(state.traces.some(trace=>trace.status==='vote'&&trace.summary.includes('; 7 required.')),state.traces.filter(trace=>trace.status==='vote').map(trace=>trace.summary).join('\n'));
    assert.equal(state.run.config.threshold,.07);
  }finally{h.cleanup();}
});
