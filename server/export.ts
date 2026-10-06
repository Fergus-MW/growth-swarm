import { createHash } from 'node:crypto';
import { strToU8, zipSync } from 'fflate';
import type { GraphNode, RunState } from '../shared/types.js';
import { evaluateQuality, proseLinks } from './validation.js';

/** Filenames are presentation only. A hash of the opaque ID prevents collisions. */
export function safeFilename(title: string, id: string): string {
  const stem = title.normalize('NFKC').replace(/[^\p{L}\p{N} _-]/gu, '').trim().replace(/\s+/g, '-').slice(0, 80) || 'Untitled';
  return `${stem}-${createHash('sha256').update(id).digest('hex').slice(0, 12)}`;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

export function safeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

/** Neutralize active HTML, images, and all arbitrary markdown links in portable prose.
 * Exact source bytes are preserved separately in text/JSON artifacts. */
export function safeMarkdown(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/!\[([^\]]*)\]\([^\n]*?\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^\n]*?\)/g, '$1')
    .replace(/^\s*\[[^\]]+\]:.*$/gm, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

function topology(state: RunState) {
  return {
    version: 1,
    revision: state.run.revision,
    nodes: state.nodes.map(node => ({ id: node.id, label: node.title, kind: node.category === 'source_chunk' ? 'chunk' : 'entity', category: node.category })),
    edges: state.edges.map(edge => ({ ...edge, sourceObjectType: state.nodes.find(node => node.id === edge.source)?.category === 'source_chunk' ? 'chunk' : 'entity', targetObjectType: state.nodes.find(node => node.id === edge.target)?.category === 'source_chunk' ? 'chunk' : 'entity', edgeFamily: [edge.source, edge.target].some(id => state.nodes.find(node => node.id === id)?.category === 'source_chunk') ? 'chunk_entity' : 'entity_entity' })),
  };
}

export function exportRunJson(state: RunState): string {
  return JSON.stringify({
    format: 'auto-research-interchange', version: 1, exportedAt: new Date().toISOString(),
    warning: 'Private research artifact. Source access restrictions apply to all derived content. Candidates are not canonical platform entities.',
    quality: evaluateQuality(state), topology: topology(state),
    details: { version: 1, nodes: state.nodes, assertions: state.assertions, invocations: state.invocations },
    state,
  }, null, 2);
}

function folder(node: GraphNode): string {
  if (node.category === 'source_chunk') return 'Sources';
  if (node.category === 'primary_entity') return /person|people/i.test(node.entityType ?? '') ? 'People' : /company|organisation|organization/i.test(node.entityType ?? '') ? 'Organisations' : `Entities/${safeFilename(node.entityType ?? 'Other', node.entityType ?? 'Other')}`;
  const folders: Record<string, string> = { session: 'Sessions', person: 'People notes', organisation: 'Organisation notes', position: 'Positions', practice: 'Practices', framework: 'Frameworks', evidence: 'Evidence', question: 'Questions', meta: 'Meta' };
  return folders[node.editorialType ?? 'meta'] ?? 'Meta';
}

function vaultNames(state: RunState): Map<string, string> {
  return new Map(state.nodes.map(node => [node.id, `${folder(node)}/${safeFilename(node.title, node.id)}`]));
}

function canonicalProse(body: string, state: RunState, names: Map<string, string>): string {
  const valid = new Set(proseLinks(body));
  const neutralized = body.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`]*`/g, code => code.replace(/\[\[/g, '\uFF3B\uFF3B').replace(/\]\]/g, '\uFF3D\uFF3D'));
  return safeMarkdown(neutralized).replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_match, target: string, label?: string) => {
    if (!valid.has(target.trim())) return `\uFF3B\uFF3B${target}\uFF3D\uFF3D`;
    const matches = state.nodes.filter(node => node.id === target.trim() || node.title === target.trim() || node.aliases.includes(target.trim()));
    if (matches.length !== 1) return `${label ?? target} (unresolved reference)`;
    return `[[${names.get(matches[0].id)!.split('/').at(-1)}|${label ?? matches[0].title}]]`;
  });
}

function evidenceMarkdown(node: GraphNode, names: Map<string, string>): string {
  const refs = [...node.evidence, ...Object.values(node.fieldEvidence ?? {}).flat()];
  return refs.length ? '\n\n## Evidence\n\n' + refs.map(ref => `- [[${names.get(ref.chunkId)?.split('/').at(-1) ?? safeFilename('Missing source', ref.chunkId)}]] · ${ref.polarity} · offsets ${ref.start}–${ref.end}\n  > ${safeMarkdown(ref.quote).replace(/\n/g, '\n  > ')}`).join('\n') : '';
}

