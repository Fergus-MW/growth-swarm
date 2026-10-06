import { describe, expect, it } from "vitest";
import { buildCrmList, filterCrmList, readAllCrmPages } from "./crm-list";
import type { CrmFilters, CrmRecordRow, CrmSourceRow } from "./crm-list";

const records: CrmRecordRow[] = [
  {
    id: "company",
    entity_type: "company",
    title: "Acme",
    fields: { website: "acme.test", status: "excluded" },
    created_at: "2026-01-01",
  },
  {
    id: "person",
    entity_type: "person",
    title: "Sam",
    fields: { role: "Founder", gaps: ["Current phone unconfirmed"] },
    created_at: "2026-01-02",
  },
  {
    id: "unknown",
    entity_type: "person",
    title: "Unknown employer",
    fields: {},
    created_at: "2026-01-03",
  },
];
const source = (id: string, runId: string, verdict: string): CrmSourceRow => ({
  id: `${id}-${runId}`,
  crm_record_id: id,
  run_id: runId,
  node_id: `${id}-node`,
  snapshot: { fields: { status: verdict } },
});
const sources = [
  source("company", "run1", "excluded"),
  source("company", "run2", "qualified"),
  source("person", "run1", "unqualified"),
  source("unknown", "run1", "candidate"),
];
const runs = [
  { id: "run1", objective: "First research" },
  { id: "run2", objective: "Second research" },
];
const edges = [
  { run_id: "run1", from_node: "person-node", to_node: "company-node", polarity: null },
];
const filters: CrmFilters = {
  kind: "company",
  runId: "",
  query: "",
  verdict: "all",
  stage: "all",
  starred: false,
  sort: "name",
  direction: 1,
};

describe("completed CRM lists", () => {
  it("preserves every transferred company/person and their verdicts without fabricating missing data", () => {
    const result = buildCrmList(records, sources, runs, edges);
    expect(result.map((record) => record.id)).toEqual(["company", "person", "unknown"]);
    expect(result[0]?.verdicts).toEqual([
      { runId: "run1", value: "excluded" },
      { runId: "run2", value: "qualified" },
    ]);
    expect(result[1]).toMatchObject({
      role: "Founder",
      email: null,
      phone: null,
      gaps: ["Current phone unconfirmed"],
      related: [{ id: "company", name: "Acme", runIds: ["run1"] }],
    });
    expect(result[2]).toMatchObject({ role: null, email: null, related: [] });
  });
  it("works for company-only, people-only and empty CRM results", () => {
    expect(buildCrmList(records.slice(0, 1), sources, runs, edges)).toHaveLength(1);
    expect(buildCrmList(records.slice(1), sources, runs, edges)).toHaveLength(2);
    expect(buildCrmList([], sources, runs, edges)).toEqual([]);
  });
  it("does not expose a record without an accessible source run or invent links for unavailable endpoints", () => {
    expect(buildCrmList(records, sources, [], edges)).toEqual([]);
    const result = buildCrmList(records.slice(1), sources, runs, edges);
    expect(result.every((record) => record.related.length === 0)).toBe(true);
  });
  it("does not turn negative or historical employment into a current employer", () => {
    for (const polarity of ["contradicts", "negative", "historical", "negated"]) {
      expect(
        buildCrmList(records, sources, runs, [{ ...edges[0]!, polarity }])[1]?.related,
      ).toEqual([]);
    }
  });
  it("filters verdict within the selected run and preserves excluded results", () => {
    const result = buildCrmList(records, sources, runs, edges);
    expect(filterCrmList(result, { ...filters, runId: "run1", verdict: "qualified" })).toEqual([]);
    expect(
      filterCrmList(result, { ...filters, runId: "run1", verdict: "excluded" }).map(
        (record) => record.id,
      ),
    ).toEqual(["company"]);
    expect(filterCrmList(result, { ...filters, kind: "person" })).toHaveLength(2);
  });
  it("searches contacts/roles/related names and sorts stably while applying workflow filters", () => {
    const result = buildCrmList(records, sources, runs, edges);
    result[1]!.stage = "contacted";
    result[1]!.starred = true;
    expect(
      filterCrmList(result, {
        ...filters,
        kind: "person",
        query: " acme ",
        stage: "contacted",
        starred: true,
      }).map((record) => record.id),
    ).toEqual(["person"]);
    expect(
      filterCrmList(result, { ...filters, kind: "person", direction: -1 }).map(
        (record) => record.id,
      ),
    ).toEqual(["unknown", "person"]);
    expect(filterCrmList(result, { ...filters, query: "nonexistent" })).toEqual([]);
  });
});

describe("CRM pagination", () => {
  it("reads more than 1,000 rows and advances even when the server caps requested pages", async () => {
    const all = Array.from({ length: 1201 }, (_, id) => ({ id }));
    const requested: number[] = [];
    const result = await readAllCrmPages((from) => {
      requested.push(from);
      return Promise.resolve({ data: all.slice(from, from + 100), error: null });
    });
    expect(result).toEqual(all);
    expect(requested.at(-1)).toBe(1201);
  });
  it("rejects partial results if a later page fails", async () => {
    await expect(
      readAllCrmPages((from) =>
        Promise.resolve(
          from
            ? { data: null, error: { message: "Access denied" } }
            : { data: [{ id: 1 }], error: null },
        ),
      ),
    ).rejects.toThrow("Access denied");
  });
});
