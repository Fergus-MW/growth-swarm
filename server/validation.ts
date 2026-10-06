import { createHash } from 'node:crypto';
import type { EvidenceRef, GraphEdge, GraphNode, QualityGate, QualityReport, RunState, SchemaField, SchemaSnapshot } from '../shared/types.js';
import { EDITORIAL_TYPES } from '../shared/types.js';

const dateOnly = (value: unknown): boolean => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const timestamp = (value: unknown): boolean => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value));
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const authored = (node: GraphNode): boolean => node.category !== 'source_chunk';
const positive = (edge: GraphEdge): boolean => edge.polarity === 'supports' && !edge.historical && edge.current !== false && (!edge.validUntil || Date.parse(edge.validUntil) > Date.now());

export function validateField(field: SchemaField, value: unknown): string[] {
  if (value === null || value === undefined) return [];
  let valid = false;
  switch (field.type) {
    case 'string': case 'text': case 'phone': valid = typeof value === 'string'; break;
    case 'url': try { const url = new URL(String(value)); valid = typeof value === 'string' && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; } catch { valid = false; } break;
    case 'email': valid = typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); break;
    case 'number': valid = typeof value === 'number' && Number.isFinite(value); break;
    case 'boolean': valid = typeof value === 'boolean'; break;
    case 'date': valid = dateOnly(value); break;
    case 'datetime': valid = timestamp(value); break;
    case 'string_list': valid = Array.isArray(value) && value.every(item => typeof item === 'string' && (!field.allowedValues || field.allowedValues.includes(item))); break;
    case 'string_map': valid = object(value) && Object.values(value).every(item => typeof item === 'string'); break;
    case 'record_list': valid = Array.isArray(value) && value.every(item => object(item) && Object.keys(item).every(key => field.recordKeys?.includes(key)) && Object.values(item).every(entry => typeof entry === 'string' || typeof entry === 'boolean' || (typeof entry === 'number' && Number.isFinite(entry)) || entry === null)); break;
    case 'money_series': valid = Array.isArray(value) && value.every(item => object(item) && typeof item.period === 'string' && typeof item.amount === 'number' && Number.isFinite(item.amount) && typeof item.currency === 'string' && /^[A-Z]{3}$/.test(item.currency) && typeof item.scale === 'number' && Number.isFinite(item.scale) && item.scale > 0); break;
    case 'dated_series': valid = Array.isArray(value) && value.every(item => object(item) && dateOnly(item.date) && ['string', 'number', 'boolean'].includes(typeof item.value) && (typeof item.value !== 'number' || Number.isFinite(item.value))) && new Set(value.map(item => item.date)).size === value.length; break;
  }
  if (valid && field.allowedValues && typeof value === 'string') valid = field.allowedValues.includes(value);
  return valid ? [] : [`Field ${field.key} must match ${field.type}${field.allowedValues ? ' and its allowed values' : ''}.`];
}

/** No fuzzy quote matching: citations always address immutable stored bytes as UTF-16 offsets. */
export function validateEvidence(ref: EvidenceRef, nodes: GraphNode[], owner?: GraphNode): string[] {
  const chunk = nodes.find(node => node.id === ref.chunkId);
  if (!chunk || chunk.category !== 'source_chunk') return [`Evidence ${ref.chunkId} does not resolve to a stored source chunk.`];
  const errors: string[] = [];
  if (!Number.isInteger(ref.start) || !Number.isInteger(ref.end) || ref.start < 0 || ref.end <= ref.start || ref.end > chunk.body.length || !ref.quote || chunk.body.slice(ref.start, ref.end) !== ref.quote) errors.push(`Evidence span in ${ref.chunkId} does not exactly match the stored passage.`);
  if (!['supports', 'contradicts', 'qualifies'].includes(ref.polarity)) errors.push(`Evidence ${ref.chunkId} has an invalid polarity.`);
  if (chunk.source?.contentHash !== createHash('sha256').update(chunk.body).digest('hex')) errors.push(`Source integrity check failed for ${ref.chunkId}.`);
  if (owner) {
    if (owner.tenantId !== chunk.tenantId || owner.runId !== chunk.runId) errors.push(`Evidence ${ref.chunkId} is outside the owner scope.`);
    if (chunk.access.connectorIds.some(id => !owner.access.connectorIds.includes(id))) errors.push(`Owner ${owner.id} is missing a source access dependency.`);
    if (chunk.access.userIds && (!owner.access.userIds || owner.access.userIds.some(id => !chunk.access.userIds!.includes(id)))) errors.push(`Owner ${owner.id} widens source user access.`);
  }
  return errors;
}

