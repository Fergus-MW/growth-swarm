import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { Store } from '../server/store.ts';
import { createApi } from '../server/api.ts';
import type { Run, RunConfig } from '../shared/types.ts';

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'swarm-task-criteria-'));
  const store = new Store(dir);
  const app = createApi(store);
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('No listener');
  const base = `http://127.0.0.1:${address.port}`;
  const response = await fetch(base + '/api/bootstrap');
  const cookie = response.headers.get('set-cookie')!.split(';')[0];
  const { defaults } = await response.json() as { defaults: RunConfig };
  const config: RunConfig = { ...defaults, profile: 'blank', mode: 'demo', connectorIds: ['fixture-web'], objective: 'Compare tidal power and offshore wind for coastal communities.', universe: '', exclusions: '', criteria: { text: '', minCompanies: 0, signalPercent: 0, requireContacts: false, independentSources: 1, saturationAttempts: 0 } };
  const call = (path: string, init: RequestInit = {}) => fetch(base + path, { ...init, headers: { cookie, 'Content-Type': 'application/json', ...init.headers } });
  return { config, call, close: async () => { app.abortAll(); await new Promise<void>(r => app.server.close(() => r())); store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('blank criteria become task-specific persisted criteria before execution', async () => {
  const app = await setup();
  try {
    const response = await app.call('/api/runs', { method: 'POST', headers: { 'Idempotency-Key': 'task-generated-criteria' }, body: JSON.stringify({ config: app.config }) });
    assert.equal(response.status, 201);
    const run = await response.json() as Run;
    assert.match(run.config.criteria.text, /Compare tidal power and offshore wind for coastal communities\./);
    assert.match(run.config.criteria.text, /evidence|sources/);
    const persisted = await (await app.call(`/api/runs/${run.id}`)).json() as Run;
    assert.equal(persisted.config.criteria.text, run.config.criteria.text);
    assert.equal(run.startedAt, null);
    assert.equal(run.usage.calls, 0);
  } finally { await app.close(); }
});

test('an oversized task reports generation failure and can be retried with exact explicit criteria', async () => {
  const app = await setup();
  try {
    const config = { ...app.config, objective: 'Research '.repeat(2100) };
    const post = () => app.call('/api/runs', { method: 'POST', headers: { 'Idempotency-Key': 'task-retry-criteria' }, body: JSON.stringify({ config }) });
    const failed = await post();
    assert.equal(failed.status, 400);
    assert.match((await failed.json() as { error: string }).error, /Could not generate completion criteria/);
    assert.deepEqual(await (await app.call('/api/runs')).json(), []);
    config.criteria.text = '  Compare options.\nKeep unknowns visible.  ';
    const retried = await post();
    assert.equal(retried.status, 201);
    const run = await retried.json() as Run;
    assert.equal(run.config.criteria.text, config.criteria.text);
    assert.equal(run.config.objective, config.objective);
  } finally { await app.close(); }
});

test('generated GTM criteria preserve the advanced gates chosen before admission', async () => {
  const app = await setup();
  try {
    const config: RunConfig = { ...app.config, profile: 'gtm', objective: 'Find companies with manual invoice reconciliation.', criteria: { text: '', minCompanies: 7, signalPercent: 60, independentSources: 3, saturationAttempts: 12, requireContacts: true } };
    const response = await app.call('/api/runs', { method: 'POST', headers: { 'Idempotency-Key': 'gtm-generated-controls' }, body: JSON.stringify({ config }) });
    assert.equal(response.status, 201);
    const run = await response.json() as Run;
    const { text, ...gates } = run.config.criteria;
    assert.deepEqual(gates, { minCompanies: 7, signalPercent: 60, independentSources: 3, saturationAttempts: 12, requireContacts: true });
    assert.match(text, /7 qualified companies/);
    assert.match(text, /60%/);
    assert.match(text, /3 independent source origins/);
    assert.match(text, /12 discovery attempts/);
    assert.match(text, /founder or CEO and another named relevant contact/);
  } finally { await app.close(); }
});
