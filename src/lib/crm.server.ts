import { planTransfer, type TransferEdge, type TransferNode } from "./crm.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;

export interface CrmTransferState {
  status: "pending" | "ready" | "failed";
  error: string | null;
  sourceCount: number;
  createdCount: number;
  reusedCount: number;
  failedCount: number;
  companyCount: number;
  personCount: number;
}

interface RunRef {
  id: string;
  user_id: string;
  graph_revision: number;
}

const inflight = new Map<string, Promise<CrmTransferState>>();

export function readTransfer(row: any): CrmTransferState {
  return {
    status: row.status,
    error: row.error ?? null,
    sourceCount: row.source_count ?? 0,
    createdCount: row.created_count ?? 0,
    reusedCount: row.reused_count ?? 0,
    failedCount: row.failed_count ?? 0,
    companyCount: row.company_count ?? 0,
    personCount: row.person_count ?? 0,
  };
}

/** Finish a successful run's CRM copy. A ready transfer is left untouched. */
export async function ensureCrmTransfer(db: Db, run: RunRef, force = false): Promise<CrmTransferState> {
  const key = run.id;
  const pending = inflight.get(key);
  if (pending) return pending;
  const job = transferOnce(db, run, force).finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

async function transferOnce(db: Db, run: RunRef, force: boolean): Promise<CrmTransferState> {
  try {
    const { data: existing } = await db.from("crm_transfers").select("*").eq("run_id", run.id).maybeSingle();
    if (existing?.status === "ready") return readTransfer(existing);
    if (existing?.status === "failed" && !force) return readTransfer(existing);
    await db.from("crm_transfers").upsert({
      run_id: run.id,
      user_id: run.user_id,
      status: "pending",
      error: null,
      graph_revision: run.graph_revision ?? 0,
      updated_at: new Date().toISOString(),
    }, { onConflict: "run_id" });
    const [{ data: nodes }, { data: edges }, { data: records }] = await Promise.all([
      db.from("nodes").select("id, run_id, revision, entity_type, title, fields, category").eq("run_id", run.id).eq("category", "primary_entity"),
      db.from("edges").select("relation, from_node, to_node, polarity").eq("run_id", run.id),
      db.from("crm_records").select("identity_key").eq("user_id", run.user_id),
    ]);
    const graphNodes: TransferNode[] = (nodes ?? []).map((node: any) => ({
      id: node.id,
      runId: node.run_id,
      revision: node.revision ?? 1,
      entityType: node.entity_type,
      title: node.title ?? "",
      fields: (node.fields ?? {}) as Record<string, unknown>,
    }));
    const graphEdges: TransferEdge[] = (edges ?? []).map((edge: any) => ({
      relation: edge.relation,
      from: edge.from_node,
      to: edge.to_node,
      polarity: edge.polarity ?? null,
    }));
    const plan = planTransfer(graphNodes, graphEdges, new Set((records ?? []).map((row: any) => row.identity_key as string)));
    let created = 0;
    let reused = 0;
    let failed = 0;
    let error: string | null = null;
    for (const mapping of plan.mappings) {
      try {
        const recordId = await reuseOrCreate(db, run.user_id, mapping.kind, mapping.identityKey);
        if (recordId.created) created += 1;
        else reused += 1;
        const { error: mapError } = await db.from("crm_mappings").upsert({
          user_id: run.user_id,
          record_id: recordId.id,
          run_id: mapping.runId,
          node_id: mapping.nodeId,
          revision: mapping.revision,
        }, { onConflict: "user_id,run_id,node_id" });
        if (mapError) throw new Error(mapError.message);
      } catch (failure) {
        failed += 1;
        error = failure instanceof Error ? failure.message : "CRM record failed";
      }
    }
    const state: CrmTransferState = {
      status: failed > 0 ? "failed" : "ready",
      error,
      sourceCount: plan.sourceCount,
      createdCount: created,
      reusedCount: reused,
      failedCount: failed,
      companyCount: plan.companyCount,
      personCount: plan.personCount,
    };
    await writeState(db, run, state);
    return state;
  } catch (failure) {
    const state: CrmTransferState = {
      status: "failed",
      error: failure instanceof Error ? failure.message : "CRM transfer failed",
      sourceCount: 0,
      createdCount: 0,
      reusedCount: 0,
      failedCount: 0,
      companyCount: 0,
      personCount: 0,
    };
    try {
      await writeState(db, run, state);
    } catch {
      state.error = state.error ?? "CRM transfer could not be saved";
    }
    return state;
  }
}

async function reuseOrCreate(db: Db, userId: string, kind: string, identityKey: string): Promise<{ id: string; created: boolean }> {
  const { data: found } = await db.from("crm_records").select("id").eq("user_id", userId).eq("identity_key", identityKey).maybeSingle();
  if (found?.id) return { id: found.id, created: false };
  const { data, error } = await db.from("crm_records").insert({ user_id: userId, kind, identity_key: identityKey }).select("id").single();
  if (data?.id) return { id: data.id, created: true };
  const { data: raced } = await db.from("crm_records").select("id").eq("user_id", userId).eq("identity_key", identityKey).maybeSingle();
  if (raced?.id) return { id: raced.id, created: false };
  throw new Error(error?.message ?? "Could not create CRM record");
}

async function writeState(db: Db, run: RunRef, state: CrmTransferState): Promise<void> {
  await db.from("crm_transfers").upsert({
    run_id: run.id,
    user_id: run.user_id,
    status: state.status,
    error: state.error,
    graph_revision: run.graph_revision ?? 0,
    source_count: state.sourceCount,
    created_count: state.createdCount,
    reused_count: state.reusedCount,
    failed_count: state.failedCount,
    company_count: state.companyCount,
    person_count: state.personCount,
    updated_at: new Date().toISOString(),
  }, { onConflict: "run_id" });
}
