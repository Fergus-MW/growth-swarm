import { randomUUID } from 'node:crypto';
import type { Agent, EvidenceRef, GraphEdge, GraphNode, Invocation, Outcome, RunState, Task, TaskKind } from '../shared/types.js';
import { CapturedResponseError, FIXTURE_COMPANIES, getConnectors, hash, PartialResponseError, searchConnector, type SourceItem } from './connectors.js';
import { evaluate, research, type EdgeDraft, type NodeDraft, type ResearchDraft } from './model.js';
import { evaluateQuality, validateEdge, validateNode } from './validation.js';
import { requiredAgreement } from '../shared/consensus.js';

export interface EngineStore {
  getState(id: string): RunState;
  mutate(id: string, fence: number, mutation: (state: RunState) => void, eventType?: string): RunState;
  capture(id: string, fence: number, invocation: Invocation, chunks: GraphNode[], raw: unknown): void;
  checkpoint(id: string): void;
  finish(id: string, fence: number, outcome: Outcome): void;
}
const now = () => new Date().toISOString();
const id = () => randomUUID();
const QUEUES: TaskKind[] = ['discovery','qualification','signals','contacts','integrity'];
const WEIGHTS = { discovery: .2, qualification: .25, signals: .25, contacts: .2, integrity: .1 };
export class LimitError extends Error { constructor(public outcome: Outcome, message: string) { super(message); } }

function trace(s: RunState, agentId: string, status: string, summary: string, taskId?: string, nodeId?: string) {
  s.traces.push({ id: id(), timestamp: now(), agentId, status, summary: summary.slice(0, 700), taskId, nodeId });
}
function addTask(s: RunState, kind: TaskKind, payload: Record<string, unknown>, targetIds: string[] = [], reservedFor?: string): Task {
  const dedupeKey = hash(JSON.stringify({ kind, payload, targetIds: [...targetIds].sort(), assessment: s.run.assessmentVersion, connectors: [...s.run.config.connectorIds].sort(), window: s.run.config.signalWindowMonths }));
  const existing = s.tasks.find(t => t.dedupeKey === dedupeKey);
  if (existing) return existing;
  const task: Task = { id: id(), kind, payload, targetIds, priority: 1, status: 'open', attempts: 0, owner: null, leaseExpiresAt: null, claimToken: null, dedupeKey, assessmentVersion: s.run.assessmentVersion, createdAt: now(), reservedFor, calls: 0 };
  s.tasks.push(task); return task;
}

