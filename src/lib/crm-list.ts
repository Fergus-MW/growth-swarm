import type { CrmWorkingState } from "./crm-workflow";

export type CrmRecordRow = {
  id: string;
  entity_type: "company" | "person";
  title: string;
  fields: unknown;
  created_at: string;
};
export type CrmSourceRow = {
  id: string;
  crm_record_id: string;
  run_id: string;
  node_id: string;
  snapshot: unknown;
};
export type CrmRun = { id: string; objective: string };
export type CrmEmploymentEdge = {
  run_id: string;
  from_node: string;
  to_node: string;
  polarity: string | null;
};
export type CrmListRecord = {
  id: string;
  entityType: "company" | "person";
  name: string;
  website: string | null;
  location: string | null;
  size: string | null;
  role: string | null;
  email: string | null;
  phone: string | null;
  profile: string | null;
  gaps: string[];
  verdicts: { runId: string; value: string }[];
  related: { id: string; name: string; runIds: string[] }[];
  runs: CrmRun[];
  stage: string;
  starred: boolean;
  createdAt: string;
};

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function field(fields: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}
function gapsFrom(fields: Record<string, unknown>): string[] {
  return ["gaps", "research_gaps", "missing_fields"].flatMap((key) => {
    const value = fields[key];
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : typeof value === "string"
        ? [value]
        : [];
  });
}

/** Derive lists solely from durable transferred records; never fold in live nodes. */
export function buildCrmList(
  records: CrmRecordRow[],
  sources: CrmSourceRow[],
  runs: CrmRun[],
  edges: CrmEmploymentEdge[],
  workingState: CrmWorkingState[] = [],
): CrmListRecord[] {
  const workById = new Map(workingState.map((state) => [state.record_id, state]));
  const runById = new Map(runs.map((run) => [run.id, run]));
  const sourceByRecord = new Map<string, CrmSourceRow[]>();
  const recordByNode = new Map<string, string>();
  for (const source of sources) {
    if (!runById.has(source.run_id)) continue;
    const existing = sourceByRecord.get(source.crm_record_id) ?? [];
    existing.push(source);
    sourceByRecord.set(source.crm_record_id, existing);
    recordByNode.set(`${source.run_id}:${source.node_id}`, source.crm_record_id);
  }
  const result = records
    .filter((record) => sourceByRecord.has(record.id))
    .map((record): CrmListRecord => {
      const fields = object(record.fields);
      const work = workById.get(record.id);
      const effective = (key: string, research: string | null) =>
        work && Object.hasOwn(work.overrides, key) ? (work.overrides[key] ?? null) : research;
      const recordSources = sourceByRecord.get(record.id)!;
      const verdicts = recordSources.map((source) => ({
        runId: source.run_id,
        value: field(object(object(source.snapshot)["fields"]), "status", "verdict") ?? "unknown",
      }));
      return {
        id: record.id,
        entityType: record.entity_type,
        name: effective("name", record.title) ?? record.title,
        website: effective("website", field(fields, "website", "domain")),
        location: effective("location", field(fields, "location")),
        size: effective("size", field(fields, "size", "employee_count")),
        role: effective("role", field(fields, "role", "job_title", "title")),
        email: effective("email", field(fields, "email")),
        phone: effective("phone", field(fields, "phone", "phone_number")),
        profile: effective("linkedin", field(fields, "linkedin", "linkedin_url", "profile_url")),
        gaps: gapsFrom(fields),
        verdicts,
        related: [],
        runs: [...new Set(recordSources.map((source) => source.run_id))].map((id) =>
          runById.get(id)!,
        ),
        stage: work?.stage ?? "new",
        starred: work?.starred ?? false,
        createdAt: record.created_at,
      };
    });
  const resultById = new Map(result.map((record) => [record.id, record]));
  for (const edge of edges) {
    // Only the graph's affirmative current-employment relation is an employer.
    if (edge.polarity && !["supports", "positive", "affirmed"].includes(edge.polarity)) continue;
    const from = resultById.get(recordByNode.get(`${edge.run_id}:${edge.from_node}`) ?? "");
    const to = resultById.get(recordByNode.get(`${edge.run_id}:${edge.to_node}`) ?? "");
    if (!from || !to || from.entityType !== "person" || to.entityType !== "company") continue;
    for (const [record, related] of [
      [from, to],
      [to, from],
    ] as const) {
      const existing = record.related.find((item) => item.id === related.id);
      if (existing) {
        if (!existing.runIds.includes(edge.run_id)) existing.runIds.push(edge.run_id);
      } else record.related.push({ id: related.id, name: related.name, runIds: [edge.run_id] });
    }
  }
  return result;
}

export type CrmSortKey = "name" | "createdAt" | "stage" | "related" | "role" | "location";
export type CrmFilters = {
  kind: "company" | "person";
  query: string;
  runId: string;
  verdict: string;
  stage: string;
  starred: boolean;
  sort: CrmSortKey;
  direction: 1 | -1;
};
export function filterCrmList(records: CrmListRecord[], filters: CrmFilters): CrmListRecord[] {
  return records
    .filter((record) => {
      const query = filters.query.trim().toLocaleLowerCase();
      const searchable = [
        record.name,
        record.website,
        record.location,
        record.role,
        record.email,
        record.phone,
        record.profile,
        ...record.related.map((related) => related.name),
      ]
        .join(" ")
        .toLocaleLowerCase();
      return (
        record.entityType === filters.kind &&
        (!query || searchable.includes(query)) &&
        (!filters.runId || record.runs.some((run) => run.id === filters.runId)) &&
        (filters.verdict === "all" ||
          record.verdicts.some(
            (verdict) =>
              verdict.value === filters.verdict &&
              (!filters.runId || verdict.runId === filters.runId),
          )) &&
        (filters.stage === "all" || record.stage === filters.stage) &&
        (!filters.starred || record.starred)
      );
    })
    .sort((a, b) => {
      const compare =
        filters.sort === "related"
          ? a.related.length - b.related.length
          : (a[filters.sort] ?? "").localeCompare(b[filters.sort] ?? "", undefined, {
              numeric: true,
              sensitivity: "base",
            });
      return compare * filters.direction || a.id.localeCompare(b.id);
    });
}

/** Advance by returned rows, rather than requested size, to tolerate server caps. */
export async function readAllCrmPages<T>(
  fetchPage: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 500,
): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    const { data, error } = await fetchPage(rows.length, rows.length + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) return rows;
    rows.push(...data);
  }
}
