import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildCrmList, readAllCrmPages } from "@/lib/crm-list";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkflowDatabase } from "@/lib/crm-workflow.functions";

export const listCrmRecords = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase;
    const workflowDb = db as unknown as SupabaseClient<WorkflowDatabase>;
    const [records, sources, runs, workingState] = await Promise.all([
      readAllCrmPages((from, to) =>
        db
          .from("crm_records")
          .select("id, entity_type, title, fields, created_at")
          .eq("user_id", context.userId)
          .order("id")
          .range(from, to),
      ),
      readAllCrmPages((from, to) =>
        db
          .from("crm_record_sources")
          .select("id, crm_record_id, run_id, node_id, snapshot")
          .eq("user_id", context.userId)
          .order("id")
          .range(from, to),
      ),
      readAllCrmPages((from, to) =>
        db
          .from("runs")
          .select("id, objective")
          .eq("user_id", context.userId)
          .order("id")
          .range(from, to),
      ),
      readAllCrmPages((from, to) =>
        workflowDb.from("crm_record_working_state").select("*")
          .eq("user_id", context.userId).order("record_id").range(from, to),
      ),
    ]);
    const runIds = [...new Set(sources.map((source) => source.run_id))];
    const edges = [];
    // Bound each URL and page; RLS also verifies access to the source runs.
    for (let index = 0; index < runIds.length; index += 50) {
      edges.push(
        ...(await readAllCrmPages((from, to) =>
          db
            .from("edges")
            .select("run_id, from_node, to_node, polarity")
            .eq("relation", "works_at")
            .in("run_id", runIds.slice(index, index + 50))
            .order("id")
            .range(from, to),
        )),
      );
    }
    const primaryRecords = records.filter(
      (record): record is typeof record & { entity_type: "company" | "person" } =>
        record.entity_type === "company" || record.entity_type === "person",
    );
    return buildCrmList(primaryRecords, sources, runs, edges, workingState);
  });
