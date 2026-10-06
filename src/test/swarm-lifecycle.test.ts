import { expect, it, vi } from "vitest";
import { executeWindow, type RunRow } from "@/lib/swarm.server";

const { model } = vi.hoisted(() => ({ model: vi.fn() }));
vi.mock("@/lib/ai.server", () => ({ callModelJson: model }));

it("finalizes a stopping run without dispatching research and preserves its checkpoint", async () => {
  const state = {
    id: "stopping-fixture", status: "stopping", stop_requested: true,
    outcome: null, graph_revision: 9, spend: 0, stats: {},
    objective: "Synthetic brief", completion_criteria: "Synthetic criteria", connectors: [],
  } as unknown as RunRow;
  const checkpoints: unknown[] = [];
  const events: unknown[] = [];
  const db = {
    from(table: string) {
      const query = {
        select() { return query; }, eq() { return query; },
        update(values: object) { Object.assign(state, values); return query; },
        insert(value: unknown) { if (table === "checkpoints") checkpoints.push(value); if (table === "events") events.push(value); return query; },
        single: async () => ({data: state, error: null}),
        then(resolve: (value: {data: unknown[]; count: number; error: null}) => unknown) {
          return Promise.resolve({data: [], count: 0, error: null}).then(resolve);
        },
      };
      return query;
    },
  };
  const result = await executeWindow(db, state.id);
  expect(result.status).toBe("ended");
  expect(state.outcome).toBe("stopped_by_user");
  expect(state.graph_revision).toBe(9);
  expect(checkpoints.length).toBeGreaterThan(0);
  expect(events).toContainEqual(expect.objectContaining({kind: "run_finished", payload: {outcome: "stopped_by_user"}}));
  expect(model).not.toHaveBeenCalled();
});