export function normalizeIdentity(field: SchemaField, value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  let normalized = value.normalize('NFKC').trim().toLowerCase();
  if (field.type === 'url' || /domain|website/.test(field.key)) {
    try {
      const url = new URL(normalized.includes('://') ? normalized : `https://${normalized}`);
      const host = url.hostname.replace(/^www\./, '').replace(/\.$/, '');
      // A profile URL identifies its path; collapsing every linkedin.com profile
      // to a hostname would silently merge unrelated people.
      normalized = /domain|website/.test(field.key) ? host : `${host}${url.pathname.replace(/\/$/, '')}${url.search}`;
    } catch { return null; }
  } else if (field.type === 'phone') normalized = normalized.replace(/[^\d+]/g, '');
  return `${field.id}:${normalized}`;
}

export function identityKeys(node: GraphNode, schema: SchemaSnapshot): string[] {
  const definition = schema.definitions.find(item => item.id === node.entityType || item.name === node.entityType);
  if (!definition || node.category !== 'primary_entity') return [];
  const keys = definition.fields.filter(field => field.unique).flatMap(field => { const key = normalizeIdentity(field, node.fields?.[field.key]); return key ? [`${definition.id}:${key}`] : []; });
  // A same-name person is never collapsed into another person without a strong key.
  if (!keys.length && definition.matchMode === 'name' && !/person|people/i.test(definition.name)) keys.push(`${definition.id}:name:${node.title.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')}`);
  return keys;
}

export function validateNode(node: GraphNode, schema: SchemaSnapshot, nodes: GraphNode[] = []): string[] {
  const errors: string[] = [];
  if (!node.id || !node.title?.trim() || !node.tenantId || !node.runId || !node.originRunId) errors.push('Nodes require stable identity, title, and tenant/run attribution.');
  if (!['primary_entity', 'note', 'source_chunk'].includes(node.category)) errors.push('Unknown graph category.');
  if (!Number.isInteger(node.version) || node.version < 1 || !timestamp(node.createdAt) || !timestamp(node.updatedAt)) errors.push(`Invalid revision or timestamp on ${node.id}.`);
  if (node.access.tenantId !== node.tenantId) errors.push(`Access scope differs from the node tenant on ${node.id}.`);
  if (node.category === 'source_chunk') {
    if (!node.source) return [...errors, 'Source chunks require capture provenance.'];
    if (!node.source.invocationId || !node.source.connectorId || !node.source.sourceIdentity || !timestamp(node.source.fetchedAt)) errors.push(`Source ${node.id} is missing capture metadata.`);
    if (node.source.contentHash !== createHash('sha256').update(node.body).digest('hex')) errors.push(`Source integrity check failed for ${node.id}.`);
    for (const [key, value] of Object.entries({ publishedAt: node.source.publishedAt, eventAt: node.source.eventAt })) if (value !== null && !dateOnly(value) && !timestamp(value)) errors.push(`Source ${node.id} has invalid ${key}.`);
    if (!node.access.connectorIds.includes(node.source.connectorId)) errors.push(`Source ${node.id} is missing its connector access dependency.`);
    return errors;
  }
  if (!node.editorialType || !EDITORIAL_TYPES.includes(node.editorialType)) errors.push(`Invalid editorial type on ${node.id}.`);
  if (!node.provenance) errors.push(`Authored node ${node.id} requires provenance.`);
  if (['research', 'transcript', 'transcript_plus_research'].includes(node.provenance ?? '') && node.body.trim() && !node.evidence.length) errors.push(`Research prose on ${node.id} is missing factual evidence.`);
  for (const ref of node.evidence) errors.push(...validateEvidence(ref, nodes, node));
  if (node.category === 'primary_entity') {
    const definition = schema.definitions.find(item => item.id === node.entityType || item.name === node.entityType);
    if (!definition) return [...errors, `Unknown tenant entity type ${node.entityType}.`];
    for (const key of Object.keys(node.fields ?? {})) {
      const field = definition.fields.find(item => item.key === key);
      if (!field) { errors.push(`Unknown field ${key} on ${node.entityType}.`); continue; }
      errors.push(...validateField(field, node.fields![key]));
      if (node.fields![key] !== null && node.fields![key] !== undefined && !(node.fieldEvidence?.[key]?.length)) errors.push(`Field ${key} on ${node.id} is missing its own factual evidence.`);
      for (const ref of node.fieldEvidence?.[key] ?? []) errors.push(...validateEvidence(ref, nodes, node));
    }
    if (node.status === 'qualified') for (const field of definition.fields.filter(item => item.required)) if (node.fields?.[field.key] === null || node.fields?.[field.key] === undefined || node.fields?.[field.key] === '') errors.push(`Qualified ${node.id} is missing required field ${field.key}.`);
    const revisions = node.freeText ?? [];
    if (new Set(revisions.map(revision => revision.id)).size !== revisions.length) errors.push(`Duplicate prose revisions on ${node.id}.`);
    for (const revision of revisions) for (const ref of revision.evidence) errors.push(...validateEvidence(ref, nodes, node));
  }
  return errors;
}

