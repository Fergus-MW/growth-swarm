import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { STAGES } from "@/lib/lead-stages";
import { conflictingFields, employmentStance, evidenceEdgeCount, isEditableField } from "@/lib/crm";
import { ensureCrmTransfer, readTransfer } from "@/lib/crm.server";

const STATUS_WEIGHT: Record<string, number> = { qualified: 60, candidate: 25, unclear: 20, rejected: 0 };

async function selectIn<T>(load: (ids: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, ids: string[]): Promise<T[]> {
  const rows: T[] = [];
  for (let index = 0; index < ids.length; index += 80) {
    const slice = ids.slice(index, index + 80);
    if (!slice.length) continue;
    const { data, error } = await load(slice);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
  }
  return rows;
}

export const listLeads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    kind: z.enum(["company", "person"]).default("company"),
    runId: z.string().optional(),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(200).default(40),
  }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    const { data: records, error } = await db.from("crm_records").select("*").eq("kind", data.kind).order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    const recordIds = (records ?? []).map((row) => row.id);
    const mappings = await selectIn((ids) => db.from("crm_mappings").select("*").in("record_id", ids), recordIds);
    const visibleRecords = data.runId ? (records ?? []).filter((row) => mappings.some((mapping) => mapping.record_id === row.id && mapping.run_id === data.runId)) : (records ?? []);
    const visibleIds = new Set(visibleRecords.map((row) => row.id));
    const visibleMaps = mappings.filter((mapping) => visibleIds.has(mapping.record_id));
    const nodes = await selectIn((ids) => db.from("nodes").select("id, run_id, title, fields, free_text, confidence, revision, created_at, entity_type").in("id", ids), [...new Set(visibleMaps.map((mapping) => mapping.node_id))]);
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const runIds = [...new Set(visibleMaps.map((mapping) => mapping.run_id))];
    const runs = await selectIn((ids) => db.from("runs").select("id, objective").in("id", ids), runIds);
    const runName = new Map(runs.map((run) => [run.id, run.objective]));
    const pageNodes = nodes.map((node) => node.id);
    const edges = await selectIn((ids) => db.from("edges").select("id, from_node, to_node, relation").or(`from_node.in.(${ids.join(",")}),to_node.in.(${ids.join(",")})`), pageNodes);

    const rows = visibleRecords.map((record) => {
      const mine = visibleMaps.filter((mapping) => mapping.record_id === record.id);
      const linked = mine.map((mapping) => nodeById.get(mapping.node_id)).filter((node) => node != null);
      const latest = [...linked].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
      const fields = (latest?.fields ?? {}) as Record<string, unknown>;
      const overrides = (record.overrides ?? {}) as Record<string, unknown>;
      const text = (key: string) => {
        const override = overrides[key];
        if (typeof override === "string" && override) return override;
        const value = fields[key];
        return typeof value === "string" ? value : null;
      };
      const nodeIds = new Set(linked.map((node) => node.id));
      const touching = edges.filter((edge) => nodeIds.has(edge.from_node) || nodeIds.has(edge.to_node));
      const statusValue = fields["status"];
      const status = typeof statusValue === "string" ? statusValue : "candidate";
      return {
        id: record.id,
        kind: record.kind,
        name: text("name") || latest?.title || "Untitled",
        website: text("website"),
        location: text("location"),
        size: text("size"),
        role: text("role"),
        status,
        stage: record.stage,
        starred: record.starred,
        notes: record.notes,
        updatedAt: record.updated_at,
        evidence: evidenceEdgeCount(touching),
        contacts: new Set(touching.filter((edge) => edge.relation === "works_at").flatMap((edge) => [edge.from_node, edge.to_node]).filter((id) => !nodeIds.has(id))).size,
        runs: [...new Map(mine.map((mapping) => [mapping.run_id, { id: mapping.run_id, objective: runName.get(mapping.run_id) ?? "" }])).values()],
        score: Math.min(100, (STATUS_WEIGHT[status] ?? 10) + Math.min(20, evidenceEdgeCount(touching) * 2)),
        summary: latest?.free_text?.slice(0, 240) ?? null,
        confidence: latest?.confidence ?? null,
      };
    });
    const start = (data.page - 1) * data.pageSize;
    return { rows: rows.slice(start, start + data.pageSize), total: rows.length, page: data.page, pageSize: data.pageSize };
  });

