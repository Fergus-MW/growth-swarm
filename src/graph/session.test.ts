import { describe, expect, it } from "vitest";
import { cosmosMountConfig } from "./config.ts";
import { frameTransform } from "./frame.ts";
import { GraphSession, type SessionClock } from "./session.ts";
import { pointSize, relevance, seedPosition } from "./style.ts";
import type { GraphLink, GraphPoint, GraphUploader, ViewTransform } from "./types.ts";

class RecordingUploader implements GraphUploader {
  positions = new Float32Array();
  colors = new Float32Array();
  sizes = new Float32Array();
  links = new Float32Array();
  widths = new Float32Array();
  styles = new Float32Array();
  linkColors = new Float32Array();
  shapes = new Float32Array();
  views: { transform: ViewTransform; durationMs: number }[] = [];
  starts: number[] = [];
  pauses = 0;
  shifted = false;

  setPointPositions(data: Float32Array): void {
    this.positions = data.slice();
    if (this.shifted) for (let i = 0; i < this.positions.length; i += 2) this.positions[i] = (this.positions[i] ?? 0) + 25;
  }
  setPointColors(data: Float32Array): void { this.colors = data.slice(); }
  setPointSizes(data: Float32Array): void { this.sizes = data.slice(); }
  setPointShapes(data: Float32Array): void { this.shapes = data.slice(); }
  setLinks(data: Float32Array): void { this.links = data.slice(); }
  setLinkColors(data: Float32Array): void { this.linkColors = data.slice(); }
  setLinkWidths(data: Float32Array): void { this.widths = data.slice(); }
  setLinkStyles(data: Float32Array): void { this.styles = data.slice(); }
  getPointPositions(): Float32Array { return this.positions.slice(); }
  render(): void {}
  pause(): void { this.pauses += 1; }
  start(alpha: number): void { this.starts.push(alpha); }
  setViewTransform(transform: ViewTransform, durationMs: number): void { this.views.push({ transform, durationMs }); }
  focusIndex(): void {}
}

function clock(now = 0): SessionClock & { run(): void; fire(): void } {
  const queued: (() => void)[] = [];
  const later: (() => void)[] = [];
  return {
    now: () => now,
    schedule: (run) => { queued.push(run); return queued.length; },
    later: (run) => { later.push(run); return later.length; },
    cancel: () => {},
    run: () => { const job = queued.shift(); job?.(); },
    fire: () => { const job = later.shift(); job?.(); },
  };
}

const palette: [number, number, number][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [0, 1, 1]];
const viewport = () => ({ width: 800, height: 600, insets: { left: 40, right: 20, top: 10, bottom: 30 } });

function point(id: string, category: GraphPoint["category"] = "primary_entity", typeKey = "company"): GraphPoint {
  return { id, label: id, category, typeKey };
}
function link(id: string, source: string, target: string, family: GraphLink["family"] = "evidence", polarity: GraphLink["polarity"] = "supports", weight = 1): GraphLink {
  return { id, source, target, relation: family === "context" ? "retrieved_for" : "evidences", family, polarity, weight };
}

function session(uploader = new RecordingUploader(), timer = clock(), reduced = false) {
  const resyncs: string[] = [];
  const graph = new GraphSession(uploader, timer, reduced, palette, viewport, (reason) => resyncs.push(reason));
  return { graph, uploader, timer, resyncs };
}

describe("cosmos mount config", () => {
  it("uses one space, seed, and a capped pixel ratio", () => {
    const config = cosmosMountConfig({ pixelRatio: 3, reducedMotion: false });
    expect(config).toMatchObject({ spaceSize: 2048, randomSeed: 1, simulationCollision: 0, rescalePositions: false, pixelRatio: 1.5, scalePointsOnZoom: false, scaleLinksOnZoom: false, enableSimulation: true, transitionDuration: 0 });
    expect(cosmosMountConfig({ pixelRatio: 1, reducedMotion: true }).enableSimulation).toBe(false);
  });
});

