import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GraphSession, type SessionClock } from './session';
import { frameTransform } from './frame';
import { degrees } from './style';
import type { GraphLink, GraphPoint, GraphUploader, ViewTransform } from './types';

const point = (id: string): GraphPoint => ({ id, label: id, category: 'primary_entity', typeKey: 'company' });
const edge = (id: string, source = 'a', target = 'b'): GraphLink => ({ id, source, target, relation: 'evidences', family: 'evidence', polarity: 'supports', weight: 1 });
const viewport = () => ({ width: 800, height: 600, insets: { left: 40, right: 20, top: 10, bottom: 30 } });

class Upload implements GraphUploader {
  positions = new Float32Array();
  positionInputs: Float32Array[] = [];
  links = new Float32Array();
  colorInputs: Float32Array[] = [];
  setPointPositions(data: Float32Array) { this.positions = data.slice(); this.positionInputs.push(data); }
  setPointColors(data: Float32Array) { this.colorInputs.push(data); }
  setPointSizes() {}
  setPointShapes() {}
  setLinks(data: Float32Array) { this.links = data.slice(); }
  setLinkColors() {}
  setLinkWidths() {}
  setLinkStyles() {}
  getPointPositions() { return this.positions; }
  render = vi.fn();
  pause = vi.fn();
  start = vi.fn();
  setViewTransform = vi.fn<(view: ViewTransform, duration: number) => void>();
  focusIndex = vi.fn();
}
function fixture() {
  const clock: SessionClock = { now: () => Date.now(), schedule: fn => Number(setTimeout(fn, 16)), later: (fn, ms) => Number(setTimeout(fn, ms)), cancel: id => clearTimeout(id) };
  const uploader = new Upload(), resync = vi.fn();
  return { graph: new GraphSession(uploader, clock, false, [[1, 0, 0]], viewport, resync), uploader, resync };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('graph update regressions', () => {
  it('does not duplicate an id when a deleted point is inserted again', () => {
    const {graph, uploader} = fixture();
    graph.applyDelta({upsertNodes: [point('a'), point('b')], upsertEdges: [edge('e')]});
    graph.applyDelta({removeNodeIds: ['a']});
    graph.applyDelta({upsertNodes: [point('a')], upsertEdges: [edge('e')]});
    expect(uploader.positions).toHaveLength(4);
    expect(new Set([graph.selectId(0), graph.selectId(1)]).size).toBe(2);
    expect(graph.selectId(2)).toBeNull();
  });
  it('removes queued edges when deleted before their endpoint arrives', () => {
    const {graph, uploader} = fixture();
    graph.applyDelta({upsertEdges: [edge('e')]});
    graph.applyDelta({removeEdgeIds: ['e']});
    graph.applyDelta({upsertNodes: [point('a'), point('b')]});
    expect(uploader.links).toHaveLength(0);
  });
  it('does not resurrect queued edges after deleting and recreating a node', () => {
    const {graph, uploader} = fixture();
    graph.applyDelta({upsertNodes: [point('a')], upsertEdges: [edge('e')]});
    graph.applyDelta({removeNodeIds: ['a']});
    graph.applyDelta({upsertNodes: [point('a'), point('b')]});
    expect(uploader.links).toHaveLength(0);
  });
  it('keeps the latest edge revision when a queued edge changes endpoints', () => {
    const {graph, uploader} = fixture();
    graph.applyDelta({upsertNodes: [point('a'),point('c')], upsertEdges: [edge('e')]});
    graph.applyDelta({upsertEdges: [edge('e','a','c')]});
    graph.applyDelta({upsertNodes: [point('b')]});
    expect(Array.from(uploader.links)).toEqual([0,1]);
  });
  it('replaces pending deltas with an authoritative snapshot', () => {
    const {graph, uploader} = fixture();
    graph.applyDelta({upsertEdges: [edge('e')]});
    graph.replaceVisible({nodes:[point('a'),point('b')],edges:[]});
    expect(uploader.links).toHaveLength(0);
  });
  it('expires a missing endpoint even if no new graph events arrive', () => {
    const {graph,resync} = fixture();
    graph.applyDelta({upsertEdges: [edge('e')]});
    vi.advanceTimersByTime(8001);
    expect(resync).toHaveBeenCalledWith('pending-expired');
  });
  it('reuses point buffers for visual updates and never uploads spare capacity', () => {
    const {graph,uploader} = fixture();
    graph.replaceVisible({nodes:[point('a'),point('b')],edges:[edge('e')]});
    graph.replaceVisible({nodes:[{...point('a'),typeKey:'person'},point('b')],edges:[edge('e')]});
    expect(uploader.colorInputs[0].buffer).toBe(uploader.colorInputs[1].buffer);
    expect(uploader.colorInputs[1]).toHaveLength(8);
    expect(uploader.positionInputs).toHaveLength(1);
  });
  it('uses current simulated positions when fitting the settled graph', () => {
    const {graph,uploader} = fixture();
    graph.replaceVisible({nodes:[point('a'),point('b')],edges:[edge('e')]});
    uploader.positions = new Float32Array([100,200,180,250]);
    graph.noteAlphaSettled();
    expect(uploader.setViewTransform).toHaveBeenLastCalledWith(frameTransform([100,180],[200,250],viewport()),300);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels all work on destroy and ignores later calls', () => {
    const {graph,uploader,resync} = fixture();
    graph.submit({nodes:[point('a')],edges:[]});
    graph.destroy();
    graph.submit({nodes:[point('b')],edges:[]});
    graph.applyDelta({upsertNodes:[point('c')]});
    graph.replaceVisible({nodes:[point('d')],edges:[]});
    graph.fitView();
    vi.runAllTimers();
    expect(uploader.render).not.toHaveBeenCalled();
    expect(uploader.setViewTransform).not.toHaveBeenCalled();
    expect(resync).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not count a dangling relation toward degree or relevance', () => {
    expect(degrees(['a'],[edge('e')]).get('a')).toEqual({degree:0,averageWeight:0});
  });
  it('rejects non-finite viewport sizes and insets', () => {
    expect(frameTransform([10],[20],{...viewport(),width:NaN})).toBeNull();
    expect(frameTransform([10],[20],{...viewport(),insets:{...viewport().insets,left:Infinity}})).toBeNull();
  });
});
