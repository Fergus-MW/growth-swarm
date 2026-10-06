import { createFixtureDatabase } from "./fixture-db";

export const database = createFixtureDatabase();
export const scenario = new URLSearchParams(location.search).get("fixture") ?? "complete";
export const fixtureControls = { modelCalls: 0, startFailures: scenario === "start-error" ? 1 : 0 };
Object.assign(window, { fixtureDatabase: database, fixtureControls });
