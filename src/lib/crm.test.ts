import { describe, expect, it } from "vitest";
import { conflictingFields, employmentStance, evidenceEdgeCount, planTransfer, websiteHost, type TransferEdge, type TransferNode } from "./crm.ts";

function company(id: string, title: string, website?: string): TransferNode {
  return { id, runId: "run-1", revision: 1, entityType: "company", title, fields: website ? { website, status: "qualified" } : { status: "candidate" } };
}

function person(id: string, title: string): TransferNode {
  return { id, runId: "run-1", revision: 2, entityType: "person", title, fields: { role: "CEO" } };
}

function worksAt(from: string, to: string, polarity: string | null = null): TransferEdge {
  return { relation: "works_at", from, to, polarity };
}

describe("crm transfer plan", () => {
  it("reuses a domain and keeps same-name companies without one distinct", () => {
    const first = planTransfer([company("a", "Acme", "https://www.acme.com"), company("b", "Acme"), company("c", "Acme")], [], new Set());
    expect(first.created).toBe(3);
    expect(first.mappings.map((row) => row.identityKey)).toEqual(["company:domain:acme.com", "company:node:b", "company:node:c"]);
    const second = planTransfer([company("d", "Acme", "acme.com/about")], [], new Set(first.mappings.map((row) => row.identityKey)));
    expect(second.mappings[0]?.action).toBe("reuse");
    expect(second.created + second.reused).toBe(second.sourceCount);
  });

  it("reuses a person only through current employment at a known domain", () => {
    const nodes = [company("co", "Acme", "acme.com"), person("p1", "Ada Lovelace"), person("p2", "Ada Lovelace"), person("p3", "Ada Lovelace")];
    const edges = [worksAt("p1", "co"), worksAt("p2", "co", "contradicts")];
    const plan = planTransfer(nodes, edges, new Set());
    const people = plan.mappings.filter((row) => row.kind === "person");
    expect(people.map((row) => row.identityKey)).toEqual([
      "person:domain:acme.com:name:ada lovelace",
      "person:node:p2",
      "person:node:p3",
    ]);
    const again = planTransfer(nodes, edges, new Set([people[0]!.identityKey]));
    expect(again.mappings.find((row) => row.nodeId === "p1")?.action).toBe("reuse");
    expect(again.mappings.find((row) => row.nodeId === "p3")?.action).toBe("create");
  });

  it("ignores notes and chunks and keeps counts reconciled", () => {
    const plan = planTransfer([
      company("co", "Acme", "acme.com"),
      { id: "note", runId: "run-1", revision: 1, entityType: null, title: "Pain", fields: {} },
    ], [], new Set());
    expect(plan.sourceCount).toBe(1);
    expect(plan.companyCount).toBe(1);
    expect(plan.personCount).toBe(0);
    expect(plan.created + plan.reused).toBe(1);
  });

  it("reports disagreeing research without collapsing it", () => {
    const conflicts = conflictingFields([
      { runId: "r1", fields: { website: "acme.com", size: "10" } },
      { runId: "r2", fields: { website: "acme.com", size: "40" } },
    ]);
    expect(conflicts).toEqual([{ field: "size", values: [{ runId: "r1", value: "10" }, { runId: "r2", value: "40" }] }]);
  });

  it("counts evidence edges once and classifies employment", () => {
    expect(evidenceEdgeCount([{ id: "e1", relation: "evidences" }, { id: "e1", relation: "evidences" }, { id: "e2", relation: "retrieved_for" }])).toBe(1);
    expect(employmentStance(null)).toBe("current");
    expect(employmentStance("qualifies")).toBe("historical");
    expect(employmentStance("contradicts")).toBe("negated");
    expect(websiteHost({ website: "https://www.Acme.com/team" })).toBe("acme.com");
    expect(websiteHost({ website: "not a host" })).toBeNull();
  });
});