/** Call only after the run and every source dependency have passed the read authorization. */
export function exportVault(state: RunState, artifacts: Record<string, Uint8Array | string> = {}): Uint8Array {
  const files: Record<string, Uint8Array> = Object.create(null);
  const put = (path: string, value: string) => { files[path] = strToU8(value); };
  const names = vaultNames(state), quality = evaluateQuality(state);
  for (const node of state.nodes) {
    const name = names.get(node.id)!;
    const metadata = { id: node.id, category: node.category, entityType: node.entityType ?? null, editorialType: node.editorialType ?? null, semanticKind: node.semanticKind ?? null, aliases: node.aliases, provenance: node.provenance ?? 'connector_capture', version: node.version, access: node.access, originRunId: node.originRunId };
    // JSON scalar encoding is also valid YAML and prevents frontmatter delimiter injection.
    let markdown = '---\n' + Object.entries(metadata).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n') + `\n---\n\n# ${safeMarkdown(node.title)}\n\n`;
    if (node.fields) markdown += '## Typed fields\n\n' + Object.entries(node.fields).map(([key, value]) => `- **${safeMarkdown(key)}:** ${safeMarkdown(value === null ? 'Unknown' : typeof value === 'string' ? value : JSON.stringify(value))}`).join('\n') + '\n\n## Research\n\n';
    markdown += canonicalProse(node.body, state, names) + evidenceMarkdown(node, names);
    if (node.source) {
      markdown += '\n\n## Source provenance\n\n' + Object.entries(node.source).map(([key, value]) => `- **${key}:** ${safeMarkdown(value === null ? 'Unknown' : typeof value === 'string' ? value : JSON.stringify(value))}`).join('\n');
      put(`${name}.txt`, node.body);
      put(`${name}.json`, JSON.stringify(node, null, 2));
    }
    put(`${name}.md`, markdown + '\n');
  }
  const sourceNodes = state.nodes.filter(node => node.category === 'source_chunk');
  put('Start Here.md', `# ${safeMarkdown(state.run.title)}\n\nPrivate research export · revision ${state.run.revision} · ${state.run.outcome}\n\n${quality.passed ? 'Deterministic quality gates pass.' : '**Partial result: quality gates remain unmet.**'}\n\n[[Provenance and limitations]] · [[Source ledger]]\n\n## Authored research\n\n${state.nodes.filter(node => node.category !== 'source_chunk').map(node => `- [[${names.get(node.id)!.split('/').at(-1)}|${safeMarkdown(node.title)}]] (${node.category})`).join('\n')}\n`);
  put('Provenance and limitations.md', `# Provenance and limitations\n\nObjective: ${safeMarkdown(state.run.config.objective)}\n\nUniverse: ${safeMarkdown(state.run.config.universe)}\n\nExclusions: ${safeMarkdown(state.run.config.exclusions)}\n\nOutcome: ${state.run.outcome}. Assessment: ${state.run.assessmentVersion}. Graph revision: ${state.run.revision}.\n\nSource restrictions are preserved in each file and the interchange. A retrieved source is not proof of a claim. Exact spans establish citation integrity, not entailment. Bounded saturation does not prove exhaustive coverage. Unknown dates remain unknown.\n\n## Quality diagnostics\n\n${quality.gates.map(gate => `- ${gate.pass ? 'PASS' : 'UNMET'}: ${gate.label}: ${gate.actual}; required ${gate.required}.${gate.details.length ? '\n' + gate.details.map(detail => `  - ${safeMarkdown(detail)}`).join('\n') : ''}`).join('\n')}\n`);
  put('Source ledger.md', `# Source ledger\n\nAll ${sourceNodes.length} stored source chunks, including uncited and irrelevant results. Navigation does not turn these sources into research findings.\n\n${sourceNodes.map(node => `- [[${names.get(node.id)!.split('/').at(-1)}|${safeMarkdown(node.title)}]] · ${safeMarkdown(node.source?.provider ?? '')} · ${safeMarkdown(node.source?.locator ?? 'Private or unavailable locator')}`).join('\n')}\n\n## Invocations\n\n${state.invocations.map(invocation => `- ${invocation.id}: ${invocation.status}; ${invocation.returnedCount} returned; ${invocation.chunkIds.length} chunks; ${safeMarkdown(invocation.query)}`).join('\n')}\n`);
  put('research-interchange.json', exportRunJson(state));
  put('quality.json', JSON.stringify(quality, null, 2));
  put('Source artifacts/invocations.json', JSON.stringify(state.invocations, null, 2));
  for (const [path, content] of Object.entries(artifacts)) {
    if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').some(part => part === '..' || part === '.' || !part) || /[\u0000-\u001f:]/.test(path)) throw new Error('Unsafe source artifact export path.');
    files[`Source artifacts/${path}`] = typeof content === 'string' ? strToU8(content) : content;
  }
  return zipSync(files, { level: 6 });
}

