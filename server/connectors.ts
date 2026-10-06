import { createHash } from 'node:crypto';
import type { Connector } from '../shared/types.js';

export interface SourceItem {
  title: string;
  locator: string;
  content: string;
  sourceId: string;
  sourceOrigin: string;
  publishedAt: string | null;
  eventAt: string | null;
  format: 'fixture_record' | 'search_snippet';
  metadata?: Record<string, unknown>;
}
export interface ConnectorResponse { items: SourceItem[]; raw: unknown; credits: number }
export interface SearchRequest { query: string; kind: string; segment?: string; target?: string; attempt?: number }
export const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

/** Intentionally fictional records. Fixture mode never implies that a live search happened. */
export const FIXTURE_COMPANIES = [
  { name: 'Northstar Components', domain: 'northstar-components.example', sector: 'Specialist manufacturing', country: 'United Kingdom', headcount: 640, ceo: 'Alex Morgan', contact: 'Priya Shah', role: 'Group Financial Controller', pain: true, date: '2026-05-12' },
  { name: 'Meridian Industrial', domain: 'meridian-industrial.example', sector: 'Industrials', country: 'Ireland', headcount: 820, ceo: 'Niamh Byrne', contact: 'Daniel Reed', role: 'Finance Transformation Director', pain: true, date: '2026-03-24' },
  { name: 'Alder Distribution', domain: 'alder-distribution.example', sector: 'Distribution', country: 'United Kingdom', headcount: 420, ceo: 'Sam Patel', contact: 'Emma Clarke', role: 'Head of Accounts Payable', pain: true, date: '2026-06-03' },
  { name: 'Strata Precision', domain: 'strata-precision.example', sector: 'Specialist manufacturing', country: 'Ireland', headcount: 310, ceo: 'Orla Kelly', contact: 'Alex Morgan', role: 'Finance Director', pain: true, date: '2026-01-18' },
  { name: 'Harbour Supply Group', domain: 'harbour-supply.example', sector: 'Distribution', country: 'United Kingdom', headcount: 1100, ceo: 'Tom Wilson', contact: 'Leah Evans', role: 'Group Finance Director', pain: true, date: '2026-04-07' },
  { name: 'Cobalt Works', domain: 'cobalt-works.example', sector: 'Industrials', country: 'United Kingdom', headcount: 260, ceo: 'Grace Chen', contact: 'Ben Thomas', role: 'Financial Controller', pain: false, date: null },
] as const;

export function fixtureItems(request: SearchRequest): SourceItem[] {
  const rows = request.target
    ? FIXTURE_COMPANIES.filter(c => c.name === request.target || c.domain === request.target)
    : request.attempt && request.attempt > 1 ? [] : FIXTURE_COMPANIES.filter(c => !request.segment || c.sector.toLowerCase().includes(request.segment.toLowerCase()));
  return rows.flatMap(c => {
    const text = `FICTIONAL TEST FIXTURE — not real-world research.\n${c.name} (${c.domain}) is a private-equity-backed ${c.sector} company in ${c.country} with ${c.headcount} employees.\n${c.pain ? 'After acquiring two businesses, the finance team manually reconciles supplier invoices across three ERP systems.' : 'The company reports that supplier invoice reconciliation is fully automated on a single ERP system.'}\n${c.ceo} is the current CEO. ${c.contact} is the current ${c.role}.\n${c.date ? `On ${c.date}, the company announced an ERP integration programme and a finance transformation vacancy.` : 'No publication date or recent demand signal is available.'}`;
    const base = { sourceId: c.domain, publishedAt: c.date, eventAt: c.date, format: 'fixture_record' as const, metadata: { ...c, fictional: true } };
    return [
      { ...base, title: `${c.name} — fictional company record`, locator: `fixture://${c.domain}/company`, sourceOrigin: `fixture-company:${c.domain}`, content: text },
      { ...base, title: `${c.name} — fictional independent trade record`, locator: `fixture://trade-journal.example/${c.domain}`, sourceOrigin: `fixture-trade:${c.domain}`, content: `FICTIONAL INDEPENDENT TEST RECORD.\n${c.name}, ${c.domain}, ${c.country}, ${c.headcount} employees, ${c.sector}.\n${c.pain ? 'Our fictional interview confirms manual supplier invoice reconciliation following acquisitions and separate ERP systems.' : 'Our fictional interview confirms fully automated reconciliation; this company does not meet the example pain.'}\nCurrent leadership: CEO ${c.ceo}; ${c.role} ${c.contact}.\n${c.date ? `ERP integration programme reported ${c.date}.` : 'Date unknown.'}` },
    ];
  });
}

