import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { readAllCrmPages } from "./crm-list";

type LegacyImport = {
  legacy_id: string;
  user_id: string;
  status: string;
  candidate_count: number;
  imported_record_id: string | null;
  legacy_snapshot: Json;
  created_at: string;
};
type LegacyDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables"> & {
    Tables: Database["public"]["Tables"] & {
      crm_legacy_workflow_imports: {
        Row: LegacyImport;
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
  };
};

export const getLegacyCrmEdits = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as unknown as SupabaseClient<LegacyDatabase>;
    const [leads, imports] = await Promise.all([
      readAllCrmPages((from, to) =>
        db.from("leads").select("*").eq("user_id", context.userId).order("id").range(from, to),
      ),
      readAllCrmPages((from, to) =>
        db
          .from("crm_legacy_workflow_imports")
          .select("*")
          .eq("user_id", context.userId)
          .order("legacy_id")
          .range(from, to),
      ),
    ]);
    const byId = new Map(imports.map((entry) => [entry.legacy_id, entry]));
    return leads.map((lead) => {
      const imported = byId.get(lead.id);
      const snapshot = imported?.legacy_snapshot;
      const previous =
        snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot : {};
      return {
        id: lead.id,
        key: lead.lead_key,
        stage: lead.stage,
        starred: lead.starred,
        notes: lead.notes,
        status: imported?.status ?? "unmatched",
        changedSinceImport:
          !!imported &&
          (previous["stage"] !== lead.stage ||
            previous["starred"] !== lead.starred ||
            previous["notes"] !== lead.notes),
        candidateCount: imported?.candidate_count ?? 0,
      };
    });
  });
