import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/integrations/supabase/types";
import { evidenceReferences, summarizeRecordContext } from "./crm-detail";

const PAGE_SIZE = 500;
async function pages<T>(
  query: (
    start: number,
    end: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await query(start, start + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

export async function readCrmRecord(
  db: SupabaseClient<Database>,
  userId: string,
  recordId: string,
) {
  const { data: record, error } = await db
    .from("crm_records")
    .select("*")
    .eq("id", recordId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!record) return null;
  const sources = await pages((start, end) =>
    db
      .from("crm_record_sources")
      .select("*")
      .eq("crm_record_id", recordId)
      .eq("user_id", userId)
      .order("id")
      .range(start, end),
  );
  if (!sources.length) throw new Error("Research for this record is unavailable or restricted.");
  const runIds = [...new Set(sources.map((source) => source.run_id))];
  const nodes: Tables<"nodes">[] = [];
  const edges: Tables<"edges">[] = [];
  const assertions: Tables<"assertions">[] = [];
  const runs: Tables<"runs">[] = [];
  // Read each authorized run completely, without PostgREST's default row cap.
  // Bounded pages avoid silently losing evidence in large completed graphs.
  for (const runId of runIds) {
    const { data: run, error: runError } = await db
      .from("runs")
      .select("*")
      .eq("id", runId)
      .eq("user_id", userId)
      .maybeSingle();
    if (runError) throw new Error(runError.message);
    if (!run) throw new Error("A source run is unavailable or restricted.");
    runs.push(run);
    const [runNodes, runEdges, runAssertions] = await Promise.all([
      pages((start, end) =>
        db.from("nodes").select("*").eq("run_id", runId).order("id").range(start, end),
      ),
      pages((start, end) =>
        db.from("edges").select("*").eq("run_id", runId).order("id").range(start, end),
      ),
      pages((start, end) =>
        db.from("assertions").select("*").eq("run_id", runId).order("id").range(start, end),
      ),
    ]);
    nodes.push(...runNodes);
    edges.push(...runEdges);
    assertions.push(...runAssertions);
  }
  const ownerIds = sources.map((source) => source.node_id);
  const context = summarizeRecordContext({ ownerIds, nodes, edges, assertions });
  const relatedIds = [
    ...new Set(
      context.links.flatMap(({ node }) => (node?.category === "primary_entity" ? [node.id] : [])),
    ),
  ];
  const crmIds: Record<string, string> = {};
  for (let i = 0; i < relatedIds.length; i += 100) {
    const mappings = await pages((start, end) =>
      db
        .from("crm_record_sources")
        .select("node_id, crm_record_id")
        .eq("user_id", userId)
        .in("node_id", relatedIds.slice(i, i + 100))
        .order("id")
        .range(start, end),
    );
    mappings.forEach((mapping) => {
      crmIds[mapping.node_id] = mapping.crm_record_id;
    });
  }
  const referencedIds = new Set(
    context.assertions.flatMap((assertion) =>
      evidenceReferences(assertion.evidence).map((ref) => ref.chunkId),
    ),
  );
  const visibleIds = new Set([
    ...ownerIds,
    ...context.links.flatMap(({ node }) => (node ? [node.id] : [])),
    ...referencedIds,
  ]);
  return {
    record,
    sources,
    runs,
    links: context.links,
    assertions: context.assertions,
    nodes: nodes.filter((node) => visibleIds.has(node.id)),
    crmIds,
    evidenceCount: context.evidenceIds.length,
    contactCount: new Set(context.contactIds.map((id) => crmIds[id] ?? id)).size,
  };
}