/** A static private reader: escaped text only, no executable scripts or remote assets. */
export function exportHtml(state: RunState): string {
  const quality = evaluateQuality(state);
  const sections = state.nodes.map(node => {
    const locator = safeUrl(node.source?.locator);
    const refs = [...node.evidence, ...Object.values(node.fieldEvidence ?? {}).flat()].map(ref => `<li><a href="#${escapeHtml(ref.chunkId)}">${escapeHtml(state.nodes.find(source => source.id === ref.chunkId)?.title ?? ref.chunkId)}</a> · ${escapeHtml(ref.polarity)} · offsets ${ref.start}–${ref.end}<blockquote>${escapeHtml(ref.quote)}</blockquote></li>`).join('');
    const relations = state.edges.filter(edge => edge.source === node.id).map(edge => `<li>${escapeHtml(edge.relation)} → <a href="#${escapeHtml(edge.target)}">${escapeHtml(state.nodes.find(target => target.id === edge.target)?.title ?? edge.target)}</a> · ${escapeHtml(edge.polarity)}${edge.historical ? ' · historical' : ''}</li>`).join('');
    return `<article id="${escapeHtml(node.id)}"><p class="category">${escapeHtml(node.category)} · ${escapeHtml(node.entityType ?? node.semanticKind ?? node.source?.provider ?? '')}</p><h2>${escapeHtml(node.title)}</h2>${node.fields ? `<dl>${Object.entries(node.fields).map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value === null ? 'Unknown' : typeof value === 'string' ? value : JSON.stringify(value))}</dd>`).join('')}</dl>` : ''}<pre>${escapeHtml(node.body)}</pre>${node.source ? `<p>Source: ${locator ? `<a href="${escapeHtml(locator)}" rel="noreferrer noopener">${escapeHtml(locator)}</a>` : escapeHtml(node.source.locator ?? 'Private or unavailable locator')}</p><p>Published: ${escapeHtml(node.source.publishedAt ?? 'Unknown')} · Event: ${escapeHtml(node.source.eventAt ?? 'Unknown')} · Fetched: ${escapeHtml(node.source.fetchedAt)}</p>` : ''}${refs ? `<h3>Evidence passages</h3><ul>${refs}</ul>` : ''}${relations ? `<h3>Relationships</h3><ul>${relations}</ul>` : ''}<details><summary>Access and provenance</summary><pre>${escapeHtml(JSON.stringify({ id: node.id, originRunId: node.originRunId, access: node.access, source: node.source, evidence: node.evidence }, null, 2))}</pre></details><p><a href="#index">Back to index</a></p></article>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none';"><title>${escapeHtml(state.run.title)} · Auto Research</title><style>body{margin:0;background:#111713;color:#e5e8df;font:16px/1.6 system-ui}main{max-width:960px;margin:auto;padding:32px}a{color:#b9e88a}h1,h2{line-height:1.2}article{border:1px solid #414b3c;border-radius:12px;padding:24px;margin:24px 0;scroll-margin-top:16px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}dt{font-weight:700}dd{margin:0 0 12px}blockquote{border-left:3px solid #91aa75;padding-left:16px}.category{color:#a3ac9c;font-size:13px}nav ul{columns:2}.warning{background:#4c371e;padding:16px;border-radius:8px}@media(max-width:600px){main{padding:16px}nav ul{columns:1}}</style></head><body><main><header id="index"><p>Private research export · revision ${state.run.revision}</p><h1>${escapeHtml(state.run.title)}</h1><p>${escapeHtml(state.run.config.objective)}</p><p>Outcome: ${escapeHtml(state.run.outcome)} · ${state.nodes.length} objects · ${state.edges.length} relationships</p><p class="warning">${quality.passed ? 'Deterministic gates pass.' : 'Partial result. Unmet quality gates remain visible below.'} Source access restrictions apply. Bounded saturation does not prove exhaustive coverage.</p><details open><summary>Quality diagnostics</summary><ul>${quality.gates.map(gate => `<li>${gate.pass ? 'PASS' : 'UNMET'} — ${escapeHtml(gate.label)}: ${escapeHtml(gate.actual)}; required ${escapeHtml(gate.required)}${gate.details.length ? `<ul>${gate.details.map(detail => `<li>${escapeHtml(detail)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ul></details></header><nav aria-label="Research index"><h2>Research and source index</h2><ul>${state.nodes.map(node => `<li><a href="#${escapeHtml(node.id)}">${escapeHtml(node.title)}</a> <small>${escapeHtml(node.category)}</small></li>`).join('')}</ul></nav>${sections}</main></body></html>`;
}