export const getLead = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ key: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    const { data: record, error } = await db.from("crm_records").select("*").eq("id", data.key).maybeSingle();
    if (error) throw new Error(error.message);
    if (!record) return null;
    const { data: mappings, error: mapError } = await db.from("crm_mappings").select("*").eq("record_id", record.id);
    if (mapError) throw new Error(mapError.message);
    const nodeIds = (mappings ?? []).map((mapping) => mapping.node_id);
    const records = nodeIds.length ? await selectIn((ids) => db.from("nodes").select("*").in("id", ids), nodeIds) : [];
    const runIds = [...new Set((mappings ?? []).map((mapping) => mapping.run_id))];
    const [{ data: runs }, assertions, edges] = await Promise.all([
      runIds.length ? db.from("runs").select("id, objective, status, outcome, created_at").in("id", runIds) : Promise.resolve({ data: [] as { id: string; objective: string; status: string; outcome: string | null; created_at: string }[] }),
      nodeIds.length ? selectIn((ids) => db.from("assertions").select("*").in("owner_node_id", ids), nodeIds) : Promise.resolve([]),
      nodeIds.length ? selectIn((ids) => db.from("edges").select("*").or(`from_node.in.(${ids.join(",")}),to_node.in.(${ids.join(",")})`), nodeIds) : Promise.resolve([]),
    ]);
    const otherIds = [...new Set(edges.flatMap((edge) => [edge.from_node, edge.to_node]).filter((id) => !nodeIds.includes(id)))];
    const linked = otherIds.length
      ? await selectIn((ids) => db.from("nodes").select("id, run_id, category, entity_type, semantic_kind, title, fields, content, free_text, confidence, locator, provider, published_at, created_at").in("id", ids), otherIds)
      : [];
    const relatedMaps = otherIds.length ? await selectIn((ids) => db.from("crm_mappings").select("record_id, node_id").in("node_id", ids), otherIds) : [];
    const recordByNode = new Map(relatedMaps.map((mapping) => [mapping.node_id, mapping.record_id]));
    const byId = new Map(linked.map((node) => [node.id, node]));
    const links = edges.map((edge) => {
      const otherId = nodeIds.includes(edge.from_node) ? edge.to_node : edge.from_node;
      const node = byId.get(otherId);
      if (!node) return null;
      return {
        relation: edge.relation,
        polarity: edge.polarity,
        stance: edge.relation === "works_at" ? employmentStance(edge.polarity) : null,
        rationale: edge.rationale,
        score: edge.score,
        recordId: recordByNode.get(otherId) ?? null,
        node,
      };
    }).filter((link) => link != null);
    const overrides = (record.overrides ?? {}) as Record<string, string>;
    return {
      key: record.id,
      kind: record.kind,
      records,
      runs: runs ?? [],
      links,
      assertions,
      conflicts: conflictingFields(records.map((node) => ({ runId: node.run_id, fields: (node.fields ?? {}) as Record<string, unknown> }))),
      evidenceCount: evidenceEdgeCount(edges),
      crm: { stage: record.stage, starred: record.starred, notes: record.notes, updated_at: record.updated_at, overrides },
    };
  });

export const updateLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    key: z.string().uuid(),
    stage: z.enum(STAGES).optional(),
    notes: z.string().max(10000).nullable().optional(),
    starred: z.boolean().optional(),
    overrides: z.record(z.string(), z.string().max(500)).optional(),
    expectedUpdatedAt: z.string().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    const { data: current, error: readError } = await db.from("crm_records").select("id, overrides, updated_at").eq("id", data.key).maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!current) throw new Error("CRM record not found");
    if (data.expectedUpdatedAt && current.updated_at !== data.expectedUpdatedAt) throw new Error("This record changed. Reload it and try again.");
    const overrides = { ...((current.overrides ?? {}) as Record<string, string>) };
    for (const [field, value] of Object.entries(data.overrides ?? {})) {
      if (!isEditableField(field)) throw new Error(`Cannot edit ${field}`);
      if (!value.trim()) delete overrides[field];
      else overrides[field] = value.trim();
    }
    const now = new Date().toISOString();
    const patch: { updated_at: string; stage?: string; notes?: string | null; starred?: boolean; overrides: Record<string, string> } = { updated_at: now, overrides };
    if (data.stage !== undefined) patch.stage = data.stage;
    if (data.notes !== undefined) patch.notes = data.notes;
    if (data.starred !== undefined) patch.starred = data.starred;
    const { error } = await db.from("crm_records").update(patch).eq("id", data.key).eq("updated_at", current.updated_at);
    if (error) throw new Error(error.message);
    return { ok: true, updatedAt: now };
  });

export const getCrmTransfer = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: run, error } = await context.supabase.from("runs").select("id, user_id, outcome, graph_revision").eq("id", data.id).single();
    if (error) throw new Error(error.message);
    if (run.outcome !== "consensus") return null;
    return ensureCrmTransfer(context.supabase, run, false);
  });

export const retryCrmTransfer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: run, error } = await context.supabase.from("runs").select("id, user_id, outcome, graph_revision").eq("id", data.id).single();
    if (error) throw new Error(error.message);
    if (run.outcome !== "consensus") throw new Error("Only a successful completion can be sent to the CRM");
    return ensureCrmTransfer(context.supabase, run, true);
  });

export const listCrmTransfers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("crm_transfers").select("*");
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => ({ runId: row.run_id, ...readTransfer(row) }));
  });

export const getRunEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string(), after: z.number().default(0) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("events").select("id, kind, agent_index, payload, created_at")
      .eq("run_id", data.id).gt("id", data.after).order("id", { ascending: true }).limit(1000);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
