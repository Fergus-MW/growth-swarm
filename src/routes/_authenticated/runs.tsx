import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Radar, Plus, Square, GitBranch, Download, Loader2 } from "lucide-react";
import { listRuns, stopRun, continueRun, exportRun } from "@/lib/runs.functions";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";

export const Route = createFileRoute("/_authenticated/runs")({
  head: () => ({
    meta: [
      { title: "Research runs — Auto Research" },
      { name: "description", content: "Your research swarm runs: outcomes, progress, spend, and lineage." },
      { property: "og:title", content: "Research runs — Auto Research" },
      { property: "og:description", content: "Your research swarm runs: outcomes, progress, spend, and lineage." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RunsPage,
});

const OUTCOME_LABEL: Record<string, string> = {
  consensus: "Consensus reached",
  stopped_by_user: "Stopped by you",
  budget_cost: "Cost budget reached",
  budget_wall_clock: "Time limit reached",
  criteria_unmet: "Criteria unmet",
  failed: "Failed",
  disconnected: "Disconnected",
};

function RunsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fetchRuns = useServerFn(listRuns);
  const stop = useServerFn(stopRun);
  const cont = useServerFn(continueRun);
  const exp = useServerFn(exportRun);

  const { data: runs, isLoading } = useQuery({
    queryKey: ["runs"],
    queryFn: () => fetchRuns(),
    refetchInterval: 5000,
  });

  async function handleStop(id: string) {
    await stop({ data: { id } });
    toast.message("Stop requested — the run will finalize and save.");
    queryClient.invalidateQueries({ queryKey: ["runs"] });
  }

  async function handleContinue(id: string) {
    try {
      const child = await cont({ data: { id } });
      toast.success("Child run created — edit the brief, then launch.");
      navigate({ to: "/setup", search: { from: child.id } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not continue run");
    }
  }

  async function handleExport(id: string) {
    const data = await exp({ data: { id } });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `auto-research-${id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />

      <main className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="text-2xl font-bold">Research runs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Outcome, progress, spend, and lineage. Partial results stay inspectable.
        </p>

        {isLoading && (
          <div className="mt-16 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        )}

        {runs && runs.length === 0 && (
          <div className="mt-16 rounded-xl border border-dashed border-border p-12 text-center">
            <p className="text-muted-foreground">No runs yet. State a pain and a universe, and launch your first swarm.</p>
            <Link to="/setup" className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground">
              <Plus className="h-4 w-4" /> Create a run
            </Link>
          </div>
        )}

        <div className="mt-6 space-y-3">
          {runs?.map((run) => {
            const stats = (run.stats ?? {}) as { companies?: number; qualified?: number; signals?: number; people?: number; chunks?: number; openTasks?: number; doneTasks?: number };
            const live = run.status === "running" || run.status === "stopping";
            return (
              <div key={run.id} className="rounded-lg border border-border bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <Link
                      to="/runs/$runId"
                      params={{ runId: run.id }}
                      className="block truncate text-sm font-semibold hover:text-primary"
                    >
                      {run.objective}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-2 font-data text-xs text-muted-foreground">
                      <span className={live ? "text-primary" : ""}>
                        {live && <span className="animate-pulse-dot mr-1 inline-block h-1.5 w-1.5 rounded-full bg-primary align-middle" />}
                        {run.status === "draft" ? "Draft" : run.outcome ? (OUTCOME_LABEL[run.outcome] ?? run.outcome) : run.status}
                      </span>
                      <span>·</span>
                      <span>{run.swarm_size} agents @ {Math.round(run.threshold * 100)}%</span>
                      <span>·</span>
                      <span>${Number(run.spend).toFixed(3)} / ${Number(run.cost_cap).toFixed(2)}</span>
                      {run.parent_run_id && (
                        <>
                          <span>·</span>
                          <span className="inline-flex items-center gap-1"><GitBranch className="h-3 w-3" /> child run</span>
                        </>
                      )}
                    </div>
                    {(stats["companies"] != null) && (
                      <div className="mt-2 flex flex-wrap gap-3 font-data text-xs text-muted-foreground">
                        <span><span className="text-entity">{stats.qualified ?? 0}</span>/{stats.companies ?? 0} qualified</span>
                        <span><span className="text-note">{stats.signals ?? 0}</span> signals</span>
                        <span><span className="text-entity">{stats.people ?? 0}</span> people</span>
                        <span><span className="text-chunk">{stats.chunks ?? 0}</span> sources</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {live && (
                      <button
                        onClick={() => handleStop(run.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-destructive px-3 py-1.5 text-xs text-destructive hover:bg-destructive hover:text-destructive-foreground"
                      >
                        <Square className="h-3 w-3" /> Stop
                      </button>
                    )}
                    {!live && run.status !== "draft" && (
                      <>
                        <button
                          onClick={() => handleContinue(run.id)}
                          className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs hover:border-primary hover:text-primary"
                        >
                          <GitBranch className="h-3 w-3" /> Continue
                        </button>
                        <button
                          onClick={() => handleExport(run.id)}
                          className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs hover:border-primary hover:text-primary"
                        >
                          <Download className="h-3 w-3" /> Export
                        </button>
                      </>
                    )}
                    {run.status === "draft" && (
                      <Link
                        to="/setup"
                        search={{ from: run.id }}
                        className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
                      >
                        Configure & launch
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
