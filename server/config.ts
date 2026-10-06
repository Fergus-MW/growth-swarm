import { criteriaConflicts, criteriaFromText } from '../shared/criteria.ts';
import { createHash } from 'node:crypto';
import type { Connector, RunConfig, SchemaSnapshot } from '../shared/types.ts';

export class AppError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const definitions: SchemaSnapshot['definitions'] = [
  { id: 'company', name: 'Company', matchMode: 'identifier', fields: [
    { id: 'company.name', key: 'name', type: 'string', required: true },
    { id: 'company.domain', key: 'domain', type: 'string', required: true, unique: true },
    { id: 'company.sector', key: 'sector', type: 'string' },
    { id: 'company.country', key: 'country', type: 'string' },
    { id: 'company.headcount', key: 'headcount', type: 'number' },
  ] },
  { id: 'person', name: 'Person', matchMode: 'identifier', fields: [
    { id: 'person.name', key: 'name', type: 'string', required: true },
    { id: 'person.role', key: 'role', type: 'string', required: true },
    { id: 'person.companyId', key: 'companyId', type: 'string', required: true },
    { id: 'person.linkedin', key: 'linkedin', type: 'url', unique: true },
  ] },
];
export const DEFAULT_SCHEMA: SchemaSnapshot = { version: '1', translatorVersion: 'local-1', definitions, hash: createHash('sha256').update(JSON.stringify(definitions)).digest('hex') };
export function defaultConfig(): RunConfig {
  const live = !!process.env.TAVILY_API_KEY && !!process.env.GEMINI_API_KEY;
  return {
    profile: 'gtm', objective: 'Find companies whose finance teams reconcile supplier invoices manually across multiple ERP systems after acquisitions.',
    universe: 'UK and Ireland industrials, distribution, and specialist manufacturers; 200–2,000 employees; private-equity-backed or recently acquired.',
    exclusions: 'Consultancies, software vendors, and companies outside the specified universe.',
    criteria: { text: 'Find at least 50 qualified companies, each supported by two independent source origins. At least 80% need a dated demand signal. Every qualified company needs a founder or CEO and another named relevant contact. Cover every discovery segment and observe 40 discovery attempts without a new eligible company.', minCompanies: 50, signalPercent: 80, requireContacts: true, independentSources: 2, saturationAttempts: 40 },
    swarmSize: 20, threshold: .7, connectorIds: [live ? 'tavily' : 'fixture-web'],
    budget: { money: 10, wallClockMinutes: 30, maxCalls: 1000, maxBytes: 20_000_000, maxChunks: 5000, maxInputTokens: 20_000_000, maxOutputTokens: 4_000_000, connectorCaps: { tavily: 500, 'fixture-web': 500 } },
    signalWindowMonths: 12, mode: live ? 'live' : 'demo', model: process.env.GEMINI_MODEL || 'gemini-3.8-flash', reuseParentSources: true,
  };
}
function bounded(value: unknown, name: string, min: number, max: number, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new AppError(400, `${name} must be ${integer ? 'an integer ' : ''}between ${min} and ${max}.`);
}
export function validateConfig(value: unknown, connectors: Connector[], hasParent = false): RunConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError(400, 'A run configuration is required.');
  const c = structuredClone(value) as RunConfig;
  for (const k of ['objective','universe','exclusions','model'] as const) {
    if (typeof c[k] !== 'string' || c[k].length > 20000) throw new AppError(400, `Invalid ${k}.`);
  }
  if (!c.objective.trim()) throw new AppError(400, 'Enter a research objective.');
  if (!['gtm','blank'].includes(c.profile) || !['demo','live'].includes(c.mode)) throw new AppError(400, 'Invalid research profile or mode.');
  bounded(c.swarmSize,'Agent count',5,100,true); bounded(c.threshold,'Consensus threshold',.01,1);
  bounded(c.signalWindowMonths,'Signal window',1,120,true);
  if (!c.criteria || typeof c.criteria.text !== 'string' || c.criteria.text.length > 20000) throw new AppError(400,'Invalid completion criteria.');
  if (!c.criteria.text.trim()) {
    const task = c.objective.trim();
    if (task.length > 18000) throw new AppError(400, 'Could not generate completion criteria. Shorten the task description or enter completion criteria yourself.');
    c.criteria = criteriaFromText(`Complete the following task: ${task}\nSupport the findings with inspectable source evidence. Address each requested part of the task, report conflicting evidence and unresolved gaps, and do not consider the task complete while a requested part remains unanswered.`);
  }
  bounded(c.criteria.minCompanies,'Minimum companies',0,10000,true); bounded(c.criteria.signalPercent,'Signal percentage',0,100);
  bounded(c.criteria.independentSources,'Independent source origins',1,20,true); bounded(c.criteria.saturationAttempts,'Saturation attempts',0,1000,true);
  const conflicts=criteriaConflicts(c.criteria);if(conflicts.length)throw new AppError(400,conflicts.join(' '));
  if (typeof c.criteria.requireContacts !== 'boolean' || typeof c.reuseParentSources !== 'boolean') throw new AppError(400,'Invalid contact or inherited-source policy.');
  if (!c.budget || typeof c.budget.connectorCaps !== 'object' || c.budget.connectorCaps === null) throw new AppError(400,'Explicit budgets are required.');
  bounded(c.budget.money,'Money cap',.01,10000); bounded(c.budget.wallClockMinutes,'Time cap',.1,50);
  bounded(c.budget.maxCalls,'Tool call cap',1,100000,true); bounded(c.budget.maxBytes,'Storage byte cap',10000,1_000_000_000,true);
  bounded(c.budget.maxChunks,'Source chunk cap',1,100000,true); bounded(c.budget.maxInputTokens,'Input token cap',1,20_000_000,true); bounded(c.budget.maxOutputTokens,'Output token cap',1,4_000_000,true);
  if (!Array.isArray(c.connectorIds) || c.connectorIds.some(x=>typeof x !== 'string') || new Set(c.connectorIds).size !== c.connectorIds.length) throw new AppError(400,'Invalid source selection.');
  if (!c.connectorIds.length && !hasParent) throw new AppError(400,'A new run needs an enabled source.');
  for (const id of c.connectorIds) {
    const conn = connectors.find(x=>x.id === id);
    if (!conn) throw new AppError(400,`Unknown source: ${id}.`);
    if (!conn.available) throw new AppError(400,conn.reason || `${conn.name} is unavailable.`);
    if ((c.mode === 'demo') !== (conn.mode === 'fixture')) throw new AppError(400,'Fixture and live sources cannot be mixed.');
    bounded(c.budget.connectorCaps[id],`Request cap for ${id}`,1,100000,true);
  }
  if (c.agentConnectorIds) for (const [agent, ids] of Object.entries(c.agentConnectorIds)) {
    if (!/^agent-\d+$/.test(agent) || Number(agent.slice(6)) < 1 || Number(agent.slice(6)) > c.swarmSize || !Array.isArray(ids) || ids.some(id=>!c.connectorIds.includes(id))) throw new AppError(400,'An agent source subset may only narrow the run selection.');
  }
  return c;
}
