import test from 'node:test';
import assert from 'node:assert/strict';
import { compactResearch, preflight, type ResearchDraft } from '../server/model.ts';

test('strict structured nulls are removed before a graph commit', () => {
  const draft = compactResearch({
    summary: 'One supported company.',
    nodes: [{
      key: 'acme', id: null, category: 'primary_entity', title: 'Acme', entityType: 'company',
      fields: { name: 'Acme', domain: 'acme.example', sector: null, country: null, headcount: null, role: 'CEO', companyId: null, linkedin: null },
      fieldEvidence: {
        name: [{ chunkId: 'chunk', start: 0, end: 4, quote: 'Acme', polarity: 'supports' }],
        domain: [{ chunkId: 'chunk', start: 5, end: 17, quote: 'acme.example', polarity: 'supports' }],
        sector: [], country: [], headcount: [], role: [], companyId: [], linkedin: [],
      },
      body: 'Supported company prose.', semanticKind: null, status: 'candidate', exclusionReason: null,
      evidence: [{ chunkId: 'chunk', start: 0, end: 4, quote: 'Acme', polarity: 'supports' }],
      provenance: 'research', confidence: 'medium',
    }],
    edges: [{ source: 'acme', target: 'pain', relation: 'holds_pain', evidence: [], rationale: 'Inferred fit.', polarity: 'supports', current: null, validAt: null }],
  } as unknown as ResearchDraft);
  assert.equal(draft.nodes[0].id, undefined);
  assert.equal(draft.nodes[0].semanticKind, undefined);
  assert.deepEqual(draft.nodes[0].fields, { name: 'Acme', domain: 'acme.example' });
  assert.deepEqual(Object.keys(draft.nodes[0].fieldEvidence ?? {}), ['name', 'domain']);
  assert.equal('validAt' in draft.edges[0], false);
  assert.equal('current' in draft.edges[0], false);
});

test('live admission names the OpenAI credential it requires', async () => {
  const saved = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    await assert.rejects(() => preflight('gpt-4.1-mini'), /OPENAI_API_KEY/);
  } finally {
    if (saved === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = saved;
  }
});
