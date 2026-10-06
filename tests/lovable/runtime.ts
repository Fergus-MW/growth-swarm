import { createFixtureDatabase, fixtureRun } from "./fixture-db";

export const scenario = new URLSearchParams(location.search).get("fixture") ?? "complete";
export const database = createFixtureDatabase(
  scenario === "archive"
    ? {
        runs: [
          fixtureRun({
            id: "00000000-0000-4000-8000-000000000125",
            status: "completed",
            outcome: "consensus",
            swarm_size: 100,
          }),
        ],
        events: Array.from({ length: 125 }, (_, index) => ({
          id: index + 1,
          run_id: "00000000-0000-4000-8000-000000000125",
          agent_index: 99,
          kind: "task_done",
          created_at: new Date().toISOString(),
          payload: { summary: `Saved fictional action ${index + 1}` },
        })),
      }
    : {},
);
export const fixtureControls = { modelCalls: 0, startFailures: scenario === "start-error" ? 1 : 0 };
Object.assign(window, { fixtureDatabase: database, fixtureControls });
