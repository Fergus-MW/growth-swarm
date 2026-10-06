import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const runInput = z.object({ runId: z.string().uuid() });

/** Research completion and CRM delivery are deliberately separate states. */
export const getCrmTransfer = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => runInput.parse(data))
  .handler(async ({ data, context }) => {
    const { data: run, error: runError } = await context.supabase
      .from("runs")
      .select("id")
      .eq("id", data.runId)
      .single();
    if (runError || !run) throw new Error("Run not found");
    const { data: transfer, error } = await context.supabase
      .from("crm_transfers")
      .select("*")
      .eq("run_id", data.runId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return transfer;
  });

/** Replays only the durable transfer; it never launches research or paid calls. */
export const retryCrmTransfer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => runInput.parse(data))
  .handler(async ({ data, context }) => {
    const { data: transfer, error } = await context.supabase.rpc("retry_crm_transfer", {
      p_run_id: data.runId,
    });
    if (error) throw new Error(error.message);
    return transfer;
  });
