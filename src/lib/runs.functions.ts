import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createRunInput } from "@/lib/run-input";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const createRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => createRunInput.parse(data))
  .handler(async ({ data, context }) => {
    const { data: run, error } = await context.supabase
      .from("runs")
      .insert({
        user_id: context.userId,
        status: "draft",
        profile: data.profile,
        objective: data.objective,
        pain: data.pain ?? null,
        universe: data.universe ?? null,
        exclusions: data.exclusions ?? null,
        completion_criteria: data.completion_criteria,
        swarm_size: data.swarm_size,
        threshold: data.threshold,
        time_limit_sec: data.time_limit_sec,
        cost_cap: data.cost_cap,
        connectors: data.connectors,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: run.id as string };
  });

export const startRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string() }).parse(data))
  .handler(async ({ data, context }) => {
    // Fenced start: only a draft run can transition to running, once.
    const { data: run, error } = await context.supabase
      .from("runs")
      .update({ status: "running", started_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("status", "draft")
      .select("id")
      .single();
    if (error || !run) {
      // Duplicate start: return current status instead of launching again.
      const { data: existing } = await context.supabase.from("runs").select("status").eq("id", data.id).single();
      return { ok: true, status: existing?.status ?? "unknown" };
    }
    return { ok: true, status: "running" };
  });

export const listRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("runs")
      .select("id, objective, profile, status, outcome, swarm_size, threshold, spend, cost_cap, stats, created_at, started_at, ended_at, parent_run_id")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data;
  });

export const getRun = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: run, error } = await context.supabase.from("runs").select("*").eq("id", data.id).single();
    if (error) throw new Error(error.message);
    const [{ data: nodes }, { data: edges }, { data: votes }, { data: invocations }, { data: checkpoints }] =
      await Promise.all([
        context.supabase.from("nodes").select("*").eq("run_id", data.id).order("created_at", { ascending: true }),
        context.supabase.from("edges").select("*").eq("run_id", data.id),
        context.supabase.from("votes").select("*").eq("run_id", data.id).order("created_at", { ascending: false }).limit(200),
        context.supabase.from("invocations").select("*").eq("run_id", data.id).order("started_at", { ascending: false }).limit(200),
        context.supabase.from("checkpoints").select("*").eq("run_id", data.id).order("created_at", { ascending: false }).limit(1),
      ]);
    return { run, nodes: nodes ?? [], edges: edges ?? [], votes: votes ?? [], invocations: invocations ?? [], lastCheckpoint: checkpoints?.[0] ?? null };
  });

export const stopRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string() }).parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("runs").update({ stop_requested: true, status: "stopping" }).eq("id", data.id).eq("status", "running");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const executeWindow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string() }).parse(data))
  .handler(async ({ data, context }) => {
    const { executeWindow: run } = await import("@/lib/swarm.server");
    return run(context.supabase, data.id);
  });

export const continueRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: parent, error } = await context.supabase.from("runs").select("*").eq("id", data.id).single();
    if (error || !parent) throw new Error("Parent run not found");
    if (parent.status === "running" || parent.status === "stopping") throw new Error("Parent is still live — stop it first");

    // Child inherits the brief and authorized source observations; parent stays immutable.
    const { data: child, error: childError } = await context.supabase
      .from("runs")
      .insert({
        user_id: context.userId,
        parent_run_id: parent.id,
        profile: parent.profile,
        objective: parent.objective,
        pain: parent.pain,
        universe: parent.universe,
        exclusions: parent.exclusions,
        completion_criteria: parent.completion_criteria,
        swarm_size: parent.swarm_size,
        threshold: parent.threshold,
        time_limit_sec: parent.time_limit_sec,
        cost_cap: parent.cost_cap,
        connectors: parent.connectors,
        status: "draft",
        assessment_version: parent.assessment_version + 1,
      })
      .select("id")
      .single();
    if (childError) throw new Error(childError.message);

    // Copy authorized graph content (chunks, entities, notes, edges, assertions).
    const [{ data: nodes }, { data: edges }, { data: assertions }] = await Promise.all([
      context.supabase.from("nodes").select("*").eq("run_id", parent.id),
      context.supabase.from("edges").select("*").eq("run_id", parent.id),
      context.supabase.from("assertions").select("*").eq("run_id", parent.id),
    ]);
    const idMap = new Map<string, string>();
    for (const n of nodes ?? []) {
      const { data: inserted } = await context.supabase
        .from("nodes")
        .insert({
          run_id: child.id,
          category: n.category,
          entity_type: n.entity_type,
          editorial_type: n.editorial_type,
          semantic_kind: n.semantic_kind,
          title: n.title,
          aliases: n.aliases,
          fields: n.fields,
          free_text: n.free_text,
          confidence: n.confidence,
          provenance: n.provenance,
          content: n.content,
          locator: n.locator,
          provider: n.provider,
          connector: n.connector,
          content_hash: n.content_hash,
          is_snippet: n.is_snippet,
          published_at: n.published_at,
          event_at: n.event_at,
          fetched_at: n.fetched_at,
        })
        .select("id")
        .single();
      if (inserted) idMap.set(n.id, inserted.id);
    }
    for (const e of edges ?? []) {
      const from = idMap.get(e.from_node);
      const to = idMap.get(e.to_node);
      if (from && to) {
        await context.supabase.from("edges").insert({
          run_id: child.id,
          relation: e.relation,
          from_node: from,
          to_node: to,
          polarity: e.polarity,
          score: e.score,
          rationale: e.rationale,
        });
      }
    }
    for (const a of assertions ?? []) {
      const owner = idMap.get(a.owner_node_id);
      if (owner) {
        await context.supabase.from("assertions").insert({
          run_id: child.id,
          owner_node_id: owner,
          field_key: a.field_key,
          claim: a.claim,
          confidence: a.confidence,
          assessment_version: parent.assessment_version, // historical until recomputed
          evidence: a.evidence,
        });
      }
    }
    return { id: child.id as string };
  });

export const exportRun = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: run, error } = await context.supabase.from("runs").select("*").eq("id", data.id).single();
    if (error) throw new Error(error.message);
    const [{ data: nodes }, { data: edges }, { data: assertions }, { data: invocations }] = await Promise.all([
      context.supabase.from("nodes").select("*").eq("run_id", data.id),
      context.supabase.from("edges").select("*").eq("run_id", data.id),
      context.supabase.from("assertions").select("*").eq("run_id", data.id),
      context.supabase.from("invocations").select("*").eq("run_id", data.id),
    ]);
    const partial = run.status !== "completed";
    return {
      manifest: {
        objective: run.objective,
        outcome: run.outcome,
        status: run.status,
        partial,
        quality_warning: partial ? "This is a partial result; quality gates may not have passed." : null,
        spend: run.spend,
        revision: run.graph_revision,
        exported_at: new Date().toISOString(),
      },
      nodes: nodes ?? [],
      edges: edges ?? [],
      assertions: assertions ?? [],
      source_ledger: invocations ?? [],
    };
  });
