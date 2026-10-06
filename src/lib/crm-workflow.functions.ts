import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database, Json } from "@/integrations/supabase/types";
import { crmWorkingPatchSchema, defaultCrmWorkingState } from "./crm-workflow";
import type { CrmWorkingHistory, CrmWorkingState, CrmSaveResult } from "./crm-workflow";

type Table<Row> = { Row: Row; Insert: never; Update: never; Relationships: [] };
export type WorkflowDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables" | "Functions"> & {
    Tables: Database["public"]["Tables"] & {
      crm_records: Table<{ id: string; user_id: string }>;
      crm_record_working_state: Table<CrmWorkingState>;
      crm_record_working_history: Table<CrmWorkingHistory>;
    };
    Functions: Database["public"]["Functions"] & {
      save_crm_working_state: {
        Args: { p_record_id: string; p_expected_version: number; p_stage: string; p_starred: boolean; p_notes: string | null; p_overrides: Json };
        Returns: Json;
      };
    };
  };
};

export const getCrmWorkingState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ recordId: z.string().uuid() }).strict().parse(input))
  .handler(async ({ data, context }) => {
    const db = context.supabase as unknown as SupabaseClient<WorkflowDatabase>;
    const { data: record, error: recordError } = await db.from("crm_records").select("id").eq("id", data.recordId).eq("user_id", context.userId).maybeSingle();
    if (recordError) throw new Error(recordError.message);
    if (!record) throw new Error("CRM record not found or not accessible");
    const [state, history] = await Promise.all([
      db.from("crm_record_working_state").select("*").eq("record_id", data.recordId).maybeSingle(),
      db.from("crm_record_working_history").select("*").eq("record_id", data.recordId).order("version", { ascending: false }).limit(30),
    ]);
    if (state.error) throw new Error(state.error.message);
    if (history.error) throw new Error(history.error.message);
    return { state: state.data ?? defaultCrmWorkingState(data.recordId, context.userId), history: history.data ?? [] };
  });

export const saveCrmWorkingState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => crmWorkingPatchSchema.parse(input))
  .handler(async ({ data, context }): Promise<CrmSaveResult> => {
    const db = context.supabase as unknown as SupabaseClient<WorkflowDatabase>;
    const result = await db.rpc("save_crm_working_state", {
      p_record_id: data.recordId,
      p_expected_version: data.expectedVersion,
      p_stage: data.stage,
      p_starred: data.starred,
      p_notes: data.notes,
      p_overrides: data.overrides,
    });
    if (result.error) throw new Error(result.error.message);
    if (!result.data) throw new Error("CRM save returned no result");
    return result.data as unknown as CrmSaveResult;
  });
