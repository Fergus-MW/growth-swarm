import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeWindow, type RunRow } from "@/lib/swarm.server";

const { model } = vi.hoisted(() => ({ model: vi.fn() }));
vi.mock("@/lib/ai.server", () => ({ callModelJson: model }));

function evaluationDatabase(run: RunRow) {
  const events: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  return {
    events,
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let counted = false;
      let updateValues: Partial<RunRow> | undefined;
      const applyUpdate = () => {
        if (table !== "runs" || !updateValues) return true;
        if (!Object.entries(filters).every(([key, value]) => run[key as keyof RunRow] === value))
          return false;
        Object.assign(run, updateValues);
        return true;
      };
      const query = {
        select(_columns?: string, options?: { count?: string; head?: boolean }) {
          counted = Boolean(options?.count);
          return query;
        },
        eq(column: string, value: unknown) {
          filters[column] = value;
          return query;
        },
        or() {
          return query;
        },
        order() {
          return query;
        },
        limit() {
          return query;
        },
        update(values: Partial<RunRow>) {
          updateValues = values;
          return query;
        },
        insert(value: { kind?: string; payload?: Record<string, unknown> }) {
          if (table === "events") events.push({ kind: value.kind!, payload: value.payload! });
          return query;
        },
        single() {
          applyUpdate();
          return Promise.resolve({ data: { ...run }, error: null });
        },
        maybeSingle() {
          const applied = applyUpdate();
          return Promise.resolve({ data: applied ? { id: run.id } : null, error: null });
        },
        then(resolve: (value: { data: unknown[]; count: number; error: null }) => unknown) {
          applyUpdate();
          const data =
            table === "nodes" && filters["entity_type"] === "company"
              ? [{ id: "qualified-company", fields: { status: "qualified" } }]
              : [];
          const count = counted && table === "tasks" && filters["status"] !== "open" ? 1 : 0;
          return Promise.resolve({ data, count, error: null }).then(resolve);
        },
      };
      return query;
    },
  };
}

function run(): RunRow {
  return {
    id: "threshold-run",
    user_id: "synthetic-user",
    parent_run_id: null,
    profile: "blank",
    objective: "Investigate a synthetic qualified company",
    pain: null,
    universe: null,
    exclusions: null,
    completion_criteria: "One evidenced qualified company",
    swarm_size: 100,
    threshold: 0.07,
    time_limit_sec: 3600,
    cost_cap: 5,
    connectors: [],
    status: "running",
    outcome: null,
    stop_requested: false,
    graph_revision: 4,
    assessment_version: 1,
    epoch: 0,
    spend: 0,
    stats: {},
    created_at: new Date().toISOString(),
    started_at: null,
    ended_at: null,
  };
}

describe("configured-roster completion threshold", () => {
  beforeEach(() => model.mockReset());

  it("reaches consensus with exactly seven yes votes for 7% of 100 agents", async () => {
    let voter = 0;
    model.mockImplementation(async () => ({
      decision: ++voter <= 7 ? "yes" : "no",
      rationale: "Synthetic vote",
      gap_task: null,
    }));
    const state = run();
    const db = evaluationDatabase(state);
    const result = await executeWindow(db, state.id);
    expect(result.status).toBe("completed");
    expect(state.outcome).toBe("consensus");
    expect(db.events.find((event) => event.kind === "epoch_closed")?.payload).toMatchObject({
      yes: 7,
      needed: 7,
      total: 100,
    });
  });
});

it("requires eight agents immediately above 7% rather than rounding the threshold down", async () => {
  let voter = 0;
  model.mockImplementation(async () => ({
    decision: ++voter <= 7 ? "yes" : "no",
    rationale: "Synthetic vote",
    gap_task: null,
  }));
  const state = { ...run(), threshold: 0.070001 };
  const db = evaluationDatabase(state);
  await executeWindow(db, state.id);
  expect(state.outcome).toBe("criteria_unmet");
  expect(db.events.find((event) => event.kind === "epoch_closed")?.payload).toMatchObject({
    yes: 7,
    needed: 8,
    total: 100,
  });
});

it("rejects completion when the committed graph changes during voting", async () => {
  const state = run();
  let changed = false;
  model.mockImplementation(async () => {
    if (!changed) {
      state.graph_revision += 1;
      changed = true;
    }
    return { decision: "yes", rationale: "Synthetic vote", gap_task: null };
  });
  const db = evaluationDatabase(state);
  await expect(executeWindow(db, state.id)).rejects.toThrow();
  expect(state.status).toBe("running");
  expect(state.outcome).toBeNull();
  expect(db.events.some((event) => event.kind === "run_finished")).toBe(false);
});