/** Must execute inside store.mutate: selection and claim are one short synchronous transaction. */
export function claimTask(s: RunState, agentId: string): Task | undefined {
  if (s.run.outcome !== 'running' || s.run.stopRequested) return;
  const available = s.tasks.filter(t => (t.status === 'open' || (t.status === 'claimed' && Date.parse(t.leaseExpiresAt ?? '') <= Date.now())) && t.attempts < 3 && (!t.reservedFor || t.reservedFor === agentId));
  if (!available.length) return;
  const active = s.tasks.filter(t => t.status === 'claimed' && Date.parse(t.leaseExpiresAt ?? '') > Date.now());
  const score = (task: Task) => {
    const queueActive = active.filter(t => t.kind === task.kind).length;
    const age = (Date.now() - Date.parse(task.createdAt)) / 60000;
    return (task.reservedFor === agentId ? 1000 : 0) + (WEIGHTS[task.kind] * s.run.config.swarmSize - queueActive) * 10 + age + task.priority;
  };
  available.sort((a,b) => score(b) - score(a) || Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const task = available[0];
  task.payload.expectedVersions=Object.fromEntries(task.targetIds.map(target=>[target,s.nodes.find(n=>n.id===target)?.version]));
  task.owner = agentId; task.claimToken = id(); task.status = 'claimed'; task.attempts++;
  task.leaseExpiresAt = new Date(Date.now() + 300_000).toISOString();
  const agent = s.agents.find(a => a.id === agentId);
  if (agent) { agent.status = 'working'; agent.taskId = task.id; agent.summary = `${task.kind}: ${String(task.payload.target ?? task.payload.segment ?? 'research gap')}`; }
  trace(s, agentId, 'working', agent?.summary ?? task.kind, task.id);
  return structuredClone(task);
}
function assertClaim(s: RunState, task: Task) {
  const current = s.tasks.find(t => t.id === task.id);
  if (s.run.outcome !== 'running' || s.run.stopRequested || !current || current.status !== 'claimed' || current.owner !== task.owner || current.claimToken !== task.claimToken || Date.parse(current.leaseExpiresAt ?? '') <= Date.now()) throw new Error('Stale task claim: result was fenced out');
  return current;
}
const access = (s: RunState, refs: EvidenceRef[]) => ({ tenantId: s.run.tenantId, connectorIds: [...new Set(refs.flatMap(r => s.nodes.find(n => n.id === r.chunkId)?.access.connectorIds ?? []))] });
function baseNode(s: RunState, title: string, category: GraphNode['category']): GraphNode {
  return { id: id(), category, title, tenantId: s.run.tenantId, runId: s.run.id, originRunId: s.run.id, createdAt: now(), updatedAt: now(), version: 1, access: { tenantId: s.run.tenantId, connectorIds: [] }, body: '', aliases: [], tags: [], evidence: [] };
}
function identity(d: NodeDraft): string | undefined {
  if (d.entityType === 'company' && typeof d.fields?.domain === 'string') {
    try { return `company:${new URL(d.fields.domain.includes('://') ? d.fields.domain : `https://${d.fields.domain}`).hostname.toLowerCase().replace(/^www\./, '')}`; } catch { return; }
  }
  if (d.entityType === 'person' && d.fields?.companyId && d.fields?.name) return `person:${String(d.fields.companyId)}:${String(d.fields.name).normalize('NFKC').toLowerCase().trim()}`;
  if (d.category === 'note') return `note:${d.semanticKind ?? 'claim'}:${hash(d.title.toLowerCase())}`;
}

/** Validated graph writes, follow-ups, task completion and trace are committed atomically. */
export function commitDraft(s: RunState, task: Task, draft: ResearchDraft): number {
  const current = assertClaim(s, task);
  if (!draft || !Array.isArray(draft.nodes) || !Array.isArray(draft.edges) || draft.nodes.length > 30 || draft.edges.length > 80 || typeof draft.summary !== 'string') throw new Error('Invalid or unbounded structured research output');
  const mapping = new Map<string,string>();
  let discoveries = 0, useful = 0;
  const authored: GraphNode[] = [];
  for (const d of draft.nodes) {
    if (!['primary_entity','note'].includes(d.category) || !Array.isArray(d.evidence) || !d.evidence.length) throw new Error('Model may only author grounded entities or notes with evidence');
    const rawKey = identity(d), key=d.category==='note'&&rawKey?`${rawKey}:${s.run.assessmentVersion}`:rawKey;
    const existing = d.id ? s.nodes.find(n => n.id === d.id) : key ? s.nodes.find(n => n.identityKey === key) : undefined;
    if (d.id && !existing) throw new Error('Unknown node update target');
    if (existing?.category === 'source_chunk') throw new Error('Source chunks are immutable');
    if (existing && (existing.category !== d.category || existing.entityType !== d.entityType)) throw new Error('An authored revision cannot change the node category or entity type');
    const fields = d.fields ? { ...existing?.fields, ...d.fields } : existing?.fields;
    const fieldEvidence = d.fieldEvidence ? { ...existing?.fieldEvidence, ...d.fieldEvidence } : existing?.fieldEvidence;
    const resolvedIdentity = identity({ ...d, fields });
    if (existing?.category === 'primary_entity' && existing.identityKey && resolvedIdentity && existing.identityKey !== resolvedIdentity) throw new Error('An authored revision cannot change the primary identity');
    // A changed factual value needs new support; evidence for the prior selected
    // value must never silently become evidence for its replacement.
    if (existing && d.fields) for (const [field, value] of Object.entries(d.fields)) {
      if (JSON.stringify(value) !== JSON.stringify(existing.fields?.[field]) && !d.fieldEvidence?.[field]?.length) throw new Error(`Changed field ${field} requires fresh evidence`);
    }
    // An agent may revise only its target. Discovery races bind identity without overwriting prose.
    if (existing && !task.targetIds.includes(existing.id) && !(existing.historical && task.targetIds.includes(String(existing.fields?.companyId)))) { mapping.set(d.key, existing.id); continue; }
    const priorVersion = Number((task.payload.expectedVersions as Record<string,number>|undefined)?.[existing?.id??''] ?? task.payload.expectedVersion ?? existing?.version);
    if (existing && Number.isFinite(priorVersion) && existing.version !== priorVersion) throw new Error('Stale prose revision; retry against current graph');
    const n: GraphNode = { ...(existing ?? baseNode(s,d.title,d.category)), title: d.title, category: d.category, entityType: d.entityType, fields, fieldEvidence, identityKey: key ?? existing?.identityKey, body: d.body, semanticKind: d.semanticKind, status: d.status ?? existing?.status, evidence: d.evidence, confidence: d.confidence, provenance: d.provenance, exclusionReason: d.exclusionReason, editorialType: d.entityType === 'company' ? 'organisation' : d.entityType === 'person' ? 'person' : d.semanticKind === 'demand_signal' ? 'evidence' : 'position', assessmentVersion: s.run.assessmentVersion, version: (existing?.version ?? 0) + 1, updatedAt: now() };
    // Model output cannot relabel arbitrary findings as instructions supplied by the user.
    if (d.provenance === 'brief') throw new Error('Only the coordinator may create brief-provenance nodes');
    const refs = [...n.evidence, ...Object.values(n.fieldEvidence ?? {}).flat()];
    n.access = access(s, refs); n.historical=false;
    if (n.category === 'primary_entity') n.freeText = [...(existing?.freeText ?? []), { id: id(), body: n.body, authorId: task.owner!, createdAt: now(), evidence: n.evidence }];
    const errors = validateNode(n,s.schema,[...s.nodes,n]); if (errors.length) throw new Error(errors.slice(0,4).join(' '));
    mapping.set(d.key,n.id); if (d.id) mapping.set(d.id,n.id);
    if (existing) s.nodes[s.nodes.findIndex(x => x.id === existing.id)] = n; else { s.nodes.push(n); if (n.entityType === 'company') discoveries++; }
    authored.push(n); useful++;
    const revisionId = n.freeText?.at(-1)?.id ?? `${n.id}:${n.version}`;
    s.assertions.push({ id: id(), ownerId: n.id, revisionId, claim: n.body, evidence: n.evidence, confidence: n.confidence ?? 'low', provenance: n.provenance!, assessmentVersion: s.run.assessmentVersion });
    for (const [fieldKey,value] of Object.entries(n.fields ?? {})) s.assertions.push({ id: id(), ownerId: n.id, revisionId, fieldKey, claim: `${fieldKey}: ${String(value)}`, value, evidence: n.fieldEvidence?.[fieldKey] ?? [], confidence: n.confidence ?? 'low', provenance: 'research', assessmentVersion: s.run.assessmentVersion });
  }
  const appendEdge = (e: GraphEdge) => { const errors = validateEdge(e,s.nodes); if (errors.length) throw new Error(errors.slice(0,3).join(' ')); if (!s.edges.some(x => x.id === e.id)) s.edges.push(e); };
  for (const n of authored) {
    const revisionId=n.freeText?.at(-1)?.id??`${n.id}:${n.version}`;
    for(const assertion of s.assertions.filter(a=>a.ownerId===n.id&&a.revisionId===revisionId))for(const ref of assertion.evidence){
      appendEdge({ id: hash(`evidence:${assertion.id}:${ref.chunkId}:${ref.start}:${ref.end}:${ref.polarity}`), source: ref.chunkId, target: n.id, relation: 'evidences', kind: 'evidence', weight: 1, polarity: ref.polarity, evidence: [ref], assertionId: assertion.id, revisionId: assertion.revisionId, derivation: 'validated-span-v1', version: 1, access: n.access });
    }
  }
  for (const d of draft.edges) {
    const source = mapping.get(d.source) ?? d.source, target = mapping.get(d.target) ?? d.target;
    const dependencies = [...new Set([...(s.nodes.find(n=>n.id===source)?.access.connectorIds ?? []),...(s.nodes.find(n=>n.id===target)?.access.connectorIds ?? []),...access(s,d.evidence).connectorIds])];
    const edge: GraphEdge = { id: hash(`${source}:${d.relation}:${target}:${task.id}:${d.polarity}`), source, target, relation: d.relation, kind: d.relation === 'related_to' ? 'context' : 'semantic', weight: .8, polarity: d.polarity, evidence: d.evidence, rationale: d.rationale, current: d.current ?? true, validAt: d.validAt ?? null, assessmentVersion: s.run.assessmentVersion, derivation: 'validated-assertion-v1', version: 1, access: { tenantId: s.run.tenantId, connectorIds: dependencies }, assertionId: id() };
    appendEdge(edge);
    s.assertions.push({ id: edge.assertionId!, ownerId: source, revisionId: task.id, claim: d.rationale, evidence: d.evidence, confidence: 'medium', provenance: 'inference', assessmentVersion: s.run.assessmentVersion });
  }
  for (const n of authored.filter(n => n.entityType === 'company' && n.status !== 'excluded')) {
    if (task.kind === 'discovery') addTask(s,'qualification',{ target: n.title },[n.id]);
    if (task.kind === 'qualification' && n.status === 'qualified') { addTask(s,'signals',{ target: n.title },[n.id]); addTask(s,'contacts',{ target: n.title },[n.id]); }
  }
  if (task.kind === 'discovery') {
    const segment = String(task.payload.segment);
    if (!s.discovery.coveredSegments.includes(segment)) s.discovery.coveredSegments.push(segment);
    s.discovery.recentEligibleCounts.push(discoveries);
    if (s.discovery.recentEligibleCounts.length > 1000) s.discovery.recentEligibleCounts.shift();
    const pass = Number(task.payload.pass ?? 1);
    // A fixed bounded plan, not arbitrary model-generated query rephrases.
    if (pass < Math.ceil(s.run.config.criteria.saturationAttempts / s.discovery.segments.length) + 1) addTask(s,'discovery',{ segment, pass: pass + 1 });
  }
  current.status = 'done'; current.leaseExpiresAt = null;
  const agent = s.agents.find(a => a.id === task.owner); if (agent) { agent.status = 'idle'; agent.taskId = null; agent.completedTasks++; agent.summary = draft.summary; agent.nodeId = authored[0]?.id; }
  trace(s,task.owner!,'complete',draft.summary,task.id,authored[0]?.id);
  return useful;
}

function quote(chunk: GraphNode, text?: string): EvidenceRef {
  const start = text ? chunk.body.indexOf(text) : 0;
  if (start < 0) throw new Error('Fixture evidence mismatch');
  const end = text ? start + text.length : chunk.body.length;
  return { chunkId: chunk.id, start, end, quote: chunk.body.slice(start,end), polarity: 'supports' };
}
function fixtureDraft(s: RunState, task: Task, chunks: GraphNode[]): ResearchDraft {
  const nodes: NodeDraft[] = [], edges: EdgeDraft[] = [];
  if(s.run.config.profile==='blank')return{nodes:[],edges:[],summary:'The fictional go-to-market fixture cannot establish findings for an arbitrary blank brief. Use live research for this objective.'};
  const pain = s.nodes.find(n => n.semanticKind === 'pain' && n.assessmentVersion === s.run.assessmentVersion)!;
  for (const c of FIXTURE_COMPANIES) {
    const sources = chunks.filter(n => n.source?.sourceIdentity === c.domain);
    if (!sources.length) continue;
    const refs = sources.map(n => quote(n));
    const company = s.nodes.find(n => n.entityType === 'company' && n.fields?.domain === c.domain);
    if (task.kind === 'discovery' || task.kind === 'qualification') {
      const fields = { name: c.name, domain: c.domain, sector: c.sector, country: c.country, headcount: c.headcount };
      const fieldEvidence = Object.fromEntries(Object.entries(fields).map(([key,value]) => [key,[quote(sources[0],String(value))]]));
      nodes.push({ key: c.domain, id: company?.id, category: 'primary_entity', entityType: 'company', title: c.name, fields, fieldEvidence, body: `Fictional demonstration company. ${c.pain ? 'Source records describe manual supplier-invoice reconciliation across acquired ERP systems. This supports inferred pain fit; it does not establish buying intent.' : 'The source explicitly describes automated reconciliation. Excluded from the qualified population because the example pain is not supported.'}`, evidence: refs, provenance: 'inference', confidence: 'medium', status: task.kind === 'discovery' ? 'candidate' : c.pain ? 'qualified' : 'excluded', exclusionReason: c.pain ? undefined : 'Contrary evidence: reconciliation is automated.' });
      if (task.kind === 'qualification') edges.push({ source: c.domain, target: pain.id, relation: 'holds_pain', evidence: refs, rationale: c.pain ? 'Two independent fictional source records describe the specified operational symptoms. Inference of fit, not intent.' : 'The fictional records contradict the requested pain.', polarity: c.pain ? 'supports' : 'contradicts' });
    } else if (task.kind === 'signals' && company && c.date) {
      const key = `${c.domain}:signal`; nodes.push({ key, category: 'note', title: `${c.name}: ERP integration programme`, semanticKind: 'demand_signal', body: `Fictional signal: an ERP integration programme was reported on ${c.date}. Publication and event dates are supplied by the fixture record. This is a research clue, not proof of budget.`, evidence: refs, provenance: 'inference', confidence: 'medium' });
      edges.push({ source: company.id,target:key,relation:'exhibits',evidence:refs,rationale:'Dated operational change aligns with the example pain.',polarity:'supports',validAt:c.date });
    } else if (task.kind === 'contacts' && company) {
      for (const [name,role] of [[c.ceo,'CEO'],[c.contact,c.role]]) {
        const key = `${company.id}:${name}`;
        const fields = { name, role, companyId: company.id };
        nodes.push({ key, category: 'primary_entity', entityType:'person', title:name, fields, fieldEvidence:{name:[quote(sources[0],name)],role:[quote(sources[0],role)],companyId:refs},body:`Fictional contact: ${role} at ${c.name}. ${role === 'CEO' ? 'Leadership sponsor for cross-company integration.' : 'Operational ownership makes this role relevant to invoice reconciliation.'} Contact relevance is an inference from current-role evidence; no buying intent is claimed.`,evidence:refs,provenance:'inference',confidence:'medium',status:'qualified' });
        edges.push({source:key,target:company.id,relation:'works_at',evidence:refs,rationale:'The source explicitly lists current employment.',polarity:'supports',current:true});
        edges.push({source:key,target:pain.id,relation:'best_contact_for',evidence:refs,rationale:`The ${role} has ${role === 'CEO' ? 'executive sponsorship' : 'finance process ownership'} relevant to the specified reconciliation pain.`,polarity:'supports'});
      }
    }
  }
  return { nodes, edges, summary: chunks.length ? `Fictional corpus · ${task.kind}: ${nodes.length} supported findings.` : 'Bounded fixture search returned no further records; absence is scoped to this fictional corpus.' };
}

function sourceNode(s: RunState, inv: Invocation, item: SourceItem): GraphNode {
  return { ...baseNode(s,item.title,'source_chunk'), body:item.content, access:{tenantId:s.run.tenantId,connectorIds:[inv.connectorId]}, source:{ connectorId:inv.connectorId,provider:inv.provider,invocationId:inv.id,locator:item.locator,sourceIdentity:item.sourceId,origin:item.sourceOrigin,contentHash:hash(item.content),mimeType:'text/plain',format:item.format === 'search_snippet' ? 'snippet' : 'record',publishedAt:item.publishedAt,eventAt:item.eventAt,fetchedAt:now(),offsets:{start:0,end:item.content.length},extractionStatus:'complete' }, tags:s.run.config.mode === 'demo' ? ['fictional','demo'] : [] };
}
function checkLimits(s: RunState) {
  const u=s.run.usage,b=s.run.config.budget;
  if (Date.now()-Date.parse(s.run.startedAt ?? now()) >= b.wallClockMinutes*60000) throw new LimitError('budget_wall_clock','Wall-clock limit reached');
  if (u.inputTokens >= b.maxInputTokens || u.outputTokens >= b.maxOutputTokens) throw new LimitError('budget_tokens','Model token limit reached');
  if (u.bytes >= b.maxBytes || s.nodes.filter(n=>n.category==='source_chunk').length >= b.maxChunks) throw new LimitError('budget_storage','Source storage limit reached');
  if (s.run.outcome==='budget_storage') throw new LimitError('budget_storage','Source storage cap reached after durable capture');
  if (s.run.checkpointAt && Date.now()-Date.parse(s.run.checkpointAt) > 15_000) throw new LimitError('persistence_unavailable','Checkpoint is too old for further paid dispatch');
}
function reserve(s: RunState, cost: number, provider: string, task?: Task) {
  checkLimits(s);
  if (s.run.stopRequested || !['running','evaluating'].includes(s.run.outcome)) throw new Error('Run no longer accepts calls');
  const evaluationCalls=s.run.config.mode==='live'&&s.run.outcome!=='evaluating'?s.run.config.swarmSize:0;
  if (s.run.usage.calls+1+evaluationCalls > s.run.config.budget.maxCalls) throw new LimitError('budget_connector','Outbound call limit or reserved evaluation capacity reached');
  const evaluationReserve=s.run.config.mode==='live'&&s.run.outcome!=='evaluating'?Number(process.env.OPENAI_MAX_CALL_USD)*s.run.config.swarmSize:0;
  if (s.run.usage.spent+s.run.usage.reserved+cost+evaluationReserve > s.run.config.budget.money) throw new LimitError('budget_cost','Money reservation would consume the evaluation reserve or exceed the run cap');
  if (provider !== 'openai' && (s.run.usage.connectorCalls[provider] ?? 0) >= s.run.config.budget.connectorCaps[provider]) throw new LimitError('budget_connector',`Request cap reached for ${provider}`);
  if (task) { const current=assertClaim(s,task); if(current.calls >= 40) throw new LimitError('budget_connector','Task reached its 40-call bound'); current.calls++; }
  s.run.usage.reserved+=cost; s.run.usage.calls++;
  if(provider!=='openai') s.run.usage.connectorCalls[provider]=(s.run.usage.connectorCalls[provider]??0)+1;
}
function settle(s:RunState,cost:number,inputTokens=0,outputTokens=0) {
  // Fixed conservative ceiling: no token-price guess and no assumed cancellation refunds.
  s.run.usage.reserved=Math.max(0,s.run.usage.reserved-cost); s.run.usage.spent+=cost;
  s.run.usage.inputTokens+=inputTokens;s.run.usage.outputTokens+=outputTokens;
}
function reserveTokens(s:RunState,input:number,output:number) {
  const u=s.run.usage,b=s.run.config.budget;
  if(u.inputTokens+(u.reservedInputTokens??0)+input>b.maxInputTokens||u.outputTokens+(u.reservedOutputTokens??0)+output>b.maxOutputTokens)throw new LimitError('budget_tokens','Conservative model token reservation would exceed the configured cap');
  u.reservedInputTokens=(u.reservedInputTokens??0)+input;u.reservedOutputTokens=(u.reservedOutputTokens??0)+output;
}
function settleTokens(s:RunState,input:number,output:number) {s.run.usage.reservedInputTokens=Math.max(0,(s.run.usage.reservedInputTokens??0)-input);s.run.usage.reservedOutputTokens=Math.max(0,(s.run.usage.reservedOutputTokens??0)-output);}

export async function executeRun(store:EngineStore,runId:string,fence:number,signal:AbortSignal):Promise<void> {
  const controller=new AbortController(); const combined=AbortSignal.any([signal,controller.signal]);
  let outcome:Outcome='criteria_unmet', fatal:unknown, usefulAt=Date.now(), completed=0, lastEvaluation=Date.now();
  const update=(fn:(s:RunState)=>void,type='state')=>store.mutate(runId,fence,fn,type);
  const deadline=setTimeout(()=>{fatal=new LimitError('budget_wall_clock','Wall-clock limit reached');controller.abort(fatal);},store.getState(runId).run.config.budget.wallClockMinutes*60_000);
  const heartbeat=setInterval(()=>{try{store.checkpoint(runId);}catch(e){fatal=new LimitError('persistence_unavailable','Checkpoint persistence failed; new dispatch has stopped');controller.abort(e);}},5000);
  try {
    update(s=>{
      s.run.outcome='running'; s.run.startedAt ??= now();
      s.agents=Array.from({length:s.run.config.swarmSize},(_,i):Agent=>({id:`agent-${i+1}`,name:`Agent ${String(i+1).padStart(2,'0')}`,status:'idle',taskId:null,completedTasks:0,summary:'Ready for a fair-queue task'}));
      const briefKind=s.run.config.profile==='gtm'?'pain':'topic';
      let pain=s.nodes.find(n=>n.semanticKind===briefKind&&n.assessmentVersion===s.run.assessmentVersion);
      if(!pain) {pain={...baseNode(s,s.run.config.objective,'note'),body:s.run.config.objective,editorialType:'position',semanticKind:briefKind,provenance:'brief',confidence:'high',assessmentVersion:s.run.assessmentVersion};s.nodes.push(pain);}
      s.discovery={segments:s.run.config.profile==='blank'?['Primary evidence','Mechanisms and context','Contrary evidence']:s.run.config.mode==='demo'?['Industrials','Distribution','Specialist manufacturing']:['Sector coverage','Geographic coverage','Operational symptoms'],coveredSegments:[],recentEligibleCounts:[]};
      for(const segment of s.discovery.segments)addTask(s,'discovery',{segment,pass:1});
      // Parent observations remain immutable in the parent; current objective assessments are researched again.
      for(const n of s.nodes.filter(n=>n.entityType==='company'&&n.originRunId!==s.run.id))addTask(s,'qualification',{target:n.title},[n.id]);
      trace(s,'coordinator','started',s.run.config.mode==='demo'?'Started fictional demo. No real web or model calls will be made.':'Started Tavily + OpenAI research under explicit call and cost caps.');
    });
    store.checkpoint(runId);
    const runTask=async(task:Task)=>{
      const renew=setInterval(()=>{try{update(s=>{const t=s.tasks.find(t=>t.id===task.id);if(t?.claimToken===task.claimToken&&t.status==='claimed')t.leaseExpiresAt=new Date(Date.now()+300_000).toISOString();},'lease');}catch{/* execution already fenced */}},60_000);
      let invocation:Invocation|undefined;
      try{
        combined.throwIfAborted();
        const state=store.getState(runId), allowed=state.run.config.agentConnectorIds?.[task.owner!]??state.run.config.connectorIds;
        const connector=getConnectors().find(c=>allowed.includes(c.id)&&state.run.config.connectorIds.includes(c.id)&&c.available);
        let chunks:GraphNode[]=[];
        if(connector){
          const target=String(task.payload.target??'');
          const pass=Number(task.payload.pass??1);
          const angles=state.run.config.profile==='blank'?['primary original sources','research evidence and mechanisms','conflicting findings and limitations','dated developments','source verification']:['official company evidence','operational disclosures and annual reports','relevant hiring and procurement','current leadership and process ownership','contrary evidence and resolved problems'];
          const query=task.kind==='discovery'?`${state.run.config.universe} ${state.run.config.objective} ${task.payload.segment} ${angles[(pass-1)%angles.length]} ${pass>5?`additional sources ${pass}`:''}`:`${target} ${state.run.config.objective} ${task.kind==='qualification'?'evidence and counter-evidence':task.kind==='contacts'?'current CEO founder relevant process owner budget holder team leadership':'dated announcements hiring acquisitions migrations operational changes'} primary sources`;
          invocation={id:id(),runId,agentId:task.owner!,taskId:task.id,connectorId:connector.id,provider:connector.provider,operation:'search',query,queryHash:hash(query),status:'pending',startedAt:now(),finishedAt:null,chunkIds:[],returnedCount:0,cost:null,reservedCost:connector.costPerCall,truncated:false};
          update(s=>{reserve(s,connector.costPerCall,connector.id,task);s.invocations.push(invocation!);trace(s,task.owner!,'searching',query,task.id);},'invocation');
          const response=await searchConnector(connector.id,{query,kind:task.kind,segment:task.kind==='discovery'?String(task.payload.segment):undefined,target:target||undefined,attempt:pass},combined);
          const current=store.getState(runId);chunks=response.items.map(item=>sourceNode(current,invocation!,item));
          invocation={...invocation,status:chunks.length?'succeeded':'empty',finishedAt:now(),chunkIds:chunks.map(n=>n.id),returnedCount:chunks.length,cost:connector.costPerCall};
          // The durable capture journal is written by Store before any model can see this response.
          store.capture(runId,fence,invocation,chunks,response.raw);
          update(s=>settle(s,connector.costPerCall),'usage');
          checkLimits(store.getState(runId));
        }else chunks=state.nodes.filter(n=>n.category==='source_chunk'&&state.edges.some(e=>e.source===n.id&&task.targetIds.includes(e.target))).slice(0,20);
        combined.throwIfAborted();
        let draft:ResearchDraft;
        const captured=store.getState(runId);
        if(captured.run.config.mode==='demo')draft=fixtureDraft(captured,task,chunks);
        else{
          const cost=Number(process.env.OPENAI_MAX_CALL_USD);
          let inputReserve=0,outputReserve=0;
          const result=await research(captured,task,chunks,AbortSignal.any([combined,AbortSignal.timeout(45_000)]),(input,output)=>{update(s=>{reserve(s,cost,'openai',task);reserveTokens(s,input,output);},'reservation');inputReserve=input;outputReserve=output;});
          update(s=>{settle(s,cost,result.inputTokens,result.outputTokens);settleTokens(s,inputReserve,outputReserve);},'usage');draft=result.value;
        }
        combined.throwIfAborted();
        let useful=0; update(s=>{useful=commitDraft(s,task,draft);},'graph');
        if(useful)usefulAt=Date.now();completed++;
      }catch(error){
        if(error instanceof LimitError){fatal=error;controller.abort(error);return;}
        try{
          if(error instanceof PartialResponseError&&invocation){invocation={...invocation,status:'partial',finishedAt:now(),truncated:true,error:error.message};store.capture(runId,fence,invocation,[],{partialBody:error.partial});}
          if(error instanceof CapturedResponseError&&invocation){invocation={...invocation,status:'failed',finishedAt:now(),error:error.message};store.capture(runId,fence,invocation,[],{rawBody:error.rawBody});}
          update(s=>{if(invocation){const inv=s.invocations.find(i=>i.id===invocation!.id);if(inv?.status==='pending'){inv.status=combined.aborted?'response_unavailable':'failed';inv.finishedAt=now();inv.error=error instanceof Error?error.message:'Connector failed';}}
            const t=s.tasks.find(t=>t.id===task.id);if(t?.claimToken===task.claimToken){t.status=t.attempts>=3?'failed':'open';t.owner=null;t.claimToken=null;t.leaseExpiresAt=null;t.error=error instanceof Error?error.message:'Research task failed';}
            const a=s.agents.find(a=>a.id===task.owner);if(a){a.status='error';a.summary=error instanceof Error?error.message:'Task failed';a.taskId=null;}
            trace(s,task.owner!,'error',error instanceof Error?error.message:'Task failed',task.id);
          },'task_error');
        }catch{/* lease/fence already closed; durable captures remain auditable */}
      }finally{clearInterval(renew);}
    };
    const evaluateEpoch=async():Promise<boolean>=>{
      update(s=>{s.run.outcome='evaluating';s.run.quality=evaluateQuality(s);for(const a of s.agents)a.status='evaluating';},'evaluation');
      const frozen=store.getState(runId),epoch=id(),revision=frozen.run.revision,criteriaHash=hash(JSON.stringify(frozen.run.config.criteria));
      const votes=await Promise.all(frozen.agents.map(async a=>{
        let yes=false,rationale=frozen.run.quality?.gaps[0]??'All deterministic checks pass on the fictional corpus.';
        if(frozen.run.config.mode==='demo'){
          const supportedBrief=frozen.run.config.profile==='gtm'&&/invoice/i.test(frozen.run.config.objective)&&/ERP/i.test(frozen.run.config.objective)&&/UK|United Kingdom/i.test(frozen.run.config.universe)&&/Ireland/i.test(frozen.run.config.universe);
          yes=Boolean(frozen.run.quality?.passed)&&supportedBrief;
          if(!supportedBrief)rationale='The deterministic fictional corpus cannot independently judge this changed brief. Live research is required for arbitrary objectives.';
        }
        else if(frozen.run.quality?.passed){
          const cost=Number(process.env.OPENAI_MAX_CALL_USD);
          let inputReserve=0,outputReserve=0;
          try{const result=await evaluate(frozen,a.id,AbortSignal.any([combined,AbortSignal.timeout(30_000)]),(input,output)=>{update(s=>{reserve(s,cost,'openai');reserveTokens(s,input,output);},'reservation');inputReserve=input;outputReserve=output;});update(s=>{settle(s,cost,result.inputTokens,result.outputTokens);settleTokens(s,inputReserve,outputReserve);},'usage');yes=result.value.yes===true;rationale=String(result.value.rationale).slice(0,1200);}catch(e){rationale=e instanceof Error?e.message:'Evaluator unavailable';if(e instanceof LimitError)fatal=e;}
        }
        return{agentId:a.id,epoch,revision,criteriaHash,yes,rationale,createdAt:now()};
      }));
      const required=requiredAgreement(frozen.run.config.swarmSize,frozen.run.config.threshold);
      const passed=Boolean(frozen.run.quality?.passed)&&votes.filter(v=>v.yes).length>=required;
      update(s=>{s.votes.push(...votes);s.run.outcome='running';for(const vote of votes){const a=s.agents.find(a=>a.id===vote.agentId)!;a.status='idle';a.summary=vote.rationale;if(!vote.yes){const gap=s.tasks.find(t=>t.status==='open'&&!t.reservedFor);if(gap){gap.reservedFor=a.id;Object.assign(vote,{gapTaskId:gap.id});}}}trace(s,'coordinator','vote',`${votes.filter(v=>v.yes).length}/${frozen.run.config.swarmSize} yes on revision ${revision}; ${required} required. ${passed?'Consensus reached.':'Criteria remain unmet.'}`);},'votes');
      lastEvaluation=Date.now();return passed;
    };
    while(!combined.aborted){
      const current=store.getState(runId);if(current.run.stopRequested){outcome='stopped_by_user';break;}checkLimits(current);
      const tasks:Task[]=[];
      update(s=>{for(const a of s.agents){const task=claimTask(s,a.id);if(task)tasks.push(task);}},'dispatch');
      if(!tasks.length){outcome=await evaluateEpoch()?'consensus':'criteria_unmet';break;}
      await Promise.all(tasks.map(runTask));
      if(fatal)throw fatal;
      store.checkpoint(runId);
      if(completed>=Math.max(3,current.run.config.swarmSize*3)||Date.now()-lastEvaluation>=60_000){completed=0;if(await evaluateEpoch()){outcome='consensus';break;}}
      if(Date.now()-usefulAt>300_000){outcome='stalled';break;}
    }
    if(fatal)throw fatal;
    if(combined.aborted){outcome=store.getState(runId).run.stopRequested?'stopped_by_user':'disconnected';}
  }catch(error){outcome=error instanceof LimitError?error.outcome:combined.aborted?(store.getState(runId).run.stopRequested?'stopped_by_user':'disconnected'):'failed';try{update(s=>{s.run.error=error instanceof Error?error.message:'Execution failed';trace(s,'coordinator','error',s.run.error);},'error');}catch{/* fenced */}}
  finally{
    clearTimeout(deadline);clearInterval(heartbeat);
    controller.abort();
    try{update(s=>{s.run.outcome='finalizing';s.run.quality=evaluateQuality(s);for(const a of s.agents){a.status='done';a.taskId=null;}for(const task of s.tasks.filter(t=>t.status==='claimed')){task.status='open';task.owner=null;task.claimToken=null;task.leaseExpiresAt=null;}for(const inv of s.invocations.filter(i=>i.status==='pending')){inv.status='response_unavailable';inv.finishedAt=now();}trace(s,'coordinator','finished',`Run finished: ${outcome}. Saved partial results and captured evidence remain inspectable.`);},'finalizing');store.finish(runId,fence,outcome);store.checkpoint(runId);}catch{/* preserve the last valid checkpoint when finalization fails */}
  }
}
