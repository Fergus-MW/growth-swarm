import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Dedupe key: website domain when known, else normalized company name. */
export function leadKeyFor(title: string, fields: any): string {
  const site = typeof fields?.website === "string" ? fields.website : "";
  if (site) {
    const host = site.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split(/[/?#]/)[0]?.toLowerCase();
    if (host) return host;
  }
  return title.toLowerCase().replace(/\b(inc|ltd|llc|gmbh|oü|as|ab|plc|corp)\b\.?/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const STATUS_WEIGHT: Record<string, number> = { qualified: 60, candidate: 25, unclear: 20, rejected: 0 };

export const listLeads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase;
    const [{ data: companies, error }, { data: runs }, { data: leadRows }] = await Promise.all([
      db.from("nodes").select("id, run_id, title, fields, confidence, free_text, created_at").eq("category", "primary_entity").eq("entity_type", "company"),
      db.from("runs").select("id, objective"),
      db.from("leads").select("*"),
    ]);
    if (error) throw new Error(error.message);
    const ids = (companies ?? []).map((c) => c.id);
    const [{ data: edges }, { data: assertions }] = await Promise.all([
      ids.length ? db.from("edges").select("from_node, to_node, relation").or(`from_node.in.(${ids.join(",")}),to_node.in.(${ids.join(",")})`) : Promise.resolve({ data: [] as any[] }),
      ids.length ? db.from("assertions").select("owner_node_id").in("owner_node_id", ids) : Promise.resolve({ data: [] as any[] }),
    ]);
    const edgeCount = new Map<string, number>();
    const contactCount = new Map<string, number>();
    for (const e of edges ?? []) {
      for (const n of [e.from_node, e.to_node]) edgeCount.set(n, (edgeCount.get(n) ?? 0) + 1);
      if (e.relation === "works_at" || e.relation === "best_contact_for") {
        const c = ids.includes(e.to_node) ? e.to_node : e.from_node;
        contactCount.set(c, (contactCount.get(c) ?? 0) + 1);
      }
    }
    const claimCount = new Map<string, number>();
    for (const a of assertions ?? []) claimCount.set(a.owner_node_id, (claimCount.get(a.owner_node_id) ?? 0) + 1);
    const runName = new Map((runs ?? []).map((r) => [r.id, r.objective]));
    const crm = new Map((leadRows ?? []).map((l) => [l.lead_key, l]));

    const merged = new Map<string, any>();
    for (const c of companies ?? []) {
      const key = leadKeyFor(c.title, c.fields);
      const f = (c.fields ?? {}) as any;
      const m = merged.get(key) ?? { key, name: c.title, website: null, location: null, size: null, status: "candidate", runs: [] as { id: string; objective: string }[], evidence: 0, contacts: 0, claims: 0, firstSeen: c.created_at, summary: null };
      m.website ||= f.website ?? null;
      m.location ||= f.location ?? null;
      m.size ||= f.size ?? null;
      if ((STATUS_WEIGHT[f.status] ?? 0) > (STATUS_WEIGHT[m.status] ?? 0)) m.status = f.status;
      if (!m.runs.some((r: any) => r.id === c.run_id)) m.runs.push({ id: c.run_id, objective: runName.get(c.run_id) ?? "" });
      m.evidence += edgeCount.get(c.id) ?? 0;
      m.contacts += contactCount.get(c.id) ?? 0;
      m.claims += claimCount.get(c.id) ?? 0;
      m.summary ||= c.free_text?.slice(0, 240) ?? null;
      if (c.created_at < m.firstSeen) m.firstSeen = c.created_at;
      merged.set(key, m);
    }
    return [...merged.values()]
      .map((m) => {
        const l = crm.get(m.key);
        const score = Math.min(100, Math.round((STATUS_WEIGHT[m.status] ?? 10) + Math.min(20, m.evidence * 2) + Math.min(10, m.contacts * 5) + Math.min(10, m.claims) + (m.runs.length > 1 ? 5 : 0)));
        return { ...m, score, stage: l?.stage ?? "new", starred: l?.starred ?? false, notes: l?.notes ?? null };
      })
      .sort((a, b) => b.score - a.score);
  });

export const getLead = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ key: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    const { data: companies } = await db.from("nodes").select("*").eq("category", "primary_entity").eq("entity_type", "company");
    const matches = (companies ?? []).filter((c) => leadKeyFor(c.title, c.fields) === data.key);
    if (!matches.length) return null;
    const ids = matches.map((m) => m.id);
    const runIds = [...new Set(matches.map((m) => m.run_id))];
    const [{ data: edges }, { data: assertions }, { data: runs }, { data: crm }] = await Promise.all([
      db.from("edges").select("*").or(`from_node.in.(${ids.join(",")}),to_node.in.(${ids.join(",")})`),
      db.from("assertions").select("*").in("owner_node_id", ids).order("created_at", { ascending: false }),
      db.from("runs").select("id, objective, status, outcome, created_at").in("id", runIds),
      db.from("leads").select("*").eq("lead_key", data.key).maybeSingle(),
    ]);
    const otherIds = [...new Set((edges ?? []).flatMap((e) => [e.from_node, e.to_node]).filter((n) => !ids.includes(n)))];
    const { data: linked } = otherIds.length
      ? await db.from("nodes").select("id, run_id, category, entity_type, editorial_type, semantic_kind, title, fields, content, free_text, confidence, locator, provider, published_at, created_at").in("id", otherIds)
      : { data: [] as any[] };
    const byId = new Map((linked ?? []).map((n) => [n.id, n]));
    const links = (edges ?? []).map((e) => {
      const otherId = ids.includes(e.from_node) ? e.to_node : e.from_node;
      return { relation: e.relation, polarity: e.polarity, rationale: e.rationale, score: e.score, node: byId.get(otherId) ?? null };
    }).filter((l) => l.node);
    return { key: data.key, records: matches, runs: runs ?? [], links, assertions: assertions ?? [], crm: crm ?? null };
  });

export const updateLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ key: z.string().min(1), stage: z.string().max(40).optional(), notes: z.string().max(10000).nullable().optional(), starred: z.boolean().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const patch: any = { user_id: context.userId, lead_key: data.key, updated_at: new Date().toISOString() };
    if (data.stage !== undefined) patch.stage = data.stage;
    if (data.notes !== undefined) patch.notes = data.notes;
    if (data.starred !== undefined) patch.starred = data.starred;
    const { error } = await context.supabase.from("leads").upsert(patch as any, { onConflict: "user_id,lead_key" });
    if (error) throw new Error(error.message);
    return { ok: true };
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

export const getAgentHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string(), agent: z.number().int().min(0).max(99), before: z.number().int().positive().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    let query = context.supabase.from("events")
      .select("id, kind, agent_index, payload, created_at")
      .eq("run_id", data.id).eq("agent_index", data.agent);
    if (data.before !== undefined) query = query.lt("id", data.before);
    const { data: rows, error } = await query.order("id", { ascending: false }).limit(100);
    if (error) throw new Error(error.message);
    return (rows ?? []).reverse();
  });
