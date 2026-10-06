import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateQuality, identityKeys, proseLinks, validateEdge, validateEvidence, validateField, validateNode } from '../server/validation.ts';
import { DEFAULT_SCHEMA } from '../server/config.ts';
import { edge, evidence, node, qualifiedState, source, state } from './research-fixtures.ts';

test('evidence must match the exact stored passage and immutable hash', () => {
  const chunk = source(), ref = evidence(chunk);
  assert.deepEqual(validateEvidence(ref, [chunk]), []);
  assert.match(validateEvidence({ ...ref, end: ref.end - 1 }, [chunk]).join(), /exactly match/);
  assert.match(validateEvidence({ ...ref, quote: 'A plausible paraphrase' }, [chunk]).join(), /exactly match/);
  assert.match(validateEvidence(ref, [{ ...chunk, body: chunk.body + ' changed' }]).join(), /integrity/);
  assert.match(validateEvidence({ ...ref, chunkId: 'missing' }, [chunk]).join(), /stored source/);
});

test('source permissions cannot be widened by derived prose', () => {
  const chunk = source(); chunk.access.userIds = ['alice'];
  const owner = node('owner', { access: { tenantId: 'local', connectorIds: [] } });
  const errors = validateEvidence(evidence(chunk), [chunk], owner).join();
  assert.match(errors, /dependency/); assert.match(errors, /widens source user access/);
});

test('unknown fields and unsupported field facts are rejected; partial unknowns remain valid', () => {
  const entity = node('company', { category: 'primary_entity', entityType: 'company', editorialType: 'organisation', status: 'candidate', fields: { name: null, domain: null } });
  assert.deepEqual(validateNode(entity, DEFAULT_SCHEMA), []);
  assert.match(validateNode({ ...entity, status: 'qualified' }, DEFAULT_SCHEMA).join(), /required field/);
  assert.match(validateNode({ ...entity, fields: { invented: 7 } }, DEFAULT_SCHEMA).join(), /Unknown field/);
  assert.match(validateNode({ ...entity, fields: { name: 'Acme' } }, DEFAULT_SCHEMA).join(), /own factual evidence/);
});

test('field codec preserves date-only precision and validates structured shapes', () => {
  assert.equal(validateField({ id: 'd', key: 'd', type: 'date' }, '2026-02-30').length, 1);
  assert.equal(validateField({ id: 'd', key: 'd', type: 'date' }, '2026-02-01T00:00:00Z').length, 1);
  assert.equal(validateField({ id: 'd', key: 'd', type: 'date' }, '2026-02-01').length, 0);
  assert.equal(validateField({ id: 's', key: 's', type: 'dated_series' }, [{ date: '2026-01-01', value: 2 }, { date: '2026-01-01', value: 3 }]).length, 1);
  assert.equal(validateField({ id: 's', key: 's', type: 'money_series' }, [{ period: '2026', amount: 2, currency: 'GBP' }]).length, 1);
  assert.equal(validateField({ id: 's', key: 's', type: 'string_list', allowedValues: ['a'] }, ['b']).length, 1);
});

test('identity resolution normalizes company domains without merging same-name people', () => {
  const first = node('a', { category: 'primary_entity', entityType: 'company', fields: { domain: 'https://WWW.Example.com/path' } });
  const second = node('b', { category: 'primary_entity', entityType: 'company', fields: { domain: 'example.com' } });
  assert.deepEqual(identityKeys(first, DEFAULT_SCHEMA), identityKeys(second, DEFAULT_SCHEMA));
  const a = node('pa', { title: 'Alex Smith', category: 'primary_entity', entityType: 'person', fields: { name: 'Alex Smith' } });
  assert.deepEqual(identityKeys(a, DEFAULT_SCHEMA), []);
  const personA = { ...a, fields: { linkedin: 'https://www.linkedin.com/in/alex-one' } };
  const personB = { ...a, fields: { linkedin: 'https://www.linkedin.com/in/alex-two' } };
  assert.notDeepEqual(identityKeys(personA, DEFAULT_SCHEMA), identityKeys(personB, DEFAULT_SCHEMA));
  assert.equal(evaluateQuality(state([first, second])).gates.find(g => g.id === 'identity')?.pass, false);
});

test('semantic edges reject invalid endpoint types and require evidence and rationale', () => {
  const company = node('co', { category: 'primary_entity', entityType: 'company' }), pain = node('p', { semanticKind: 'pain' });
  assert.match(validateEdge(edge('co', 'p', 'works_at'), [company, pain]).join(), /Invalid works_at/);
  assert.match(validateEdge(edge('co', 'p', 'holds_pain', [], { rationale: '' }), [company, pain]).join(), /requires supporting evidence|requires an objective version/);
});

