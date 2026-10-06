import { beforeEach, expect, it, vi } from "vitest";
import { executeWindow } from "@/lib/swarm.server";
import { createFixtureDatabase, fixtureRun } from "../../tests/lovable/fixture-db";

const { model } = vi.hoisted(() => ({ model: vi.fn() }));
vi.mock("@/lib/ai.server", () => ({ callModelJson: model }));
beforeEach(() => {
  model.mockReset();
});

it("completes an arbitrary task with notes and no companies, preserving each voter's explanation", async () => {
  model.mockResolvedValue({
    decision: "yes",
    rationale: "Synthetic finding meets the brief",
    gap_task: null,
  });
  const run = fixtureRun({ swarm_size: 100 });
  const db = createFixtureDatabase({
    runs: [run],
    tasks: [{ id: "done", run_id: run.id, status: "done" }],
    nodes: [{ id: "note", run_id: run.id, category: "note", content: "Synthetic finding" }],
  });
  await executeWindow(db, run.id);
  expect(db.tables.runs[0]?.["status"]).toBe("completed");
  const explanations = db.tables.events.filter((event) => event["kind"] === "agent_voted");
  expect(explanations).toHaveLength(100);
  expect(explanations.at(-1)).toMatchObject({
    agent_index: 99,
    payload: {
      decision: "yes",
      rationale: "Synthetic finding meets the brief",
      revision: 0,
      epoch: 1,
    },
  });
});

it("keeps an explicit GTM company count as a deterministic completion gate", async () => {
  model.mockResolvedValue({
    decision: "yes",
    rationale: "Synthetic unanimous vote",
    gap_task: null,
  });
  const run = fixtureRun({
    profile: "gtm",
    swarm_size: 5,
    completion_criteria: "At least 50 qualified companies",
  });
  const db = createFixtureDatabase({
    runs: [run],
    tasks: [{ id: "done", run_id: run.id, status: "done" }],
    nodes: [
      {
        id: "company",
        run_id: run.id,
        category: "primary_entity",
        entity_type: "company",
        fields: { status: "qualified" },
      },
    ],
  });
  await executeWindow(db, run.id);
  expect(db.tables.runs[0]?.["outcome"]).toBe("criteria_unmet");
  expect(db.tables.events.find((event) => event["kind"] === "epoch_closed")).toMatchObject({
    payload: { yes: 5, gatesPass: false },
  });
});

it("records a visible per-agent evaluation failure without exposing transport details", async () => {
  model.mockRejectedValue(new Error("Synthetic private transport detail"));
  const run = fixtureRun({ swarm_size: 5 });
  const db = createFixtureDatabase({
    runs: [run],
    tasks: [{ id: "done", run_id: run.id, status: "done" }],
  });
  await executeWindow(db, run.id);
  expect(db.tables.events.filter((event) => event["kind"] === "agent_vote_error")).toHaveLength(5);
  expect(JSON.stringify(db.tables.events)).not.toContain("Synthetic private transport detail");
});
