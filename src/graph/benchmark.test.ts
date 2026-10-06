import { describe, expect, it } from "vitest";
import { GraphSession, type SessionClock } from "./session.ts";
import type { GraphLink, GraphPoint, GraphUploader } from "./types.ts";

class MemoryUploader implements GraphUploader {
  positions = new Float32Array();
  setPointPositions(data: Float32Array): void { this.positions = data.slice(); }
  setPointColors(): void {}
  setPointSizes(): void {}
  setPointShapes(): void {}
  setLinks(): void {}
  setLinkColors(): void {}
  setLinkWidths(): void {}
  setLinkStyles(): void {}
  getPointPositions(): Float32Array { return this.positions; }
  render(): void {}
  pause(): void {}
  start(): void {}
  setViewTransform(): void {}
  focusIndex(): void {}
}

const clock: SessionClock = { now: () => 0, schedule: (run) => { run(); return 0; }, later: () => 0, cancel: () => {} };

describe("live growth budget", () => {
  it("updates a few thousand points without reseeding the existing layout", () => {
    const uploader = new MemoryUploader();
    const session = new GraphSession(uploader, clock, true, [[0.2, 0.7, 0.6]], () => ({ width: 1280, height: 720, insets: { left: 0, right: 0, top: 0, bottom: 0 } }), () => {});
    const nodes: GraphPoint[] = Array.from({ length: 2500 }, (_, index) => ({ id: `n${index}`, label: `Node ${index}`, category: index % 5 === 0 ? "source_chunk" : index % 3 === 0 ? "note" : "primary_entity", typeKey: `type-${index % 15}` }));
    const edges: GraphLink[] = Array.from({ length: 4000 }, (_, index) => ({ id: `e${index}`, source: `n${index % 2500}`, target: `n${(index * 17) % 2500}`, relation: index % 4 === 0 ? "retrieved_for" : "evidences", family: index % 4 === 0 ? "context" : "evidence", polarity: index % 11 === 0 ? "contradicts" : "supports", weight: 0.4 }));
    const started = performance.now();
    session.replaceVisible({ nodes, edges });
    const grown = nodes.concat({ id: "n-extra", label: "Extra", category: "primary_entity", typeKey: "company" });
    session.replaceVisible({ nodes: grown, edges });
    const elapsed = performance.now() - started;
    expect(session.stats.positionUploads).toBe(2);
    expect(uploader.positions.length).toBe(grown.length * 2);
    expect(uploader.positions[0]).toBeTypeOf("number");
    expect(elapsed).toBeLessThan(2000);
    expect(session.stats.renderer).toBe(1);
  });
});
