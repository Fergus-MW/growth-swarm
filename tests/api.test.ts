import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { Store } from '../server/store.ts';
import { createApi } from '../server/api.ts';
import type { RunConfig } from '../shared/types.ts';

async function setup(){
 const dir=mkdtempSync(join(tmpdir(),'swarm-api-'));const store=new Store(dir);const app=createApi(store);
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const address=app.server.address();if(!address||typeof address==='string')throw new Error('No listener');
 const base=`http://127.0.0.1:${address.port}`;
 const bootstrap=await fetch(base+'/api/bootstrap');const cookie=bootstrap.headers.get('set-cookie')!.split(';')[0];const info=await bootstrap.json() as {defaults:RunConfig};
 const call=(path:string,init:RequestInit={})=>fetch(base+path,{...init,headers:{cookie,'Content-Type':'application/json',...init.headers}});
 return {store,call,base,config:{...info.defaults,mode:'demo' as const,connectorIds:['fixture-web'],swarmSize:5,criteria:{...info.defaults.criteria,text:'Find supported fictional company examples.',minCompanies:1,saturationAttempts:0}},close:async()=>{app.abortAll();await new Promise<void>(r=>app.server.close(()=>r()));store.close();rmSync(dir,{recursive:true,force:true});}};
}

test('local API requires session, rejects cross-origin, and idempotently admits complete initial state',async()=>{
 const app=await setup();try{
  assert.equal((await fetch(app.base+'/api/runs')).status,401);
  assert.equal((await app.call('/api/runs',{headers:{Origin:'https://attacker.example'}})).status,403);
  const post=()=>app.call('/api/runs',{method:'POST',headers:{'Idempotency-Key':'api-creation-key'},body:JSON.stringify({config:app.config})});
  const first=await post();assert.equal(first.status,201);const run=await first.json() as {id:string};
  const second=await post();assert.equal((await second.json() as {id:string}).id,run.id);
  assert.equal(app.store.readCheckpoint(run.id).run.outcome,'ready');
  const bad=await app.call('/api/runs',{method:'POST',headers:{'Idempotency-Key':'invalid-key'},body:JSON.stringify({config:{...app.config,swarmSize:1}})});assert.equal(bad.status,400);
 }finally{await app.close();}
});

test('stream disconnect stops execution; partial state remains exportable and continuable',async()=>{
 const app=await setup();try{
  const result=await app.call('/api/runs',{method:'POST',headers:{'Idempotency-Key':'api-execution-key'},body:JSON.stringify({config:app.config})});const run=await result.json() as {id:string};
  const stream=await app.call(`/api/runs/${run.id}/execute`,{method:'POST',body:'{}'});assert.equal(stream.status,200);assert.match(stream.headers.get('content-type')!,/text\/event-stream/);
  const reader=stream.body!.getReader();const first=await reader.read();assert.match(new TextDecoder().decode(first.value),/event: snapshot/);
  const duplicate=await app.call(`/api/runs/${run.id}/execute`,{method:'POST',body:'{}'});assert.equal(duplicate.status,409);
  await reader.cancel();
  for(let i=0;i<100&&!app.store.getRun(run.id).finishedAt;i++)await new Promise(r=>setTimeout(r,30));
  assert.equal(app.store.getRun(run.id).outcome,'disconnected');
  const exported=await app.call(`/api/runs/${run.id}/export?format=json`);assert.equal(exported.status,200);assert.match(exported.headers.get('content-disposition')!,/attachment/);assert.match(await exported.text(),/disconnected/);
  const child=await app.call('/api/runs',{method:'POST',headers:{'Idempotency-Key':'api-child-key'},body:JSON.stringify({config:app.config,parentId:run.id})});assert.equal(child.status,201);assert.equal((await child.json() as {parentId:string}).parentId,run.id);
 }finally{await app.close();}
});

test('large snapshot backpressure drains once and execution stream terminates',async()=>{
 const app=await setup();try{
  const result=await app.call('/api/runs',{method:'POST',headers:{'Idempotency-Key':'api-full-stream'},body:JSON.stringify({config:app.config})});const run=await result.json() as {id:string};
  const response=await app.call(`/api/runs/${run.id}/execute`,{method:'POST',body:'{}',signal:AbortSignal.timeout(15000)});
  const stream=await response.text();assert.match(stream,/event: (terminal|saved|resync)/);assert.ok(stream.length<40_000_000,'Backpressure must not produce an unbounded resync loop');assert.equal(app.store.getRun(run.id).outcome,'consensus');
 }finally{await app.close();}
});
