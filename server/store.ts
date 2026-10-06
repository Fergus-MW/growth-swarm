import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, renameSync, existsSync, openSync, fsyncSync, closeSync, readdirSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { ACTIVE_OUTCOMES, type RunConfig, type RunState, type Run, type Outcome, type StreamEvent, type Invocation, type GraphNode } from '../shared/types.ts';
import { AppError, DEFAULT_SCHEMA } from './config.ts';
import { validateNode } from './validation.ts';

const hash = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const now = () => new Date().toISOString();
function durableWrite(path: string, data: string) {
  const fd = openSync(path, 'w', 0o600);
  try { writeFileSync(fd, data); fsyncSync(fd); } finally { closeSync(fd); }
}
function syncDirectory(path: string) { const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);} }
function graphHash(s: RunState) { return hash([s.nodes,s.edges,s.assertions]); }
export class Store {
  readonly db!: DatabaseSync;
  readonly root: string;
  private readonly lockToken = randomUUID();
  private closed = false;
  private listeners = new Map<string, Set<(event: StreamEvent) => void>>();
  constructor(root = process.env.DATA_DIR || '.data') {
    this.root = resolve(root); mkdirSync(this.root, { recursive: true, mode: 0o700 });
    this.acquireLock();
    try {
    this.db = new DatabaseSync(join(this.root, 'control.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS idempotency(key TEXT PRIMARY KEY, hash TEXT NOT NULL, run_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS captures(id TEXT PRIMARY KEY, run_id TEXT NOT NULL, descriptor TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(run_id TEXT NOT NULL, sequence INTEGER NOT NULL, event TEXT NOT NULL, PRIMARY KEY(run_id,sequence));`);
    this.recover();
    } catch (error) { this.db?.close(); this.releaseLock(); throw error; }
  }
  private acquireLock() {
    const path = join(this.root, 'worker.lock');
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const fd = openSync(path, 'wx', 0o600);
        try { writeFileSync(fd, JSON.stringify({ pid: process.pid, token: this.lockToken })); fsyncSync(fd); } finally { closeSync(fd); }
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        let existing: { pid: number; token: string };
        try { existing = JSON.parse(readFileSync(path, 'utf8')); } catch { throw new AppError(409, 'The data directory has an invalid process lock. Inspect worker.lock before restarting.'); }
        if (!Number.isInteger(existing.pid) || existing.pid < 1) throw new AppError(409, 'The data directory has an invalid process lock.');
        try { process.kill(existing.pid, 0); throw new AppError(409, 'Another research process is using this data directory.'); }
        catch (aliveError) {
          if ((aliveError as NodeJS.ErrnoException).code !== 'ESRCH') throw aliveError;
          // Remove only the stale lock we inspected; never a replacement owner's lock.
          if (readFileSync(path, 'utf8') === JSON.stringify(existing)) unlinkSync(path);
        }
      }
    }
    throw new AppError(409, 'Could not acquire the research data directory lock.');
  }
  private releaseLock() {
    const path = join(this.root, 'worker.lock');
    try { if (JSON.parse(readFileSync(path, 'utf8')).token === this.lockToken) unlinkSync(path); } catch { /* A failed open must not remove another owner's lock. */ }
  }
  close() { if (this.closed) return; this.closed = true; try { this.db.close(); } finally { this.releaseLock(); } }
  getState(id: string): RunState {
    const row = this.db.prepare('SELECT state FROM runs WHERE id=?').get(id) as {state:string}|undefined;
    if (!row) throw new AppError(404,'Run not found.');
    return JSON.parse(row.state);
  }
  getRun(id: string): Run { return this.getState(id).run; }
  list(): Run[] { return (this.db.prepare('SELECT state FROM runs').all() as {state:string}[]).map(row=>JSON.parse(row.state).run).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)); }
  private save(state: RunState) { this.db.prepare('INSERT INTO runs(id,state) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state').run(state.run.id,JSON.stringify(state)); }
  private transaction<T>(fn:()=>T): T { this.db.exec('BEGIN IMMEDIATE'); try { const v = fn(); this.db.exec('COMMIT'); return v; } catch(e) { this.db.exec('ROLLBACK'); throw e; } }
  create(config: RunConfig, key: string, parentId?: string): Run {
    const fingerprint = hash({config,parentId:parentId||null});
    const existing = this.db.prepare('SELECT hash,run_id FROM idempotency WHERE key=?').get(key) as {hash:string;run_id:string}|undefined;
    if (existing) { if (existing.hash !== fingerprint) throw new AppError(409,'This idempotency key was already used with different inputs.'); return this.getRun(existing.run_id); }
    let parent: RunState | undefined;
    if (parentId) {
      parent = this.readCheckpoint(parentId);
      if (ACTIVE_OUTCOMES.includes(this.getRun(parentId).outcome) || this.getRun(parentId).outcome === 'ready') throw new AppError(409,'Stop or finish the parent before continuing it.');
      if (parent.run.config.mode !== config.mode && config.reuseParentSources) throw new AppError(400,'Do not reuse fictional fixture evidence in a live run. Turn off inherited evidence or keep the same mode.');
    }
    const id = randomUUID(); const timestamp = now();
    const run: Run = { id, tenantId:'local',userId:'local',title:config.objective.slice(0,120),config:structuredClone(config),outcome:'ready',createdAt:timestamp,startedAt:null,finishedAt:null,checkpointAt:null,generation:0,revision:0,sequence:0,fence:0,stopRequested:false,parentId:parentId||null,parentGeneration:parent?.run.generation||null,lineage:parent?[...parent.run.lineage,parent.run.id]:[],assessmentVersion:randomUUID(),usage:{spent:0,reserved:0,calls:0,inputTokens:0,outputTokens:0,bytes:0,connectorCalls:{}},error:null,counts:{primary_entity:0,note:0,source_chunk:0},quality:null,modelEndpoint:config.mode==='demo'?'fixture://deterministic':'https://generativelanguage.googleapis.com',costPolicyVersion:'explicit-upper-bound-1' };
    const state:RunState = {run,schema:parent?.schema||structuredClone(DEFAULT_SCHEMA),nodes:[],edges:[],assertions:[],tasks:[],agents:Array.from({length:config.swarmSize},(_,i)=>({id:`agent-${i+1}`,name:`Agent ${String(i+1).padStart(2,'0')}`,status:'idle',taskId:null,completedTasks:0,summary:'Waiting to start'})),invocations:[],votes:[],traces:[],discovery:{segments:[],coveredSegments:[],recentEligibleCounts:[]}};
    if (parent && config.reuseParentSources) {
      state.nodes = structuredClone(parent.nodes).map(n=>({...n,runId:id,historical:n.category!=='source_chunk',status:n.category==='primary_entity'?'candidate' as const:n.status}));
      state.edges = structuredClone(parent.edges).map(e=>({...e,historical:e.kind==='semantic'||e.kind==='inference'}));
      state.assertions=structuredClone(parent.assertions).map(a=>({...a,historical:true}));
      state.invocations=structuredClone(parent.invocations);
      state.run.usage.bytes = Buffer.byteLength(JSON.stringify(state.nodes));
    }
    this.recount(state);
    if (state.run.usage.bytes > config.budget.maxBytes || state.run.counts.source_chunk > config.budget.maxChunks) throw new AppError(400,'Inherited evidence exceeds the child storage budget.');
    this.transaction(()=>{ this.save(state); this.db.prepare('INSERT INTO idempotency(key,hash,run_id) VALUES(?,?,?)').run(key,fingerprint,id); });
    try { this.checkpoint(id); } catch(e) {
      this.transaction(()=>{ this.db.prepare('DELETE FROM idempotency WHERE key=?').run(key); this.db.prepare('DELETE FROM runs WHERE id=?').run(id); });
      throw e;
    }
    return this.getRun(id);
  }
  private recount(state:RunState) {
    state.run.counts={primary_entity:0,note:0,source_chunk:0};
    for (const node of state.nodes) state.run.counts[node.category]++;
  }
  mutate(id:string,fence:number,fn:(state:RunState)=>void,eventType='state'):RunState {
    let event:StreamEvent|undefined;
    const result=this.transaction(()=>{
      const state=this.getState(id);
      if (state.run.fence!==fence) throw new AppError(409,'Execution fence is stale.');
      const before=graphHash(state); const immutable=hash([state.run.config,state.schema,state.run.id]); const oldOutcome=state.run.outcome;
      fn(state);
      if (hash([state.run.config,state.schema,state.run.id])!==immutable) throw new AppError(409,'Execution configuration and schema are frozen.');
      const graphChanged=before!==graphHash(state);
      if (graphChanged && oldOutcome==='evaluating') throw new AppError(409,'Research writes are frozen during evaluation.');
      if (graphChanged && !['ready',...ACTIVE_OUTCOMES].includes(oldOutcome) && !(oldOutcome==='budget_storage'&&eventType==='capture')) throw new AppError(409,'A terminal run is immutable.');
      if (graphChanged) state.run.revision++;
      state.run.sequence++; this.recount(state); state.traces=state.traces.slice(-1000);
      event={type:eventType,sequence:state.run.sequence,revision:state.run.revision,data:state};
      this.save(state); this.db.prepare('INSERT INTO events(run_id,sequence,event) VALUES(?,?,?)').run(id,state.run.sequence,JSON.stringify({type:eventType,sequence:state.run.sequence,revision:state.run.revision,data:{checkpointRequired:true}}));
      return state;
    });
    if(event) this.publish(id,event);
    return result;
  }
  claimExecution(id:string):number {
    let fence=0;
    this.transaction(()=>{
      const state=this.getState(id);
      if(state.run.outcome!=='ready') throw new AppError(409,'This run already started. Inspect its checkpoint or create a child.');
      state.run.fence++; fence=state.run.fence; state.run.outcome='running';state.run.startedAt=now();this.save(state);
    });
    this.checkpoint(id); return fence;
  }
  requestStop(id:string) {
    const state=this.getState(id);
    if(state.run.outcome==='ready') return this.finish(id,state.run.fence,'stopped_by_user');
    if(!ACTIVE_OUTCOMES.includes(state.run.outcome)) return;
    this.mutate(id,state.run.fence,s=>{s.run.stopRequested=true;s.run.outcome='stopping';},'stopping');
    this.checkpoint(id);
  }
  checkpoint(id:string) {
    const state=this.getState(id); const generation=state.run.generation+1;
    state.run.generation=generation;state.run.checkpointAt=now();
    const dir=join(this.root,'runs',id,'generations',String(generation));mkdirSync(dir,{recursive:true,mode:0o700});
    const json=JSON.stringify(state); durableWrite(join(dir,'state.json'),json);
    const manifest={formatVersion:1,generation,revision:state.run.revision,sequence:state.run.sequence,checksum:hash(json),createdAt:state.run.checkpointAt,schemaHash:state.schema.hash,parentId:state.run.parentId,parentGeneration:state.run.parentGeneration};
    durableWrite(join(dir,'manifest.json'),JSON.stringify(manifest));
    syncDirectory(dir);syncDirectory(join(this.root,'runs',id,'generations'));
    const root=join(this.root,'runs',id);const temp=join(root,`current-${randomUUID()}.tmp`);
    durableWrite(temp,JSON.stringify(manifest));renameSync(temp,join(root,'current.json'));
    const fd=openSync(root,'r');try{fsyncSync(fd);}finally{closeSync(fd);}
    this.save(state);
  }
  readCheckpoint(id:string):RunState {
    this.getState(id); // catalogue membership; paths never come from callers
    const root=join(this.root,'runs',id);const manifest=JSON.parse(readFileSync(join(root,'current.json'),'utf8'));
    if(manifest.formatVersion!==1||!Number.isSafeInteger(manifest.generation)||manifest.generation<1) throw new AppError(500,'Unsupported checkpoint format.');
    const json=readFileSync(join(root,'generations',String(manifest.generation),'state.json'),'utf8');
    if(hash(json)!==manifest.checksum) throw new AppError(500,'Checkpoint checksum mismatch.');
    const snapshot=JSON.parse(json) as RunState;
    if(snapshot.run.id!==id || snapshot.run.generation!==manifest.generation || snapshot.run.revision!==manifest.revision || snapshot.run.sequence!==manifest.sequence || snapshot.schema.hash!==manifest.schemaHash) throw new AppError(500,'Checkpoint manifest does not match its typed state.');
    return snapshot;
  }
  capture(id:string,fence:number,invocation:Invocation,chunks:GraphNode[],raw:unknown):void {
    const state=this.getState(id);
    if(state.run.fence!==fence) throw new AppError(409,'Stale capture execution fence.');
    const recorded=this.db.prepare('SELECT descriptor FROM captures WHERE id=?').get(invocation.id) as {descriptor:string}|undefined;
    if(recorded){const saved=JSON.parse(recorded.descriptor);if(saved.invocation.runId!==id)throw new AppError(409,'Invocation belongs to another run.');if(!state.invocations.some(i=>i.id===invocation.id&&i.rawHash))this.mutate(id,fence,s=>this.registerCapture(s,saved.invocation,saved.chunks,saved.storageBytes),'capture');return;}
    const pendingBeforeCap=state.run.outcome==='budget_storage'&&state.invocations.some(i=>i.id===invocation.id&&i.status==='pending');
    if(!['running','stopping','finalizing'].includes(state.run.outcome)&&!pendingBeforeCap) throw new AppError(409,'Source capture requires an active execution.');
    if(!/^[a-zA-Z0-9-]+$/.test(invocation.id)) throw new AppError(400,'Invalid invocation identity.');
    if(invocation.runId!==id || new Set(invocation.chunkIds).size!==invocation.chunkIds.length || chunks.length !== invocation.chunkIds.length || chunks.some(c=>!invocation.chunkIds.includes(c.id) || c.category!=='source_chunk' || c.runId!==id || c.tenantId!==state.run.tenantId || c.source?.invocationId!==invocation.id)) throw new AppError(400,'Capture inventory mismatch.');
    for(const chunk of chunks){const errors=validateNode(chunk,state.schema,[...state.nodes,...chunks]);if(errors.length)throw new AppError(400,errors.join(' '));}
    const dir=join(this.root,'runs',id,'captures',invocation.id);mkdirSync(dir,{recursive:true,mode:0o700});
    const rawJson=JSON.stringify(raw);durableWrite(join(dir,'raw.json'),rawJson);
    const completed={...invocation,rawPath:join(dir,'raw.json'),rawHash:hash(rawJson)};
    const storageBytes=Buffer.byteLength(rawJson)+Buffer.byteLength(JSON.stringify({invocation:completed,chunks}));
    const descriptor={invocation:completed,chunks,storageBytes};
    const descriptorTemp=join(dir,`descriptor-${randomUUID()}.tmp`);durableWrite(descriptorTemp,JSON.stringify(descriptor));renameSync(descriptorTemp,join(dir,'descriptor.json'));
    syncDirectory(dir);syncDirectory(join(this.root,'runs',id,'captures'));
    this.db.prepare('INSERT INTO captures(id,run_id,descriptor) VALUES(?,?,?)').run(invocation.id,id,JSON.stringify(descriptor));
    this.mutate(id,fence,s=>this.registerCapture(s,completed,chunks,storageBytes),'capture');
    if(this.getRun(id).outcome==='budget_storage')this.checkpoint(id);
  }
  private registerCapture(s:RunState,invocation:Invocation,chunks:GraphNode[],storageBytes=0) {
    const i=s.invocations.findIndex(q=>q.id===invocation.id);
    const alreadyCaptured=i>=0&&Boolean(s.invocations[i].rawHash);
    if(!alreadyCaptured){if(i>=0)s.invocations[i]=invocation;else s.invocations.push(invocation);s.run.usage.bytes+=storageBytes;}
    for(const chunk of chunks) if(!s.nodes.some(n=>n.id===chunk.id)) s.nodes.push(chunk);
    const task=s.tasks.find(t=>t.id===invocation.taskId);
    for(const chunk of chunks) for(const target of task?.targetIds||[]) if(s.nodes.some(n=>n.id===target)) {
      const edgeId=hash(['retrieved_for',chunk.id,target,invocation.id]);
      if(!s.edges.some(e=>e.id===edgeId)) s.edges.push({id:edgeId,source:chunk.id,target,relation:'retrieved_for',kind:'context',weight:.2,polarity:'qualifies',evidence:[],rationale:`Returned by query: ${invocation.query}`,derivation:'capture-1',version:1,access:{...chunk.access,connectorIds:[...new Set([...chunk.access.connectorIds,...s.nodes.find(n=>n.id===target)!.access.connectorIds])]}});
    }
    if(!alreadyCaptured && (s.run.usage.bytes>s.run.config.budget.maxBytes||s.nodes.filter(n=>n.category==='source_chunk').length>s.run.config.budget.maxChunks)) {
      s.run.outcome='budget_storage';s.run.error='Captured source material reached the storage cap. The complete received response is retained; no further research is dispatched.';s.run.finishedAt=now();
    }
  }
  finish(id:string,fence:number,outcome:Outcome) {
    this.mutate(id,fence,s=>{s.run.outcome=outcome;s.run.finishedAt=now();s.run.fence++;for(const a of s.agents){a.status='done';a.taskId=null;}},'terminal');
    this.checkpoint(id);
    const state=this.getState(id);this.publish(id,{type:'saved',sequence:state.run.sequence,revision:state.run.revision,data:state});
  }
  subscribe(id:string,listener:(event:StreamEvent)=>void):()=>void {
    let set=this.listeners.get(id);if(!set){set=new Set();this.listeners.set(id,set);}set.add(listener);
    return ()=>{set!.delete(listener);if(!set!.size)this.listeners.delete(id);};
  }
  private publish(id:string,event:StreamEvent) {for(const listener of this.listeners.get(id)||[]) { try{listener(event);}catch{/* consumer disconnected */} } }
  private recover() {
    for(const run of this.list()) {
      let s=this.getState(run.id);
      const before=JSON.stringify(s),beforeGraph=graphHash(s);
      const pointer=join(this.root,'runs',run.id,'current.json');
      if(existsSync(pointer)) {
        const saved=this.readCheckpoint(run.id);
        if(saved.run.generation>s.run.generation){s=saved;this.save(s);}
      } else { this.checkpoint(run.id); s=this.getState(run.id); }
      // Filesystem descriptors are authoritative even if a crash preceded the journal index write.
      const captureDir=join(this.root,'runs',run.id,'captures');
      if(existsSync(captureDir)) for(const entry of readdirSync(captureDir,{withFileTypes:true})) {
        const descriptorPath=join(captureDir,entry.name,'descriptor.json');
        if(entry.isDirectory() && existsSync(descriptorPath)) {
          const descriptor=readFileSync(descriptorPath,'utf8');const d=JSON.parse(descriptor);
          const raw=readFileSync(join(captureDir,entry.name,'raw.json'),'utf8');
          if(hash(raw)!==d.invocation.rawHash)throw new AppError(500,'Captured source checksum mismatch.');
          this.db.prepare('INSERT OR IGNORE INTO captures(id,run_id,descriptor) VALUES(?,?,?)').run(d.invocation.id,run.id,descriptor);
        }
      }
      for(const row of this.db.prepare('SELECT descriptor FROM captures WHERE run_id=?').all(run.id) as {descriptor:string}[]) {
        const d=JSON.parse(row.descriptor);
        const missing=!s.invocations.some(i=>i.id===d.invocation.id&&i.rawHash)||d.chunks.some((chunk:GraphNode)=>!s.nodes.some(n=>n.id===chunk.id));
        if(missing) {
          for(const chunk of d.chunks){const errors=validateNode(chunk,s.schema,[...s.nodes,...d.chunks]);if(errors.length)throw new AppError(500,`Invalid durable capture: ${errors.join(' ')}`);}
          this.registerCapture(s,d.invocation,d.chunks,d.storageBytes);
        }
      }
      const interruptedStorageStop=s.run.outcome==='budget_storage'&&(s.invocations.some(i=>i.status==='pending')||s.agents.some(a=>['working','evaluating'].includes(a.status)));
      if(ACTIVE_OUTCOMES.includes(s.run.outcome)||interruptedStorageStop) {
        s.run.fence++;if(!interruptedStorageStop){s.run.outcome='failed';s.run.error='Execution was interrupted. Continue from the saved checkpoint in a child run.';}s.run.finishedAt=now();
        for(const invocation of s.invocations) if(invocation.status==='pending') invocation.status='response_unavailable';
        for(const a of s.agents){a.status='done';a.taskId=null;}
      }
      this.recount(s);
      if(JSON.stringify(s)!==before) {
        if(graphHash(s)!==beforeGraph)s.run.revision++;
        s.run.sequence++;
        this.transaction(()=>{this.save(s);this.db.prepare('INSERT OR REPLACE INTO events(run_id,sequence,event) VALUES(?,?,?)').run(run.id,s.run.sequence,JSON.stringify({type:'recovered',sequence:s.run.sequence,revision:s.run.revision,data:{checkpointRequired:true}}));});
        this.checkpoint(run.id);
      }
    }
  }
}