export function getConnectors(): Connector[] {
  return [
    { id: 'fixture-web', name: 'Example research corpus', provider: 'fixture', account: 'Local fictional fixture', mode: 'fixture', capabilities: ['search'], available: true, freshness: 'Fictional records dated 2026 · local only', estimatedCost: 'Free · no external calls', scope: 'Fictional test records only', costPerCall: 0, quotaKey: 'fixture', private: false, version: 'fixture-v1' },
    { id: 'tavily', name: 'Tavily web search', provider: 'tavily', account: 'Local API key', mode: 'live', capabilities: ['search'], available: Boolean(process.env.TAVILY_API_KEY), freshness: 'Live web search; dates only where returned', estimatedCost: '1 credit per basic search; configured USD reserve', scope: 'Public web search snippets', costPerCall: Number(process.env.TAVILY_MAX_CALL_USD || 0), quotaKey: 'tavily-local', private: false, reason: process.env.TAVILY_API_KEY ? undefined : 'Set TAVILY_API_KEY to enable web research', version: 'tavily-search-v1' },
  ];
}

export async function searchConnector(connectorId: string, request: SearchRequest, signal: AbortSignal): Promise<ConnectorResponse> {
  signal.throwIfAborted();
  if (connectorId === 'fixture-web') {
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 180);
      signal.addEventListener('abort', abort, { once: true });
    });
    const items = fixtureItems(request);
    return { items, raw: { fixture: true, query: request, results: items }, credits: 0 };
  }
  if (connectorId !== 'tavily' || !process.env.TAVILY_API_KEY) throw new Error('Connector unavailable or unauthorized');
  // Only a fixed provider endpoint is fetched. Source URLs are never fetched implicitly.
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    headers: { Authorization: `Bearer ${process.env.TAVILY_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: request.query.slice(0, 1800), search_depth: 'basic', max_results: 6, include_raw_content: false, include_answer: false, include_usage: true, auto_parameters: false }),
  });
  // Bound transport memory; partial bytes are returned for durable capture, never model input.
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Search returned no response body');
  const parts: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.length; parts.push(value);
      if (bytes > 2_000_000) { await reader.cancel(); throw new PartialResponseError(Buffer.concat(parts).toString('utf8')); }
    }
  }catch(error){
    if(error instanceof PartialResponseError)throw error;
    if(parts.length)throw new PartialResponseError(Buffer.concat(parts).toString('utf8'),'Search transport interrupted; received bytes retained as partial, not used for research');
    throw error;
  }
  const text = Buffer.concat(parts).toString('utf8');
  if (!response.ok) throw new CapturedResponseError(`Tavily search failed (HTTP ${response.status})`,text);
  let raw: { results?: Array<Record<string, unknown>>; usage?: { credits?: number } };
  try { raw=JSON.parse(text); } catch { throw new CapturedResponseError('Tavily returned invalid JSON',text); }
  if(!raw||typeof raw!=='object'||!Array.isArray(raw.results)||raw.results.some(result=>!result||typeof result!=='object'))throw new CapturedResponseError('Tavily returned an invalid result inventory',text);
  const items = (raw.results ?? []).map((result, i): SourceItem => {
    const locator = String(result.url ?? '');
    let origin = 'unknown'; try { origin = new URL(locator).hostname.toLowerCase().replace(/^www\./, ''); } catch { /* retain the unknown locator */ }
    const published = typeof result.published_date === 'string' && !Number.isNaN(Date.parse(result.published_date)) ? new Date(result.published_date).toISOString() : null;
    return { title: String(result.title ?? 'Untitled search result'), locator, content: String(result.content ?? ''), sourceId: String(result.id ?? locator ?? i), sourceOrigin: origin, publishedAt: published, eventAt: null, format: 'search_snippet' };
  });
  return { items, raw, credits: raw.usage?.credits ?? 1 };
}

export class PartialResponseError extends Error {
  constructor(readonly partial: string,message='Search response exceeded the 2 MB transport cap; received bytes retained as partial, not used for research') { super(message); }
}
export class CapturedResponseError extends Error {
  constructor(message: string, readonly rawBody: string) { super(message); }
}