describe("graph session", () => {
  it("seeds by id, not arrival order, and sizes the formulas", () => {
    expect(seedPosition("acme")).toEqual(seedPosition("acme"));
    expect(seedPosition("acme")).not.toEqual(seedPosition("other"));
    expect(relevance(0, 0, Number.NaN)).toBe(0);
    expect(pointSize(20, 1)).toBeCloseTo(4 + 5 + 16 * 0.2);
    const { graph, uploader, timer } = session();
    graph.submit({ nodes: [point("b"), point("a")], edges: [] });
    graph.submit({ nodes: [point("a"), point("b")], edges: [link("e", "a", "b")] });
    timer.run();
    expect(uploader.positions.length).toBe(4);
    expect(uploader.links.length).toBe(2);
    expect(uploader.sizes.length).toBe(2);
    expect(uploader.starts).toEqual([1]);
  });

  it("keeps simulated positions for survivors and does not reupload seeds for a colour change", () => {
    const uploader = new RecordingUploader();
    const timer = clock();
    const { graph } = session(uploader, timer);
    graph.replaceVisible({ nodes: [point("acme"), point("note", "note", "pain")], edges: [link("e", "acme", "note")] });
    const first = uploader.positions.slice();
    uploader.shifted = true;
    graph.replaceVisible({ nodes: [point("acme"), point("note", "note", "pain"), point("chunk", "source_chunk", "chunk")], edges: [link("e", "acme", "note")] });
    expect(uploader.positions[0]).toBeCloseTo((first[0] ?? 0) + 25);
    expect(uploader.positions[2]).toBeCloseTo((first[2] ?? 0) + 25);
    const uploads = uploader.positions.length;
    graph.replaceVisible({ nodes: [point("acme", "primary_entity", "manufacturer"), point("note", "note", "pain"), point("chunk", "source_chunk", "chunk")], edges: [link("e", "acme", "note", "evidence", "contradicts")] });
    expect(graph.stats.positionUploads).toBe(2);
    expect(uploader.positions.length).toBe(uploads);
    expect(uploader.colors[4]).toBeCloseTo(0.72);
  });

  it("hides filtered nodes without reseeding them and drops edges that leave the snapshot", () => {
    const { graph, uploader } = session();
    graph.replaceVisible({ nodes: [point("acme"), point("chunk", "source_chunk", "chunk")], edges: [link("e", "acme", "chunk", "context")] });
    uploader.shifted = true;
    graph.replaceVisible({ nodes: [point("acme")], edges: [link("e", "acme", "chunk", "context")] });
    const kept = uploader.positions[0];
    expect(uploader.positions.length).toBe(2);
    expect(uploader.links.length).toBe(0);
    uploader.shifted = false;
    graph.replaceVisible({ nodes: [point("acme"), point("chunk", "source_chunk", "chunk")], edges: [link("e", "acme", "chunk", "context")] });
    expect(uploader.positions[0]).toBeCloseTo(kept ?? 0);
  });

  it("queues an early edge, then asks for a resync instead of dropping a burst", () => {
    const { graph, uploader, resyncs } = session();
    graph.applyDelta({ upsertEdges: [link("early", "acme", "note")] });
    expect(uploader.links.length).toBe(0);
    graph.applyDelta({ upsertNodes: [point("acme"), point("note", "note", "pain")] });
    expect(uploader.links.length).toBe(2);
    const burst = Array.from({ length: 501 }, (_, index) => link(`p${index}`, "missing", "also-missing", "context"));
    graph.applyDelta({ upsertEdges: burst });
    expect(resyncs).toContain("pending-overflow");
  });

  it("remaps a merge and ignores focus on a deleted point", () => {
    const { graph, uploader } = session();
    graph.applyDelta({ upsertNodes: [point("stub"), point("acme")], upsertEdges: [link("e", "stub", "acme")] });
    graph.applyDelta({ merges: [{ from: "stub", to: "acme" }] });
    expect(uploader.positions.length).toBe(2);
    graph.focus("stub");
    expect(graph.cameras.filter((camera) => camera.reason === "focus")).toHaveLength(0);
    expect(graph.selectId(0)).toBe("acme");
  });

  it("fits once on settle, then leaves the camera alone until Fit view", () => {
    const timer = clock();
    const { graph, uploader } = session(new RecordingUploader(), timer);
    graph.replaceVisible({ nodes: [point("acme"), point("outlier")], edges: [] });
    timer.fire();
    expect(graph.cameras).toHaveLength(1);
    expect(graph.cameras[0]?.reason).toBe("auto");
    expect(graph.cameras[0]?.durationMs).toBe(300);
    graph.claimPointer();
    graph.replaceVisible({ nodes: [point("acme"), point("outlier"), point("next")], edges: [], viewReplacement: true });
    timer.fire();
    expect(graph.cameras).toHaveLength(1);
    graph.fitView();
    expect(graph.cameras.at(-1)?.reason).toBe("fit");
    expect(uploader.views.at(-1)?.durationMs).toBe(300);
  });

  it("skips automatic motion when reduced motion is requested", () => {
    const timer = clock();
    const { graph } = session(new RecordingUploader(), timer, true);
    graph.replaceVisible({ nodes: [point("only")], edges: [] });
    timer.fire();
    expect(graph.cameras).toHaveLength(0);
    graph.fitView();
    expect(graph.cameras[0]?.durationMs).toBe(0);
  });

  it("frames percentiles inside the inset viewport and ignores a distant outlier", () => {
    const cluster = Array.from({ length: 80 }, (_, index) => index);
    const framed = frameTransform([...cluster, 10_000], [...cluster, 10_000], viewport());
    const blown = frameTransform([0, 10_000], [0, 10_000], viewport());
    expect(framed).not.toBeNull();
    expect(blown).not.toBeNull();
    expect(framed!.k).toBeGreaterThan(blown!.k * 5);
  });
});
