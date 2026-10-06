import { describe, expect, it } from "vitest";
import {
  evidenceReferences,
  resolveEvidenceSpan,
  safeResearchUrl,
  summarizeRecordContext,
} from "./crm-detail";
import type { ResearchNode, ResearchEdge, ResearchAssertion } from "./crm-detail";

const node = (id: string, category = "primary_entity", entity_type = "person") =>
  ({ id, category, entity_type }) as ResearchNode;
const edge = (
  id: string,
  relation: string,
  from_node: string,
  to_node: string,
  polarity = "supports",
) => ({ id, relation, from_node, to_node, polarity }) as ResearchEdge;

describe("CRM record evidence and relationships", () => {
  it("keeps retrieved context separate from support and deduplicates contacts", () => {
    const context = summarizeRecordContext({
      ownerIds: ["company"],
      nodes: [
        node("company", "primary_entity", "company"),
        node("person"),
        node("retrieved", "source_chunk"),
        node("source", "source_chunk"),
      ],
      edges: [
        edge("e1", "works_at", "person", "company"),
        edge("e2", "works_at", "person", "company"),
        edge("e3", "retrieved_for", "retrieved", "company"),
        edge("e4", "evidences", "source", "company"),
      ],
      assertions: [],
    });
    expect(context.contactIds).toEqual(["person"]);
    expect(context.evidenceIds).toEqual(["source"]);
  });

  it("resolves pain-scoped contact recommendations only for linked company people", () => {
    const context = summarizeRecordContext({
      ownerIds: ["company"],
      nodes: [node("company"), node("pain", "note"), node("person"), node("unrelated")],
      edges: [
        edge("pain", "holds_pain", "company", "pain"),
        edge("work", "works_at", "person", "company"),
        edge("best", "best_contact_for", "person", "pain"),
        edge("wrong", "best_contact_for", "unrelated", "pain"),
      ],
      assertions: [],
    });
    expect(context.links.map(({ edge: item }) => item.id)).toContain("best");
    expect(context.links.map(({ edge: item }) => item.id)).not.toContain("wrong");
  });

  it("keeps negated relationships visible without counting them as contacts", () => {
    const context = summarizeRecordContext({
      ownerIds: ["company"],
      nodes: [node("company"), node("person")],
      edges: [edge("negated", "works_at", "person", "company", "contradicts")],
      assertions: [],
    });
    expect(context.links).toHaveLength(1);
    expect(context.contactIds).toEqual([]);
  });

  it("keeps conflicting assertions from separate runs without read-order merging", () => {
    const assertions = ["first", "second"].map(
      (id) =>
        ({
          id,
          claim: "A claim",
          confidence: "high",
          assessment_version: 1,
          created_at: "2026-10-06",
          created_by_agent: null,
          field_key: null,
          run_id: id,
          owner_node_id: id,
          evidence: [{ chunk_id: `${id}-source`, quote: "text" }],
        }) as ResearchAssertion,
    );
    const context = summarizeRecordContext({
      ownerIds: ["first", "second"],
      nodes: [],
      edges: [],
      assertions,
    });
    expect(context.assertions).toHaveLength(2);
    expect(context.evidenceIds).toEqual(["first-source", "second-source"]);
  });

  it("verifies explicit spans and resolves only unambiguous legacy quotes", () => {
    const ref = evidenceReferences([
      { chunk_id: "source", quote: "supported", start: 4, end: 13 },
    ])[0]!;
    expect(resolveEvidenceSpan("The supported claim.", ref)).toEqual({ start: 4, end: 13 });
    expect(resolveEvidenceSpan("The supported claim.", { ...ref, end: 14 })).toBeNull();
    expect(resolveEvidenceSpan("supported", { ...ref, start: 0, end: 999 })).toBeNull();
    expect(
      resolveEvidenceSpan("supported supported", { ...ref, start: null, end: null }),
    ).toBeNull();
    expect(resolveEvidenceSpan("The supported claim.", { ...ref, start: null, end: null })).toEqual(
      { start: 4, end: 13 },
    );
  });

  it("rejects malformed evidence and unsafe source links", () => {
    expect(evidenceReferences([null, {}, { chunk_id: 42 }])).toEqual([]);
    expect(safeResearchUrl("javascript:alert(1)")).toBeNull();
    expect(safeResearchUrl("data:text/html,unsafe")).toBeNull();
    expect(safeResearchUrl("https://example.com/source")).toBe("https://example.com/source");
  });
});
