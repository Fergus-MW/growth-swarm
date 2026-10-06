import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { exportHtml, exportRunJson, exportVault, safeFilename, safeMarkdown } from '../server/export.ts';
import { node, qualifiedState, source, state } from './research-fixtures.ts';

test('vault keeps all categories, exact raw source, safe unique filenames, restrictions and partial diagnostics', () => {
  const snapshot = qualifiedState();
  snapshot.nodes.push(source('unused', '<script>alert(1)</script>\nUncited source text.'));
  snapshot.nodes[3].title = '../../company <script>'; snapshot.nodes[3].body = 'Research about [[pain]].';
  const files = unzipSync(exportVault(snapshot, { 'response.json': '{"raw":true}' }));
  const paths = Object.keys(files);
  assert.ok(paths.includes('Start Here.md')); assert.ok(paths.includes('Source ledger.md'));
  assert.ok(paths.some(path => path.startsWith('Organisations/'))); assert.ok(paths.some(path => path.startsWith('Practices/')));
  assert.ok(paths.every(path => !path.includes('..') && !path.includes('<script>')));
  assert.ok(paths.some(path => path.endsWith('.txt') && strFromU8(files[path]) === snapshot.nodes.at(-1)!.body));
  assert.match(strFromU8(files['Start Here.md']), /Partial result/);
  assert.match(strFromU8(files['Source artifacts/response.json']), /"raw":true/);
  const companyMd = strFromU8(files[paths.find(path => path.startsWith('Organisations/') && path.endsWith('.md'))!]);
  assert.match(companyMd, /Typed fields/); assert.match(companyMd, /fixture-web/); assert.match(companyMd, /\[\[pain-[a-f0-9]+\|pain\]\]/);
});

test('interchange includes topology, details, assertions, operational state and typed evidence', () => {
  const snapshot = qualifiedState(), payload = JSON.parse(exportRunJson(snapshot));
  assert.equal(payload.version, 1);
  assert.deepEqual(payload.state, snapshot);
  assert.equal(payload.topology.nodes.find((n: { id: string }) => n.id === 'a').kind, 'chunk');
  assert.equal(payload.topology.nodes.find((n: { id: string }) => n.id === 'pain').category, 'note');
  assert.equal(payload.topology.edges[0].sourceObjectType, 'entity');
  assert.deepEqual(payload.details.nodes, snapshot.nodes);
});

test('private HTML is self-contained and renders hostile content as inert text', () => {
  const hostile = node('evil" onclick="alert(1)', { title: '<script>alert(1)</script>', body: '<img src=x onerror=alert(1)> [unsafe](javascript:alert(1))' });
  const chunk = source(); chunk.source!.locator = 'javascript:alert(1)';
  const html = exportHtml(state([hostile, chunk]));
  assert.ok(!html.includes('<script>')); assert.ok(!html.includes('<img')); assert.ok(!html.includes('href="javascript:'));
  assert.match(html, /&lt;script&gt;/); assert.match(html, /Content-Security-Policy/); assert.match(html, /default-src 'none'/);
});

test('archive rejects path traversal and safe names disambiguate duplicate titles', () => {
  assert.throws(() => exportVault(state(), { '../outside': 'bad' }), /Unsafe/);
  assert.throws(() => exportVault(state(), { '/absolute': 'bad' }), /Unsafe/);
  assert.notEqual(safeFilename('Same name', 'a'), safeFilename('Same name', 'b'));
  assert.doesNotMatch(safeMarkdown('<iframe src="https://bad"> [run](javascript:evil) ![x](https://tracker)'), /<iframe|javascript:|https:\/\/tracker/);
});
