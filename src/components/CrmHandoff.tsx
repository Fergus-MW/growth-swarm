import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getCrmTransfer, retryCrmTransfer } from "@/lib/leads.functions";

const PARTIAL: Record<string, string> = {
  stopped_by_user: "Stopped before completion",
  budget_cost: "Stopped when the cost budget was reached",
  budget_wall_clock: "Stopped when the time limit was reached",
  criteria_unmet: "Finished with the criteria still unmet",
  failed: "Research failed",
};

export function CrmHandoff({ runId, outcome }: { runId: string; outcome: string }) {
  const queryClient = useQueryClient();
  const load = useServerFn(getCrmTransfer);
  const retry = useServerFn(retryCrmTransfer);
  const successful = outcome === "consensus";
  const transfer = useQuery({
    queryKey: ["crm-transfer", runId],
    queryFn: () => load({ data: { id: runId } }),
    enabled: successful,
    refetchInterval: (query) => query.state.data?.status === "pending" ? 2000 : false,
  });

  if (!successful) {
    return (
      <div className="border-b border-border bg-card px-4 py-2 text-xs text-muted-foreground">
        Partial result — {PARTIAL[outcome] ?? outcome}. The graph stays available. CRM transfer waits for a successful completion.
      </div>
    );
  }

  const state = transfer.data;
  if (transfer.isLoading || !state || state.status === "pending") {
    return <div className="border-b border-border bg-card px-4 py-2 text-xs text-muted-foreground">Research complete. Preparing CRM records…</div>;
  }
  if (state.status === "failed") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-destructive/40 bg-card px-4 py-2 text-xs">
        <span className="text-destructive">Research is saved. CRM transfer failed{state.error ? `: ${state.error}` : "."}</span>
        <button className="rounded-md border border-border px-2 py-1 hover:border-primary" onClick={async () => {
          try {
            await retry({ data: { id: runId } });
            await transfer.refetch();
            queryClient.invalidateQueries({ queryKey: ["leads"] });
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Retry failed");
          }
        }}>Retry transfer</button>
      </div>
    );
  }
  if (state.sourceCount === 0) {
    return <div className="border-b border-border bg-card px-4 py-2 text-xs text-muted-foreground">Research complete. This run had no companies or people to add to the CRM.</div>;
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-4 py-2 text-xs">
      <span>CRM ready · {state.companyCount} companies · {state.personCount} people · {state.createdCount} new · {state.reusedCount} already in the CRM</span>
      <Link to="/leads" search={{ run: runId }} className="rounded-md bg-primary px-3 py-1 font-semibold text-primary-foreground">Open in CRM</Link>
    </div>
  );
}