const semanticRelations = new Set(['works_at', 'exhibits', 'operates_in', 'holds_pain', 'best_contact_for', 'contradicts', 'qualifies']);
const company = (node: GraphNode | undefined): boolean => node?.category === 'primary_entity' && /company|organisation|organization/i.test(node.entityType ?? '');
const person = (node: GraphNode | undefined): boolean => node?.category === 'primary_entity' && /person|people/i.test(node.entityType ?? '');
const pain = (node: GraphNode | undefined): boolean => node?.category === 'note' && node.semanticKind === 'pain';

export function validateEdge(edge: GraphEdge, nodes: GraphNode[]): string[] {
  const source = nodes.find(node => node.id === edge.source), target = nodes.find(node => node.id === edge.target);
  if (!source || !target) return [`Edge ${edge.id} has a missing endpoint.`];
  const errors: string[] = [];
  if (source.tenantId !== target.tenantId || source.runId !== target.runId || edge.access.tenantId !== source.tenantId) errors.push(`Edge ${edge.id} crosses a tenant or run boundary.`);
  if (!Number.isFinite(edge.weight) || edge.weight < 0 || edge.weight > 1) errors.push(`Edge ${edge.id} weight must be from 0 to 1.`);
  const validEndpoints: Record<string, boolean> = {
    retrieved_for: source.category === 'source_chunk' && authored(target),
    evidences: source.category === 'source_chunk' && authored(target),
    references: authored(source) && target.category === 'source_chunk',
    mentions: authored(target), related_to: authored(target),
    works_at: person(source) && company(target),
    holds_pain: company(source) && pain(target), best_contact_for: person(source) && pain(target),
    exhibits: company(source) && target.category === 'note' && ['signal', 'demand_signal'].includes(target.semanticKind ?? ''),
    operates_in: company(source) && target.category === 'note',
    contradicts: authored(source) && authored(target), qualifies: authored(source) && authored(target),
    co_mentioned_with: authored(source) && authored(target), semantically_similar_to: authored(source) && authored(target),
  };
  if (!(edge.relation in validEndpoints) || !validEndpoints[edge.relation]) errors.push(`Invalid ${edge.relation} endpoints on ${edge.id}.`);
  if (semanticRelations.has(edge.relation) && !edge.evidence.length) errors.push(`Semantic assertion ${edge.id} requires supporting evidence.`);
  if (['holds_pain', 'best_contact_for'].includes(edge.relation) && (!edge.assessmentVersion || !edge.rationale?.trim())) errors.push(`Assessment ${edge.id} requires an objective version and rationale.`);
  for (const ref of edge.evidence) errors.push(...validateEvidence(ref, nodes));
  if (edge.relation === 'evidences' && (!edge.evidence.length || edge.evidence.some(ref => ref.chunkId !== source.id))) errors.push(`Evidence edge ${edge.id} does not bind its source span.`);
  if ([...source.access.connectorIds, ...target.access.connectorIds, ...edge.evidence.flatMap(ref => nodes.find(node => node.id === ref.chunkId)?.access.connectorIds ?? [])].some(id => !edge.access.connectorIds.includes(id))) errors.push(`Edge ${edge.id} is missing source access dependencies.`);
  return errors;
}

