import test from "node:test";
import assert from "node:assert/strict";
import { createFixtureDatabase, fixtureRun } from "./fixture-db.ts";

test("conditional starts execute on await and only one draft transition wins", async () => {
  const db = createFixtureDatabase({ runs: [fixtureRun({ status: "draft" })] });
  const first = db
    .from("runs")
    .update({ status: "running" })
    .eq("id", "fixture-run")
    .eq("status", "draft")
    .select("id")
    .single();
  const second = db
    .from("runs")
    .update({ status: "running" })
    .eq("id", "fixture-run")
    .eq("status", "draft")
    .select("id")
    .single();
  assert.equal(db.tables.runs[0]?.["status"], "draft");
  const results = await Promise.all([first, second]);
  assert.equal(results.filter((result) => result.data).length, 1);
  assert.equal(results.find((result) => !result.data)?.error?.code, "PGRST116");
  assert.equal(db.tables.runs[0]?.["status"], "running");
});

test("fixture inserts retain defaults, source records and ordered event pages", async () => {
  const db = createFixtureDatabase();
  await db.from("tasks").insert({ run_id: "r", kind: "generic_research" });
  assert.equal(db.tables.tasks[0]?.["status"], "open");
  assert.equal(db.tables.tasks[0]?.["attempts"], 0);
  await db
    .from("nodes")
    .insert({ run_id: "r", category: "source_chunk", content: "FICTIONAL volcano source" });
  assert.equal(db.tables.nodes[0]?.["content"], "FICTIONAL volcano source");
  await db.from("events").insert({ run_id: "r", kind: "one" });
  const after = Number(db.tables.events[0]?.["id"]);
  await db.from("events").insert({ run_id: "r", kind: "two" });
  await db.from("events").insert({ run_id: "r", kind: "three" });
  const page = await db
    .from("events")
    .select("*")
    .eq("run_id", "r")
    .gt("id", after)
    .order("id", { ascending: false })
    .limit(1);
  assert.equal((page.data as Array<Record<string, unknown>>)[0]?.["kind"], "three");
  const count = await db
    .from("tasks")
    .select("id", { head: true, count: "exact" })
    .eq("status", "open");
  assert.equal(count.count, 1);
  assert.equal(count.data, null);
});

test("archived event pages support a before cursor", async () => {
  const db = createFixtureDatabase({
    events: [
      { id: 1, agent_index: 99 },
      { id: 2, agent_index: 99 },
      { id: 3, agent_index: 99 },
    ],
  });
  const page = await db
    .from("events")
    .select("*")
    .eq("agent_index", 99)
    .lt("id", 3)
    .order("id", { ascending: false })
    .limit(1);
  assert.deepEqual(page.data, [{ id: 2, agent_index: 99 }]);
});
