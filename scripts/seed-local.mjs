// Run with: node --env-file=.env.local scripts/seed-local.mjs
// Deterministic IDs make reruns additive without overwriting edited demo records.
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
if (!url || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('This seed only supports a local Supabase database.');
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing local service role key.');
const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const email = 'demo@example.test';
const password = 'GrowthSwarm-demo-2026!';
function checked(result) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
let user;
for (let page = 1; !user; page++) {
  const { users } = checked(await db.auth.admin.listUsers({ page, perPage: 100 }));
  user = users.find((item) => item.email === email);
  if (users.length < 100) break;
}
if (!user) {
  ({ user } = checked(await db.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { name: 'Local Demo', test_data: true },
  })));
}
const id = (key) => {
  const hash = createHash('sha256').update(`growth-swarm-demo-v1:${user.id}:${key}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
};
const rows = Object.fromEntries([
  'runs', 'invocations', 'nodes', 'assertions', 'edges', 'tasks', 'votes', 'checkpoints',
  'leads',
].map((table) => [table, []]));
const companies = [
  ['Northstar Components (Demo)', 'northstar-components.example', 'Manchester, UK', '480', 'industrial components', 'Alex Rowan', 'Jamie Vale'],
  ['Cedar Harbour Logistics (Demo)', 'cedar-harbour.example', 'Liverpool, UK', '720', 'logistics', 'Morgan Ellis', 'Taylor Finch'],
  ['Meridian Precision (Demo)', 'meridian-precision.example', 'Birmingham, UK', '310', 'precision manufacturing', 'Jordan Avery', 'Riley Ash'],
  ['Larkspur Distribution (Demo)', 'larkspur-distribution.example', 'Dublin, Ireland', '560', 'distribution', 'Casey Reed', 'Robin Hale'],
  ['Copperleaf Packaging (Demo)', 'copperleaf-packaging.example', 'Leeds, UK', '850', 'packaging', 'Cameron Wren', 'Drew Sage'],
  ['Willowbridge Engineering (Demo)', 'willowbridge-engineering.example', 'Bristol, UK', '240', 'engineering', 'Avery Lane', 'Quinn Brook'],
];
const stages = ['new', 'reviewing', 'contacted', 'meeting', 'won', 'lost'];
const base = Date.now() - 3 * 86400000;
for (let runIndex = 0; runIndex < 2; runIndex++) {
  const runId = id(`run:${runIndex}`);
  const stamp = new Date(base + runIndex * 86400000).toISOString();
  const ended = new Date(Date.parse(stamp) + 900000).toISOString();
  const selected = runIndex === 0 ? companies : companies.slice(0, 2);
  const events = [];
  const stats = { companies: selected.length, qualified: runIndex === 0 ? 6 : 0, people: selected.length * 2, signals: selected.length, chunks: selected.length * 2, doneTasks: selected.length, openTasks: 0 };
  const outcome = runIndex === 0 ? 'consensus' : 'stopped_by_user';
  rows.runs.push({
    id: runId, user_id: user.id, profile: 'gtm',
    objective: runIndex === 0 ? '[DEMO] UK and Ireland finance automation prospects' : '[DEMO] Partial follow-up: acquisition signals',
    pain: 'Fictional finance teams reconcile supplier invoices across multiple ERP systems.',
    universe: 'Fictional UK and Ireland industrial and distribution businesses.',
    exclusions: 'Test data only; not real prospects or verified research.',
    completion_criteria: 'Demo scenario: six companies, two named contacts and two fictional evidence snippets each.',
    swarm_size: 5, threshold: 0.8, status: runIndex === 0 ? 'completed' : 'ended', outcome,
    connectors: [], graph_revision: 1, epoch: 1, spend: 0, cost_cap: 5,
    stats, created_at: stamp, started_at: stamp, ended_at: ended,
  });
  const node = (key, data) => {
    const nodeId = id(`${runIndex}:node:${key}`);
    rows.nodes.push({ id: nodeId, run_id: runId, fields: {}, provenance: 'demo_fixture', created_at: stamp, revision: 1, ...data });
    return nodeId;
  };
  const edge = (key, from, to, relation, extra = {}) => rows.edges.push({
    id: id(`${runIndex}:edge:${key}`), run_id: runId, from_node: from, to_node: to, relation, created_at: stamp, ...extra,
  });
  for (const [index, [name, domain, location, size, sector, ceo, finance]] of selected.entries()) {
    const agent = index % 5;
    const taskId = id(`${runIndex}:task:${index}`);
    const invocationId = id(`${runIndex}:invocation:${index}`);
    rows.tasks.push({ id: taskId, run_id: runId, kind: 'discovery', status: 'done', owner_agent: agent, payload: { demo: true }, result_summary: `Loaded fictional fixture for ${name}.`, created_at: stamp, completed_at: ended });
    rows.invocations.push({ id: invocationId, run_id: runId, task_id: taskId, agent_index: agent, connector: 'demo_fixture', provider: 'local_fixture', operation: 'seed', query: `Fictional ${sector} sample`, status: 'succeeded', item_count: 2, cost: 0, started_at: stamp, finished_at: ended });
    const company = node(`${index}:company`, {
      category: 'primary_entity', entity_type: 'company', title: name,
      fields: { name, website: `https://${domain}`, location, size: runIndex === 0 ? size : String(Number(size) + 20), sector, status: runIndex === 0 ? 'qualified' : 'candidate', demo: true },
      free_text: 'FICTIONAL TEST DATA. Illustrates acquisition-driven ERP consolidation and manual invoice reconciliation.', confidence: 'medium', created_by_agent: agent,
    });
    const passages = [
      `FICTIONAL TEST DATA: ${name} has ${size} employees in ${location}. Following a fictional acquisition, its finance team manually reconciles invoices across three ERP systems.`,
      `FICTIONAL TEST DATA: ${ceo} is CEO and ${finance} is Finance Director at ${name}. A fictional finance transformation programme began this quarter.`,
    ];
    const sources = passages.map((content, sourceIndex) => node(`${index}:source:${sourceIndex}`, {
      category: 'source_chunk', title: `[DEMO] ${name}: ${sourceIndex === 0 ? 'company profile' : 'leadership and expansion'}`,
      content, locator: `https://${sourceIndex === 0 ? domain : 'fixture-news.example'}/${domain}/source-${sourceIndex}`,
      provider: 'local_fixture', connector: 'demo_fixture', is_snippet: true,
      content_hash: createHash('sha256').update(content).digest('hex'), invocation_id: invocationId,
      fetched_at: stamp, published_at: stamp,
    }));
    const assertion = (key, owner, sourceIndex, claim, field) => {
      const assertionId = id(`${runIndex}:assertion:${key}`);
      rows.assertions.push({ id: assertionId, run_id: runId, owner_node_id: owner, field_key: field, claim, confidence: 'medium', evidence: [{ chunk_id: sources[sourceIndex], quote: passages[sourceIndex], polarity: 'supports' }], created_by_agent: agent, created_at: stamp });
      edge(`evidence:${key}`, sources[sourceIndex], owner, 'evidences', { assertion_id: assertionId, polarity: 'supports' });
    };
    assertion(`${index}:company`, company, 0, '[DEMO] Manual reconciliation across three ERP systems.', 'pain');
    assertion(`${index}:leadership`, company, 1, '[DEMO] Named leadership and finance transformation programme.', 'leadership');
    for (const [personIndex, personName] of [ceo, finance].entries()) {
      const role = personIndex === 0 ? 'CEO' : 'Finance Director';
      const person = node(`${index}:person:${personIndex}`, {
        category: 'primary_entity', entity_type: 'person', title: `${personName} (Demo)`,
        fields: { name: `${personName} (Demo)`, role, location, founder_or_ceo: personIndex === 0, demo: true },
        free_text: `Fictional ${role} for interface testing. Not a real contact.`, confidence: 'medium',
      });
      edge(`${index}:employment:${personIndex}`, person, company, 'works_at', { polarity: 'supports', rationale: `Fictional current ${role}` });
      assertion(`${index}:person:${personIndex}`, person, 1, `[DEMO] ${personName} is ${role} at ${name}.`, 'employment');
      events.push({ run_id: runId, kind: 'node_created', agent_index: agent, payload: { nodeId: person, category: 'primary_entity', title: `${personName} (Demo)`, summary: `${personName} is the fictional ${role}.` }, created_at: new Date(Date.parse(stamp) + index * 60000 + 4200 + personIndex * 300).toISOString() });
    }
    const signal = node(`${index}:signal`, { category: 'note', editorial_type: 'interpretation', semantic_kind: 'demand_signal', title: `[DEMO] ERP consolidation at ${name}`, content: 'Fictional acquisition creates a potential need for finance automation.', event_at: stamp, confidence: 'medium' });
    edge(`${index}:signal-company`, signal, company, 'about');
    assertion(`${index}:signal`, signal, 0, '[DEMO] Acquisition creates a possible consolidation trigger.', 'signal');
    const trace = (offset, kind, payload) => events.push({ run_id: runId, kind, agent_index: agent, payload, created_at: new Date(Date.parse(stamp) + index * 60000 + offset).toISOString() });
    trace(0, 'task_started', { kind: 'discovery', taskId, summary: `Discover ${name}` });
    trace(1000, 'search', { query: `Fictional ${sector} sample`, status: 'succeeded', results: 2 });
    trace(2000, 'node_created', { nodeId: company, category: 'primary_entity', title: name, summary: name });
    sources.forEach((sourceId, sourceIndex) => trace(3000 + sourceIndex * 500, 'node_created', { nodeId: sourceId, category: 'source_chunk', title: `[DEMO] ${name} source ${sourceIndex + 1}`, summary: 'Captured a fictional source snippet.' }));
    trace(5000, 'node_created', { nodeId: signal, category: 'note', title: `[DEMO] ERP consolidation at ${name}`, summary: 'Recorded a fictional demand signal.' });
    trace(6000, 'task_done', { summary: `Loaded fictional fixture for ${name}.` });
  }
  for (let agent = 0; agent < 5; agent++) rows.votes.push({ id: id(`${runIndex}:vote:${agent}`), run_id: runId, epoch: 1, agent_index: agent, revision: 1, decision: runIndex === 0 ? 'yes' : 'no', rationale: runIndex === 0 ? 'Simulated vote: demo fixture criteria satisfied.' : 'Simulated vote: follow-up evidence remains incomplete.', created_at: ended });
  events.push({
    run_id: runId, kind: 'epoch_closed', agent_index: null,
    payload: { yes: runIndex === 0 ? 5 : 0, total: 5, outcome, summary: runIndex === 0 ? 'Five of five agents voted yes on the demo graph.' : 'Stopped before the demo criteria were met.' },
    created_at: new Date(Date.parse(ended) - 1000).toISOString(),
  });
  events.push({
    run_id: runId, kind: 'run_finished', agent_index: null,
    payload: { outcome, summary: outcome === 'consensus' ? 'Consensus reached on the fictional fixture.' : 'Stopped by you. Partial fictional result saved.' },
    created_at: ended,
  });
  events.sort((a, b) => a.created_at.localeCompare(b.created_at));
  const existingEvents = await db.from('events').select('id', { count: 'exact', head: true }).eq('run_id', runId);
  if (existingEvents.error) throw new Error(existingEvents.error.message);
  if (!existingEvents.count && events.length) {
    checked(await db.from('events').insert(events));
    console.log(`events for run ${runIndex}: inserted ${events.length}`);
  } else {
    console.log(`events for run ${runIndex}: kept ${existingEvents.count}`);
  }
  rows.checkpoints.push({ id: id(`${runIndex}:checkpoint`), run_id: runId, generation: 1, manifest: { demo: true, outcome, revision: 1, stats, partial: runIndex !== 0 }, created_at: ended });

  // CRM annotations are keyed by company domain, matching leadKeyFor.
  if (runIndex === 0) {
    selected.forEach(([, domain], index) => {
      rows.leads.push({ id: id(`lead:${domain}`), user_id: user.id, lead_key: domain, stage: stages[index % stages.length], starred: index % 3 === 0, notes: 'FICTIONAL TEST DATA — sample CRM stage, not actual outreach.', created_at: stamp, updated_at: ended });
    });
  }
}
for (const [table, data] of Object.entries(rows)) {
  if (data.length) checked(await db.from(table).upsert(data, { onConflict: 'id', ignoreDuplicates: true }));
  console.log(`${table}: ${data.length} fixture records ensured`);
}
console.log(`Demo account: ${email}`);
console.log('Demo password is documented in scripts/seed-local.mjs. Existing account passwords are preserved.');