export function proseLinks(body: string): string[] {
  const prose = body.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`]*`/g, '');
  return [...prose.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)].map(match => match[1].trim());
}

export function evaluateQuality(state: RunState): QualityReport {
  const { nodes, edges, schema, run } = state;
  const gates: QualityGate[] = [];
  const add = (id: string, label: string, pass: boolean, actual: string | number, required: string | number, details: string[] = []) => gates.push({ id, label, pass, actual, required, details });
  const nodeErrors = nodes.flatMap(node => validateNode(node, schema, nodes));
  const edgeErrors = edges.flatMap(edge => validateEdge(edge, nodes));
  add('schema', 'Schema, evidence spans, and provenance', !nodeErrors.length, nodeErrors.length, 0, nodeErrors);
  add('edges', 'Typed relationships and endpoint integrity', !edgeErrors.length, edgeErrors.length, 0, edgeErrors);
  const keys = new Map<string, string>(); const duplicates: string[] = [];
  for (const node of nodes) for (const key of identityKeys(node, schema)) { const existing = keys.get(key); if (existing && existing !== node.id) duplicates.push(`${existing} and ${node.id} share strong identity ${key}.`); else keys.set(key, node.id); }
  if (new Set(nodes.map(node => node.id)).size !== nodes.length) duplicates.push('Duplicate graph node IDs.');
  add('identity', 'Unique primary identities', !duplicates.length, duplicates.length, 0, duplicates);
  const captureErrors: string[] = [];
  for (const invocation of state.invocations) {
    const captured = invocation.chunkIds.map(id => nodes.find(node => node.id === id && node.category === 'source_chunk'));
    if (captured.some(node => !node)) captureErrors.push(`${invocation.id} references a missing chunk.`);
    if (invocation.returnedCount > invocation.chunkIds.length) captureErrors.push(`${invocation.id} has ${invocation.returnedCount} returned items but only ${invocation.chunkIds.length} captured chunks.`);
    if (invocation.truncated || invocation.status === 'partial') captureErrors.push(`${invocation.id} contains incomplete source material.`);
    if (invocation.status === 'pending' || invocation.status === 'response_unavailable') captureErrors.push(`${invocation.id} has unresolved capture status ${invocation.status}.`);
  }
  for (const chunk of nodes.filter(node => node.category === 'source_chunk')) if (!state.invocations.some(invocation => invocation.chunkIds.includes(chunk.id))) captureErrors.push(`Chunk ${chunk.id} is missing an invocation association.`);
  add('capture', 'Every returned source item is accounted for', !captureErrors.length, captureErrors.length, 0, captureErrors);
  const linkErrors: string[] = [], orphans: string[] = [];
  for (const node of nodes.filter(authored)) {
    for (const link of proseLinks(node.body)) { const matches = nodes.filter(target => target.id === link || target.title === link || target.aliases.includes(link)); if (matches.length !== 1) linkErrors.push(`${node.title}: ${matches.length ? 'ambiguous' : 'unresolved'} reference [[${link}]].`); }
    if (['brief', 'meta'].includes(node.provenance ?? '') || node.editorialType === 'question') continue;
    // Navigation and query-context edges cannot make an authored finding supported.
    if (!edges.some(edge => (edge.source === node.id || edge.target === node.id) && !['retrieved_for', 'mentions', 'related_to'].includes(edge.relation) && edge.kind !== 'navigation')) orphans.push(node.title);
  }
  add('links', 'Authored references resolve unambiguously', !linkErrors.length, linkErrors.length, 0, linkErrors);
  add('authored_orphans', 'Authored findings have research relationships', !orphans.length, orphans.length, 0, orphans);
  const currentAssessment = (edge: GraphEdge) => positive(edge) && edge.assessmentVersion === run.assessmentVersion && !validateEdge(edge, nodes).length;
  const qualified = nodes.filter(node => company(node) && node.status === 'qualified' && !node.historical && edges.some(edge => edge.source === node.id && edge.relation === 'holds_pain' && currentAssessment(edge)));
  let signalCompanies = 0, contactCompanies = 0;
  if (run.config.profile === 'gtm') {
    const originGaps: string[] = [];
    for (const node of qualified) {
      const contentSeen = new Set<string>();
      const origins = new Set(edges.filter(edge => edge.source === node.id && edge.relation === 'holds_pain' && currentAssessment(edge)).flatMap(edge => edge.evidence.filter(ref => ref.polarity === 'supports').flatMap(ref => {
        const chunk = nodes.find(item => item.id === ref.chunkId);
        if (!chunk?.source?.origin) return [];
        const content = createHash('sha256').update(chunk.body.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()).digest('hex');
        if (contentSeen.has(content)) return [];
        contentSeen.add(content); return [chunk.source.origin];
      })));
      if (origins.size < run.config.criteria.independentSources) originGaps.push(`${node.title}: ${origins.size} independent source origins.`);
    }
    add('companies', 'Qualified, in-universe companies', qualified.length >= run.config.criteria.minCompanies, qualified.length, run.config.criteria.minCompanies);
    add('origins', 'Independent origins for each qualification', !originGaps.length, qualified.length - originGaps.length, qualified.length, originGaps);
    const windowStart = new Date(); windowStart.setUTCMonth(windowStart.getUTCMonth() - run.config.signalWindowMonths);
    for (const node of qualified) {
      const signal = edges.filter(edge => edge.source === node.id && edge.relation === 'exhibits' && currentAssessment(edge)).some(edge => {
        const note = nodes.find(item => item.id === edge.target);
        if (!note || note.historical) return false;
        return [...note.evidence, ...edge.evidence].some(ref => {
          if (ref.polarity !== 'supports' || validateEvidence(ref, nodes).length) return false;
          const source = nodes.find(item => item.id === ref.chunkId)?.source;
          const date = source?.eventAt || source?.publishedAt;
          if (!date || Date.parse(date) < windowStart.getTime() || Date.parse(date) > Date.now()) return false;
          const parsed = new Date(date);
          const dateForms = [parsed.toISOString().slice(0,10), parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }), parsed.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })];
          // A provider metadata date alone is not a cited date basis. The selected
          // stored passage must actually contain the date used by this gate.
          return dateForms.some(form => ref.quote.toLowerCase().includes(form.toLowerCase()));
        });
      });
      if (signal) signalCompanies++;
      const pains = new Set(edges.filter(edge => edge.source === node.id && edge.relation === 'holds_pain' && currentAssessment(edge)).map(edge => edge.target));
      const contacts = nodes.filter(candidate => person(candidate) && !candidate.historical && edges.some(edge => edge.source === candidate.id && edge.target === node.id && edge.relation === 'works_at' && positive(edge) && edge.current === true && !validateEdge(edge, nodes).length) && edges.some(edge => edge.source === candidate.id && edge.relation === 'best_contact_for' && pains.has(edge.target) && currentAssessment(edge)));
      if (contacts.length >= 2 && contacts.some(contact => /\b(ceo|chief executive|founder|co-founder)\b/i.test(String(contact.fields?.role ?? contact.fields?.job_title ?? '')))) contactCompanies++;
    }
    const percentage = qualified.length ? 100 * signalCompanies / qualified.length : 0;
    add('signals', `Dated demand signals within ${run.config.signalWindowMonths} months`, percentage >= run.config.criteria.signalPercent && (qualified.length > 0 || run.config.criteria.signalPercent === 0), `${signalCompanies}/${qualified.length} (${Math.round(percentage)}%)`, `${run.config.criteria.signalPercent}%`);
    if (run.config.criteria.requireContacts) add('contacts', 'Founder or CEO and another current relevant contact', contactCompanies === qualified.length && qualified.length > 0, contactCompanies, qualified.length);
    const uncovered = state.discovery.segments.filter(segment => !state.discovery.coveredSegments.includes(segment));
    add('segments', 'Every defined discovery segment covered', !uncovered.length && state.discovery.segments.length > 0, state.discovery.segments.length - uncovered.length, state.discovery.segments.length, uncovered);
    const attempts = run.config.criteria.saturationAttempts;
    let noNew = 0; for (const count of [...state.discovery.recentEligibleCounts].reverse()) { if (count !== 0) break; noNew++; }
    add('saturation', 'Bounded discovery saturation (not exhaustive coverage)', noNew >= attempts, noNew, attempts);
  }
  return { passed: gates.every(gate => gate.pass), gates, qualifiedCompanies: qualified.length, signalCompanies, contactCompanies, gaps: gates.filter(gate => !gate.pass).map(gate => `${gate.label}: ${gate.actual}; required ${gate.required}.`), checkedRevision: run.revision };
}
