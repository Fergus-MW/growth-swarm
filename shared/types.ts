export type Category = 'primary_entity' | 'note' | 'source_chunk';
export type Confidence = 'high' | 'medium' | 'low';
export type Provenance = 'research' | 'inference' | 'brief' | 'meta' | 'transcript' | 'transcript_plus_research';
export type Outcome = 'ready' | 'running' | 'evaluating' | 'stopping' | 'finalizing' | 'consensus' | 'stopped_by_user' | 'disconnected' | 'failed' | 'stalled' | 'budget_wall_clock' | 'budget_tokens' | 'budget_cost' | 'budget_connector' | 'budget_storage' | 'persistence_unavailable' | 'criteria_unmet';
export const ACTIVE_OUTCOMES: Outcome[] = ['running','evaluating','stopping','finalizing'];
export const EDITORIAL_TYPES = ['session','person','organisation','position','practice','framework','evidence','question','meta'] as const;
export interface AccessScope { tenantId: string; userIds?: string[]; connectorIds: string[]; }
export interface EvidenceRef { chunkId: string; start: number; end: number; quote: string; polarity: 'supports' | 'contradicts' | 'qualifies'; }
export interface ProseRevision { id: string; body: string; authorId: string; createdAt: string; evidence: EvidenceRef[]; }
export interface GraphNode {
  id: string; category: Category; title: string; tenantId: string; runId: string; originRunId: string;
  createdAt: string; updatedAt: string; version: number; access: AccessScope;
  entityType?: string; fields?: Record<string, unknown>; fieldEvidence?: Record<string, EvidenceRef[]>;
  identityKey?: string; status?: 'candidate' | 'qualified' | 'excluded' | 'unresolved'; exclusionReason?: string;
  body: string; freeText?: ProseRevision[]; editorialType?: typeof EDITORIAL_TYPES[number]; semanticKind?: string;
  aliases: string[]; tags: string[]; confidence?: Confidence; provenance?: Provenance; evidence: EvidenceRef[];
  assessmentVersion?: string; historical?: boolean;
  source?: {
    connectorId: string; provider: string; invocationId: string; locator: string | null;
    sourceIdentity: string; origin: string; contentHash: string; mimeType: string;
    format: 'snippet' | 'text' | 'record' | 'binary'; publishedAt: string | null; eventAt: string | null; fetchedAt: string;
    offsets: { start: number; end: number }; rawPath?: string; extractionStatus?: string; platformChunkId?: string;
  };
}
export interface GraphEdge {
  id: string; source: string; target: string; relation: string; kind: 'context' | 'evidence' | 'semantic' | 'inference' | 'navigation';
  weight: number; polarity: 'supports' | 'contradicts' | 'qualifies'; evidence: EvidenceRef[]; rationale?: string;
  assertionId?: string; revisionId?: string; assessmentVersion?: string; historical?: boolean;
  validAt?: string | null; validUntil?: string | null; current?: boolean; derivation: string; version: number; access: AccessScope;
}
export interface Assertion {
  id: string; ownerId: string; revisionId: string; fieldKey?: string; claim: string; value?: unknown;
  evidence: EvidenceRef[]; confidence: Confidence; provenance: Provenance; assessmentVersion: string; historical?: boolean;
}
export interface Connector {
  id: string; name: string; provider: string; account: string; mode: 'live' | 'ingested' | 'fixture';
  capabilities: string[]; available: boolean; reason?: string; freshness: string; scope: string;
  estimatedCost: string; costPerCall: number; quotaKey: string; version: string; private: boolean;
}
export interface SchemaField {
  id: string; key: string; type: 'string' | 'text' | 'url' | 'email' | 'phone' | 'number' | 'boolean' | 'date' | 'datetime' | 'string_list' | 'string_map' | 'record_list' | 'money_series' | 'dated_series';
  required?: boolean; unique?: boolean; allowedValues?: string[]; recordKeys?: string[];
}
export interface EntityDefinition { id: string; name: string; fields: SchemaField[]; matchMode: 'identifier' | 'name' | 'hybrid' | 'embedding'; }
export interface SchemaSnapshot { version: string; hash: string; translatorVersion: string; definitions: EntityDefinition[]; }
export interface CompletionCriteria {
  text: string; minCompanies: number; signalPercent: number; requireContacts: boolean; independentSources: number; saturationAttempts: number;
}
export interface RunConfig {
  profile: 'gtm' | 'blank'; objective: string; universe: string; exclusions: string; criteria: CompletionCriteria;
  swarmSize: number; threshold: number; connectorIds: string[]; agentConnectorIds?: Record<string, string[]>;
  budget: { money: number; wallClockMinutes: number; maxCalls: number; maxBytes: number; maxChunks: number; maxInputTokens: number; maxOutputTokens: number; connectorCaps: Record<string, number>; };
  signalWindowMonths: number; mode: 'demo' | 'live'; model: string; reuseParentSources: boolean;
}
export interface Usage { spent: number; reserved: number; calls: number; inputTokens: number; outputTokens: number; reservedInputTokens?: number; reservedOutputTokens?: number; bytes: number; connectorCalls: Record<string, number>; }
export interface Run {
  id: string; tenantId: string; userId: string; title: string; config: RunConfig; outcome: Outcome;
  createdAt: string; startedAt: string | null; finishedAt: string | null; checkpointAt: string | null;
  generation: number; revision: number; sequence: number; fence: number; stopRequested: boolean;
  parentId: string | null; parentGeneration: number | null; lineage: string[]; assessmentVersion: string;
  usage: Usage; error: string | null; counts: Record<Category, number>; quality: QualityReport | null;
  modelEndpoint: string; costPolicyVersion: string;
}
export type TaskKind = 'discovery' | 'qualification' | 'signals' | 'contacts' | 'integrity';
export interface Task {
  id: string; kind: TaskKind; payload: Record<string, unknown>; targetIds: string[]; priority: number;
  status: 'open' | 'claimed' | 'done' | 'failed'; attempts: number; owner: string | null;
  leaseExpiresAt: string | null; claimToken: string | null; dedupeKey: string; assessmentVersion: string;
  createdAt: string; reservedFor?: string; calls: number; error?: string;
}
export interface Agent { id: string; name: string; status: 'idle' | 'working' | 'evaluating' | 'waiting' | 'done' | 'error'; taskId: string | null; completedTasks: number; summary: string; nodeId?: string; }
export interface Invocation {
  id: string; runId: string; agentId: string; taskId: string; connectorId: string; provider: string; operation: string;
  query: string; queryHash: string; status: 'pending' | 'succeeded' | 'empty' | 'partial' | 'failed' | 'cancelled' | 'response_unavailable';
  startedAt: string; finishedAt: string | null; chunkIds: string[]; returnedCount: number; cost: number | null;
  reservedCost: number; rawPath?: string; rawHash?: string; error?: string; parentInvocationId?: string; truncated: boolean;
}
export interface Vote { agentId: string; epoch: string; revision: number; criteriaHash: string; yes: boolean; rationale: string; createdAt: string; gapTaskId?: string; }
export interface Trace { id: string; timestamp: string; agentId: string; taskId?: string; status: string; summary: string; connectorId?: string; nodeId?: string; }
export interface QualityGate { id: string; label: string; pass: boolean; actual: string | number; required: string | number; details: string[]; }
export interface QualityReport { passed: boolean; gates: QualityGate[]; qualifiedCompanies: number; signalCompanies: number; contactCompanies: number; gaps: string[]; checkedRevision: number; }
export interface RunState {
  run: Run; schema: SchemaSnapshot; nodes: GraphNode[]; edges: GraphEdge[]; assertions: Assertion[];
  tasks: Task[]; agents: Agent[]; invocations: Invocation[]; votes: Vote[]; traces: Trace[];
  discovery: { segments: string[]; coveredSegments: string[]; recentEligibleCounts: number[]; };
}
export interface StreamEvent { type: string; sequence: number; revision: number; data: unknown; }
export interface Bootstrap { connectors: Connector[]; schema: SchemaSnapshot; model: string; mode: 'demo' | 'live'; defaults: RunConfig; }