test('unused captured material is not an orphan and cannot inflate authored quality', () => {
  const snapshot = state([source()]);
  assert.equal(evaluateQuality(snapshot).gates.find(g => g.id === 'authored_orphans')?.pass, true);
  snapshot.nodes.push(node('finding', { provenance: 'research', body: 'Unsubstantiated finding.' }));
  snapshot.edges.push(edge('source', 'finding', 'retrieved_for', [], { kind: 'context' }));
  assert.equal(evaluateQuality(snapshot).gates.find(g => g.id === 'authored_orphans')?.pass, false);
});

test('every connector item is accounted for and partial captures remain a gap', () => {
  const snapshot = state([source()]); snapshot.invocations[0].returnedCount = 2;
  assert.equal(evaluateQuality(snapshot).gates.find(g => g.id === 'capture')?.pass, false);
  snapshot.invocations[0].returnedCount = 1; snapshot.invocations[0].truncated = true;
  assert.equal(evaluateQuality(snapshot).gates.find(g => g.id === 'capture')?.pass, false);
});

test('qualification requires positive current objective assessment and independent origins', () => {
  const snapshot = qualifiedState();
  assert.equal(evaluateQuality(snapshot).qualifiedCompanies, 1);
  assert.equal(evaluateQuality(snapshot).gates.find(g => g.id === 'origins')?.pass, true);
  snapshot.nodes[1].source!.origin = snapshot.nodes[0].source!.origin;
  assert.equal(evaluateQuality(snapshot).gates.find(g => g.id === 'origins')?.pass, false);
  snapshot.edges[0].polarity = 'contradicts'; assert.equal(evaluateQuality(snapshot).qualifiedCompanies, 0);
  snapshot.edges[0].polarity = 'supports'; snapshot.edges[0].assessmentVersion = 'old'; assert.equal(evaluateQuality(snapshot).qualifiedCompanies, 0);
});

test('fetch date never counts as a dated demand signal', () => {
  const snapshot = qualifiedState(), chunk = snapshot.nodes[0];
  chunk.source!.publishedAt = null; chunk.source!.eventAt = null;
  snapshot.nodes.push(node('signal', { semanticKind: 'demand_signal', evidence: [evidence(chunk)] }));
  snapshot.edges.push(edge('company', 'signal', 'exhibits', [evidence(chunk)]));
  assert.equal(evaluateQuality(snapshot).signalCompanies, 0);
  chunk.source!.publishedAt = new Date().toISOString();
  assert.equal(evaluateQuality(snapshot).signalCompanies, 1);
  chunk.source!.publishedAt = new Date(Date.now() - 86_400_000).toISOString();
  assert.equal(evaluateQuality(snapshot).signalCompanies, 0, 'Metadata date without a matching cited date is not evidence');
});

test('identical syndicated source bodies do not create independent origins', () => {
  const snapshot = qualifiedState(), first = snapshot.nodes[0];
  snapshot.nodes[1] = source('b', first.body, 'syndicated.example');
  const refs = [evidence(first), evidence(snapshot.nodes[1])];
  snapshot.edges[0].evidence = refs;
  assert.equal(evaluateQuality(snapshot).gates.find(g => g.id === 'origins')?.pass, false);
});

test('contact gate needs two distinct people, CEO/founder, current employment and pain rationale', () => {
  const snapshot = qualifiedState(), refs = [evidence(snapshot.nodes[0])];
  for (const [id, role] of [['ceo', 'CEO'], ['owner', 'Finance Director']]) {
    snapshot.nodes.push(node(id, { category: 'primary_entity', entityType: 'person', editorialType: 'person', fields: { name: id, role, companyId: 'company' }, fieldEvidence: { name: refs, role: refs, companyId: refs }, evidence: refs }));
    snapshot.edges.push(edge(id, 'company', 'works_at', refs), edge(id, 'pain', 'best_contact_for', refs));
  }
  assert.equal(evaluateQuality(snapshot).contactCompanies, 1);
  snapshot.edges.find(e => e.source === 'ceo' && e.relation === 'works_at')!.historical = true;
  assert.equal(evaluateQuality(snapshot).contactCompanies, 0);
});

test('wiki links in code are ignored and saturation cannot override unmet companies', () => {
  assert.deepEqual(proseLinks('[[Real]]\n```\n[[Example]]\n```\n`[[Inline]]`'), ['Real']);
  const snapshot = state([]); snapshot.discovery.recentEligibleCounts = Array(40).fill(0);
  assert.equal(evaluateQuality(snapshot).passed, false);
});
