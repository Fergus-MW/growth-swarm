import type { RunRow } from "../../src/lib/swarm.server";

export type FixtureRow = Record<string, unknown>;
type Result = {
  data: FixtureRow | FixtureRow[] | null;
  error: { code: string; message: string } | null;
  count: number | null;
};
type Predicate = (row: FixtureRow) => boolean;
const tableNames = [
  "runs",
  "tasks",
  "nodes",
  "edges",
  "assertions",
  "votes",
  "events",
  "invocations",
  "checkpoints",
] as const;
type Table = (typeof tableNames)[number];

export function fixtureRun(overrides: Partial<RunRow> = {}): RunRow {
  return {
    id: "fixture-run",
    user_id: "fixture-user",
    parent_run_id: null,
    profile: "blank",
    objective: "Explain fictional volcanic hazards using captured sources",
    pain: null,
    universe: null,
    exclusions: null,
    completion_criteria: "Explain fictional volcanic hazards with citations",
    swarm_size: 20,
    threshold: 0.7,
    time_limit_sec: 1800,
    cost_cap: 5,
    connectors: ["web_search"],
    status: "running",
    outcome: null,
    stop_requested: false,
    graph_revision: 0,
    assessment_version: 1,
    epoch: 0,
    spend: 0,
    stats: {},
    created_at: new Date().toISOString(),
    started_at: null,
    ended_at: null,
    ...overrides,
  };
}

export function createFixtureDatabase(seed: Partial<Record<Table, FixtureRow[]>> = {}) {
  let counter = 0;
  const tables = Object.fromEntries(
    tableNames.map((name) => [name, structuredClone(seed[name] ?? [])]),
  ) as Record<Table, FixtureRow[]>;
  const defaults = (table: Table, value: FixtureRow): FixtureRow => {
    const id = table === "events" ? ++counter : `fixture-${table}-${++counter}`;
    const common = { id, created_at: new Date().toISOString() };
    if (table === "runs") return { ...fixtureRun({ id: String(id), status: "draft" }), ...value };
    if (table === "tasks")
      return {
        ...common,
        status: "open",
        payload: {},
        attempts: 0,
        owner_agent: null,
        claim_token: null,
        lease_expires_at: null,
        reserved_for_agent: null,
        priority: 20,
        ...value,
      };
    if (table === "nodes")
      return {
        ...common,
        aliases: [],
        fields: {},
        confidence: "medium",
        provenance: "fixture",
        ...value,
      };
    return { ...common, ...value };
  };
  function from(table: Table) {
    if (!(table in tables)) throw new Error(`Unsupported fixture table: ${table}`);
    let operation: "select" | "insert" | "update" = "select";
    let values: FixtureRow[] = [];
    let update: FixtureRow = {};
    let single = false;
    let head = false;
    let counted = false;
    let maximum = Infinity;
    const predicates: Predicate[] = [];
    const orders: Array<{ column: string; ascending: boolean }> = [];
    let result: Promise<Result> | undefined;
    const execute = (): Result => {
      let rows = tables[table].filter((row) => predicates.every((predicate) => predicate(row)));
      if (operation === "insert") {
        if (
          values.some(
            (value) =>
              value["dedupe_key"] &&
              tables[table].some(
                (row) =>
                  row["run_id"] === value["run_id"] && row["dedupe_key"] === value["dedupe_key"],
              ),
          )
        ) {
          return {
            data: null,
            count: null,
            error: { code: "23505", message: "duplicate fixture key" },
          };
        }
        rows = values.map((value) => defaults(table, value));
        tables[table].push(...rows);
      } else if (operation === "update") {
        for (const row of rows) Object.assign(row, structuredClone(update));
      }
      for (const { column, ascending } of [...orders].reverse())
        rows.sort((a, b) => {
          const first = a[column];
          const second = b[column];
          const comparison =
            typeof first === "number" && typeof second === "number"
              ? first - second
              : String(first ?? "").localeCompare(String(second ?? ""));
          return ascending ? comparison : -comparison;
        });
      const count = counted ? rows.length : null;
      rows = rows.slice(0, maximum);
      if (single && rows.length !== 1)
        return {
          data: null,
          count,
          error: { code: "PGRST116", message: "Expected one fixture row" },
        };
      return { data: head ? null : structuredClone(single ? rows[0]! : rows), error: null, count };
    };
    const query = {
      select(_columns = "*", options?: { count?: string; head?: boolean }) {
        counted = Boolean(options?.count);
        head = Boolean(options?.head);
        return query;
      },
      insert(value: FixtureRow | FixtureRow[]) {
        operation = "insert";
        values = structuredClone(Array.isArray(value) ? value : [value]);
        return query;
      },
      update(value: FixtureRow) {
        operation = "update";
        update = value;
        return query;
      },
      eq(column: string, value: unknown) {
        predicates.push((row) => row[column] === value);
        return query;
      },
      gt(column: string, value: number) {
        predicates.push((row) => Number(row[column]) > value);
        return query;
      },
      ilike(column: string, value: string) {
        predicates.push((row) => String(row[column]).toLowerCase() === value.toLowerCase());
        return query;
      },
      or(expression: string) {
        const alternatives = expression.split(",").map((term) => {
          const [column, operator, ...rest] = term.split(".");
          const value = rest.join(".");
          return (row: FixtureRow) =>
            operator === "is"
              ? row[column!] == null
              : operator === "lt"
                ? String(row[column!]) < value
                : String(row[column!]) === value;
        });
        predicates.push((row) => alternatives.some((predicate) => predicate(row)));
        return query;
      },
      order(column: string, options?: { ascending?: boolean }) {
        orders.push({ column, ascending: options?.ascending ?? true });
        return query;
      },
      limit(count: number) {
        maximum = count;
        return query;
      },
      single() {
        single = true;
        return query;
      },
      then<TResult1 = Result, TResult2 = never>(
        resolve?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
        reject?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) {
        result ??= Promise.resolve().then(execute);
        return result.then(resolve, reject);
      },
    };
    return query;
  }
  return { tables, from };
}
