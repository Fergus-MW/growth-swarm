import { expect, it, vi } from "vitest";
import { executeWindow } from "@/lib/swarm.server";
import { createFixtureDatabase, fixtureRun } from "../../tests/lovable/fixture-db";

const { model, search } = vi.hoisted(() => ({ model: vi.fn(), search: vi.fn() }));
vi.mock("@/lib/ai.server", () => ({ callModelJson: model }));
vi.mock("@/lib/connectors.server", () => ({ webSearch: search, webSearchAvailable: () => true }));

it("researches a blank brief as cited findings rather than company prospecting", async () => {
  search.mockResolvedValue({
    ok: true,
    items: [
      {
        title: "Fictional volcano source",
        url: "https://example.invalid/volcano",
        content: "Fictional eruption hazard: ash can damage crops.",
      },
    ],
  });
  model.mockImplementation(async ({ schemaName }: { schemaName: string }) => {
    if (schemaName === "generic_research")
      return {
        findings: [
          {
            title: "Fictional ash hazard",
            body: "Ash damages crops in this synthetic example.",
            chunk_index: 0,
            quote: "ash can damage crops",
          },
        ],
        queries: [],
        gap: null,
      };
    if (schemaName === "vote")
      return {
        decision: "yes",
        rationale: "Provided fictional finding answers the synthetic task",
        gap_task: null,
      };
    throw new Error(`Unexpected company-prospecting model request: ${schemaName}`);
  });
  const run = fixtureRun({ swarm_size: 5 });
  const db = createFixtureDatabase({ runs: [run] });
  await executeWindow(db, run.id);
  expect(db.tables.runs[0]?.["status"]).toBe("completed");
  expect(db.tables.runs[0]?.["outcome"]).toBe("consensus");
  expect(db.tables.nodes).toContainEqual(
    expect.objectContaining({ category: "note", title: "Fictional ash hazard" }),
  );
  expect(db.tables.nodes.some((node) => node["entity_type"] === "company")).toBe(false);
  expect(db.tables.assertions).toContainEqual(
    expect.objectContaining({
      evidence: [expect.objectContaining({ quote: "ash can damage crops" })],
    }),
  );
  expect(
    db.tables.tasks.every(
      (task) => !["qualify", "signals", "contacts"].includes(String(task["kind"])),
    ),
  ).toBe(true);
});

it("does not invoke a disabled connector or persist an unsupported citation", async () => {
  model.mockImplementation(async ({ schemaName }: { schemaName: string }) =>
    schemaName === "vote"
      ? { decision: "no", rationale: "No captured evidence", gap_task: null }
      : {
          findings: [
            {
              title: "Unsupported",
              body: "Made-up factual claim",
              chunk_index: 0,
              quote: "not in any source",
            },
          ],
          queries: [],
          gap: "Source evidence is unavailable",
        },
  );
  search.mockClear();
  const run = fixtureRun({ swarm_size: 5, connectors: [] });
  const db = createFixtureDatabase({ runs: [run] });
  await executeWindow(db, run.id);
  expect(search).not.toHaveBeenCalled();
  expect(db.tables.assertions).toHaveLength(0);
  expect(db.tables.nodes).toContainEqual(
    expect.objectContaining({
      semantic_kind: "research_gap",
      content: "Source evidence is unavailable",
    }),
  );
  expect(db.tables.runs[0]?.["outcome"]).toBe("criteria_unmet");
});

it("records a failed result when every evaluator call fails", async () => {
  model.mockRejectedValue(new Error("Synthetic model transport failure"));
  const run = fixtureRun({ swarm_size: 5 });
  const db = createFixtureDatabase({
    runs: [run],
    tasks: [{ id: "done-task", run_id: run.id, status: "done" }],
  });
  await executeWindow(db, run.id);
  expect(db.tables.runs[0]?.["outcome"]).toBe("failed");
  expect(db.tables.runs[0]?.["status"]).toBe("ended");
});
