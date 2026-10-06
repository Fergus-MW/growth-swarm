import { createHash } from 'node:crypto';
import { defaultConfig, DEFAULT_SCHEMA } from '../server/config.ts';
import type { EvidenceRef, GraphEdge, GraphNode, RunState } from '../shared/types.ts';

export const createdAt = new Date().toISOString();
export function node(id: string, extra: Partial<GraphNode> = {}): GraphNode {
  return { id, title: id, category: 'note', tenantId: 'local', runId: 'run', originRunId: 'run', createdAt, updatedAt: createdAt, version: 1, access: { tenantId: 'local', connectorIds: ['fixture-web'] }, body: '', aliases: [], tags: [], editorialType: 'evidence', provenance: 'brief', evidence: [], ...extra };
}
export function source(id = 'source', body = 'Acme reconciles invoices manually.', origin = 'acme.example'): GraphNode {
  return node(id, { category: 'source_chunk', body, source: { connectorId: 'fixture-web', provider: 'fixture', invocationId: `inv-${id}`, locator: `https://${origin}/research`, sourceIdentity: `${origin}/${id}`, origin, contentHash: createHash('sha256').update(body).digest('hex'), mimeType: 'text/plain', format: 'text', publishedAt: createdAt, eventAt: null, fetchedAt: createdAt, offsets: { start: 0, end: body.length } } });
}
export function evidence(chunk: GraphNode): EvidenceRef { return { chunkId: chunk.id, start: 0, end: chunk.body.length, quote: chunk.body, polarity: 'supports' }; }
export function edge(sourceId: string, target: string, relation: string, refs: EvidenceRef[] = [], extra: Partial<GraphEdge> = {}): GraphEdge {
  return { id: `${sourceId}-${relation}-${target}`, source: sourceId, target, relation, kind: 'semantic', weight: 1, polarity: 'supports', evidence: refs, rationale: 'Evidence-based assessment', assessmentVersion: 'assessment', current: true, derivation: 'validated-writer-1', version: 1, access: { tenantId: 'local', connectorIds: ['fixture-web'] }, ...extra };
}
export function state(nodes: GraphNode[] = [], edges: GraphEdge[] = []): RunState {
  const config = defaultConfig(); config.criteria = { ...config.criteria, minCompanies: 1, saturationAttempts: 0 };
  return { run: { id: 'run', tenantId: 'local', userId: 'local', title: 'Test research', config, outcome: 'criteria_unmet', createdAt, startedAt: createdAt, finishedAt: createdAt, checkpointAt: createdAt, generation: 1, revision: 1, sequence: 1, fence: 1, stopRequested: false, parentId: null, parentGeneration: null, lineage: [], assessmentVersion: 'assessment', usage: { spent: 0, reserved: 0, calls: 0, inputTokens: 0, outputTokens: 0, bytes: 0, connectorCalls: {} }, error: null, counts: { primary_entity: nodes.filter(n => n.category === 'primary_entity').length, note: nodes.filter(n => n.category === 'note').length, source_chunk: nodes.filter(n => n.category === 'source_chunk').length }, quality: null, modelEndpoint: 'fixture://deterministic', costPolicyVersion: 'test' }, schema: DEFAULT_SCHEMA, nodes, edges, assertions: [], tasks: [], agents: [], invocations: nodes.filter(n => n.category === 'source_chunk').map(n => ({ id: n.source!.invocationId, runId: 'run', agentId: 'agent-1', taskId: 'task', connectorId: 'fixture-web', provider: 'fixture', operation: 'search', query: 'test', queryHash: 'test', status: 'succeeded', startedAt: createdAt, finishedAt: createdAt, chunkIds: [n.id], returnedCount: 1, cost: 0, reservedCost: 0, truncated: false })), votes: [], traces: [], discovery: { segments: ['test'], coveredSegments: ['test'], recentEligibleCounts: [] } };
}
export function qualifiedState(): RunState {
  const a = source('a', `Acme reconciles invoices manually. Reported ${createdAt.slice(0,10)}.`), b = source('b', 'Acme completed an acquisition.', 'independent.example');
  const refs = [evidence(a), evidence(b)];
  const pain = node('pain', { semanticKind: 'pain', editorialType: 'practice' });
  const company = node('company', { category: 'primary_entity', entityType: 'company', editorialType: 'organisation', fields: { name: 'Acme', domain: 'acme.example' }, fieldEvidence: { name: refs, domain: refs }, status: 'qualified', evidence: refs });
  return state([a, b, pain, company], [edge('company', 'pain', 'holds_pain', refs)]);
}
