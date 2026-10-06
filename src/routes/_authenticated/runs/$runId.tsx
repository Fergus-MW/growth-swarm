import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Radar,
  Square,
  Download,
  GitBranch,
  Loader2,
  FileText,
  Building2,
  User,
  Database,
  ScrollText,
} from "lucide-react";
import { getRun, stopRun, executeWindow, continueRun, exportRun } from "@/lib/runs.functions";
import { supabase } from "@/integrations/supabase/client";
import { GraphCanvas, type GraphNode, type GraphEdge } from "@/components/GraphCanvas";
import type { Tables } from "@/integrations/supabase/types";
import { AgentActivityPanel } from "@/components/AgentActivityPanel";
import { getRunEvents } from "@/lib/leads.functions";
import { mergeAgentEvents, type AgentEvent } from "@/lib/agent-history";
import { requiredAgreement } from "../../../../shared/consensus";

export const Route = createFileRoute("/_authenticated/runs/$runId")({
  head: () => ({
    meta: [
      { title: "Live run — Auto Research" },
      {
        name: "description",
        content:
          "Watch the research swarm build the graph live: entities, notes, and captured sources as they are committed.",
      },
      { property: "og:title", content: "Live run — Auto Research" },
      { property: "og:description", content: "Watch the research swarm build the graph live." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LiveRunPage,
});

const OUTCOME_LABEL: Record<string, string> = {
  consensus: "Completed",
  stopped_by_user: "Stopped by you",
  budget_cost: "Cost budget reached",
  budget_wall_clock: "Time limit reached",
  criteria_unmet: "Criteria unmet — gaps stay visible",
  failed: "Failed",
};

function LiveRunPage() {
  const { runId } = Route.useParams();
  const queryClient = useQueryClient();
  const fetchRun = useServerFn(getRun);
  const stop = useServerFn(stopRun);
  const exec = useServerFn(executeWindow);
  const cont = useServerFn(continueRun);
  const exp = useServerFn(exportRun);
  const fetchEvents = useServerFn(getRunEvents);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showChunks, setShowChunks] = useState(true);
  const [tab, setTab] = useState<"graph" | "ledger">("graph");
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [historyError, setHistoryError] = useState(false);
  const pumpingRef = useRef(false);

  const { data, refetch } = useQuery({
    queryKey: ["run", runId],
    queryFn: () => fetchRun({ data: { id: runId } }),
    refetchInterval: 8000,
  });

  const run = data?.run;
  const live = run?.status === "running" || run?.status === "stopping";

  // Execution pump: while the run is live, keep calling bounded windows.
  // If this screen closes, new work stops — interactive v1 by design.
  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    async function pump() {
      if (pumpingRef.current) return;
      pumpingRef.current = true;
      while (!cancelled) {
        try {
          const result = await exec({ data: { id: runId } });
          if (result.status !== "running" && result.status !== "stopping") break;
        } catch (error) {
          console.error("execution window", error);
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
      pumpingRef.current = false;
      queryClient.invalidateQueries({ queryKey: ["run", runId] });
    }
    pump();
    return () => {
      cancelled = true;
    };
  }, [live, runId, exec, queryClient]);

  // Realtime: graph deltas + trace events.
  useEffect(() => {
    const channel = supabase
      .channel(`run-${runId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "nodes", filter: `run_id=eq.${runId}` },
        () => refetch(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "edges", filter: `run_id=eq.${runId}` },
        () => refetch(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "runs", filter: `id=eq.${runId}` },
        () => refetch(),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "events", filter: `run_id=eq.${runId}` },
        (payload) => {
          setEvents((prev) => mergeAgentEvents(prev, [payload.new as AgentEvent]));
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [runId, refetch]);

  // Reconcile durable history as well as realtime delivery. The cursor follows
  // fetched pages only, so an out-of-order realtime row cannot skip older work.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let cursor = 0;
    setEvents([]);
    setHistoryError(false);
    async function reconcile() {
      try {
        let rows: AgentEvent[];
        do {
          rows = await fetchEvents({ data: { id: runId, after: cursor } });
          if (cancelled) return;
          const fetchedRows = rows;
          setEvents((previous) => mergeAgentEvents(previous, fetchedRows));
          if (rows.length) cursor = Math.max(cursor, ...rows.map((row) => row.id));
        } while (rows.length === 1000);
        setHistoryError(false);
      } catch {
        if (!cancelled) setHistoryError(true);
      }
      if (!cancelled) timer = setTimeout(reconcile, 3000);
    }
    reconcile();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [runId, fetchEvents]);

  const nodes: GraphNode[] = useMemo(() => (data?.nodes ?? []) as GraphNode[], [data?.nodes]);
  const edges: GraphEdge[] = useMemo(() => (data?.edges ?? []) as GraphEdge[], [data?.edges]);
  const selected = useMemo(
    () => data?.nodes.find((n) => n.id === selectedId) ?? null,
    [data?.nodes, selectedId],
  );

  const stats = (run?.stats ?? {}) as {
    companies?: number;
    qualified?: number;
    signals?: number;
    people?: number;
    chunks?: number;
    openTasks?: number;
    doneTasks?: number;
  };
  const needed = run ? requiredAgreement(run.swarm_size, run.threshold) : 0;
  const latestEpoch = data?.votes?.[0]?.epoch ?? 0;
  const yesVotes =
    data?.votes?.filter((v) => v.epoch === latestEpoch && v.decision === "yes").length ?? 0;

  async function handleStop() {
    await stop({ data: { id: runId } });
    toast.message("Stop requested — finalizing and saving the last checkpoint.");
    refetch();
  }

  async function handleContinue() {
    try {
      const child = await cont({ data: { id: runId } });
      toast.success("Child run created with the inherited graph.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not continue");
    }
  }

  async function handleExport() {
    const payload = await exp({ data: { id: runId } });
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `auto-research-${runId.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    if (payload.manifest.partial) toast.message("Partial result exported with quality warnings.");
  }

  if (!run) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background lg:h-screen lg:overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            to="/runs"
            className="flex items-center gap-2 text-muted-foreground hover:text-primary"
          >
            <Radar className="h-4 w-4 text-primary" />
            <span className="font-data text-xs">RUNS</span>
          </Link>
          <span className="truncate text-sm font-semibold">{run.objective}</span>
          <span className={`font-data text-xs ${live ? "text-primary" : "text-muted-foreground"}`}>
            {live && (
              <span className="animate-pulse-dot mr-1 inline-block h-1.5 w-1.5 rounded-full bg-primary align-middle" />
            )}
            {run.outcome ? (OUTCOME_LABEL[run.outcome] ?? run.outcome) : run.status}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/swarm/$runId"
            params={{ runId: run.id }}
            className="inline-flex items-center gap-1.5 rounded-md border border-primary/60 px-3 py-1.5 text-xs text-primary hover:bg-primary hover:text-primary-foreground"
          >
            Watch swarm
          </Link>
          <Link
            to="/leads"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:border-primary hover:text-primary"
          >
            Leads
          </Link>
          {live ? (
            <button
              onClick={handleStop}
              className="inline-flex items-center gap-1.5 rounded-md border border-destructive px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive hover:text-destructive-foreground"
            >
              <Square className="h-3 w-3" /> Stop
            </button>
          ) : (
            <>
              <button
                onClick={handleContinue}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:border-primary hover:text-primary"
              >
                <GitBranch className="h-3 w-3" /> Continue as child
              </button>
              <button
                onClick={handleExport}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:border-primary hover:text-primary"
              >
                <Download className="h-3 w-3" /> Export
              </button>
            </>
          )}
        </div>
      </header>
      {historyError && (
        <p role="status" className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
          Saved agent history could not be loaded. Retrying; live updates remain available.
        </p>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-2 lg:grid-cols-[220px_minmax(0,1fr)_220px]">
        <aside
          aria-label="Agent panels left"
          tabIndex={0}
          className="col-start-1 row-start-2 max-h-[420px] space-y-2 overflow-y-auto overscroll-contain border-r border-border p-2 lg:row-start-1 lg:max-h-none"
        >
          <div className="sticky top-0 z-10 bg-background py-1 font-data text-[10px] text-muted-foreground">
            AGENT ACTIVITY
          </div>
          {Array.from({ length: Math.ceil(run.swarm_size / 2) }, (_, index) => (
            <AgentActivityPanel
              key={index}
              index={index}
              events={events.filter((event) => event.agent_index === index)}
              votes={(data?.votes ?? []).filter((vote) => vote.agent_index === index)}
              runStatus={run.status}
              onSelect={(id) => {
                setSelectedId(id);
                setTab("graph");
              }}
            />
          ))}
        </aside>

        {/* Graph / ledger */}
        <main className="relative col-span-2 col-start-1 row-start-1 h-[560px] min-w-0 lg:col-span-1 lg:col-start-2 lg:h-full">
          <div className="absolute left-3 top-3 z-10 flex gap-1 rounded-md border border-border bg-card/90 p-1 backdrop-blur">
            <button
              onClick={() => setTab("graph")}
              className={`rounded px-3 py-1 text-xs font-medium ${tab === "graph" ? "bg-accent text-accent-foreground" : "text-muted-foreground"}`}
            >
              Graph
            </button>
            <button
              onClick={() => setTab("ledger")}
              className={`rounded px-3 py-1 text-xs font-medium ${tab === "ledger" ? "bg-accent text-accent-foreground" : "text-muted-foreground"}`}
            >
              Source ledger
            </button>
          </div>

          {tab === "graph" ? (
            <GraphCanvas
              nodes={nodes}
              edges={edges}
              selectedId={selectedId}
              onSelect={setSelectedId}
              showChunks={showChunks}
            />
          ) : (
            <SourceLedger
              invocations={data?.invocations ?? []}
              nodes={data?.nodes ?? []}
              onSelect={(id) => {
                setSelectedId(id);
                setTab("graph");
              }}
            />
          )}

          {/* Node detail panel */}
          {selected && (
            <div
              role="region"
              aria-label="Research inspector"
              className="absolute bottom-16 right-3 top-14 z-10 w-80 max-w-[calc(100%-24px)] overflow-y-auto rounded-lg border border-border bg-card/95 p-4 backdrop-blur"
            >
              <NodeDetail
                node={selected}
                edges={edges}
                nodes={nodes}
                onClose={() => setSelectedId(null)}
                onSelect={setSelectedId}
              />
            </div>
          )}
        </main>
        <aside
          aria-label="Agent panels right"
          tabIndex={0}
          className="col-start-2 row-start-2 max-h-[420px] space-y-2 overflow-y-auto overscroll-contain border-l border-border p-2 lg:col-start-3 lg:row-start-1 lg:max-h-none"
        >
          <div className="sticky top-0 z-10 bg-background py-1 font-data text-[10px] text-muted-foreground">
            SWARM ACTIVITY
          </div>
          {Array.from({ length: Math.floor(run.swarm_size / 2) }, (_, offset) => {
            const index = Math.ceil(run.swarm_size / 2) + offset;
            return (
              <AgentActivityPanel
                key={index}
                index={index}
                events={events.filter((event) => event.agent_index === index)}
                votes={(data?.votes ?? []).filter((vote) => vote.agent_index === index)}
                runStatus={run.status}
                onSelect={(id) => {
                  setSelectedId(id);
                  setTab("graph");
                }}
              />
            );
          })}
        </aside>
      </div>

      {/* Bottom bar */}
      <footer className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-border px-4 py-2 font-data text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Building2 className="h-3.5 w-3.5 text-entity" /> {stats.qualified ?? 0}/
          {stats.companies ?? 0} qualified
        </span>
        <span className="inline-flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5 text-note" /> {stats.signals ?? 0} signals
        </span>
        <span className="inline-flex items-center gap-1.5">
          <User className="h-3.5 w-3.5 text-entity" /> {stats.people ?? 0} people
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Database className="h-3.5 w-3.5 text-chunk" /> {stats.chunks ?? 0} sources
        </span>
        <label className="inline-flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={showChunks}
            onChange={(e) => setShowChunks(e.target.checked)}
            className="h-3 w-3 accent-[oklch(0.8_0.15_85)]"
          />
          source layer
        </label>
        <span>
          votes:{" "}
          <span className="text-primary">
            {yesVotes}/{needed}
          </span>{" "}
          yes needed (epoch {latestEpoch})
        </span>
        <span>
          spend: <span className="text-primary">${Number(run.spend).toFixed(3)}</span> / $
          {Number(run.cost_cap).toFixed(2)}
        </span>
        <span>
          tasks: {stats.doneTasks ?? 0} done · {stats.openTasks ?? 0} open
        </span>
        {data?.lastCheckpoint && (
          <span className="inline-flex items-center gap-1">
            <ScrollText className="h-3.5 w-3.5" /> checkpoint{" "}
            {new Date(data.lastCheckpoint.created_at).toLocaleTimeString()}
          </span>
        )}
      </footer>
    </div>
  );
}

function NodeDetail({
  node,
  edges,
  nodes,
  onClose,
  onSelect,
}: {
  node: Tables<"nodes">;
  edges: GraphEdge[];
  nodes: GraphNode[];
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const linked = edges
    .filter((e) => e.from_node === node.id || e.to_node === node.id)
    .map((e) => {
      const otherId = e.from_node === node.id ? e.to_node : e.from_node;
      const other = nodes.find((n) => n.id === otherId);
      return other ? { edge: e, other } : null;
    })
    .filter(Boolean) as Array<{ edge: GraphEdge; other: GraphNode }>;

  const categoryLabel =
    node.category === "primary_entity"
      ? `Primary entity · ${String(node.entity_type ?? "")}`
      : node.category === "note"
        ? `Note · ${String(node.editorial_type ?? "")}${node.semantic_kind ? ` · ${String(node.semantic_kind)}` : ""}`
        : "Source chunk";

  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-data text-[10px] uppercase tracking-widest text-muted-foreground">
            {categoryLabel}
          </div>
          <h3 className="mt-1 text-sm font-semibold leading-snug">{node.title}</h3>
        </div>
        <button
          aria-label="Close research inspector"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground"
        >
          ✕
        </button>
      </div>

      {Boolean(node.confidence) && (
        <div className="mt-2 font-data text-xs">
          confidence: <span className="text-primary">{String(node.confidence)}</span>
          {Boolean(node.provenance) && (
            <span className="text-muted-foreground"> · {String(node.provenance)}</span>
          )}
        </div>
      )}

      {node.category === "primary_entity" && (
        <div className="mt-3 space-y-1 rounded-md border border-border bg-background p-2 font-data text-xs">
          {Object.entries((node.fields as Record<string, unknown>) ?? {}).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2">
              <span className="text-muted-foreground">{k}</span>
              <span className="truncate text-right">{v == null ? "unknown" : String(v)}</span>
            </div>
          ))}
        </div>
      )}

      {Boolean(node.free_text) && (
        <div className="mt-3">
          <div className="font-data text-[10px] uppercase tracking-widest text-muted-foreground">
            Research prose
          </div>
          <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-foreground/90">
            {String(node.free_text)}
          </p>
        </div>
      )}

      {node.category === "source_chunk" && (
        <div className="mt-3">
          <div className="font-data text-[10px] uppercase tracking-widest text-muted-foreground">
            Captured passage {node.is_snippet ? "· search snippet" : "· full document"}
          </div>
          <p className="mt-1 whitespace-pre-wrap rounded-md border border-chunk/30 bg-chunk/5 p-2 text-xs leading-relaxed text-foreground/90">
            {String(node.content ?? "")}
          </p>
          {Boolean(node.locator) && (
            <a
              href={String(node.locator)}
              target="_blank"
              rel="noreferrer"
              className="mt-2 block truncate font-data text-xs text-primary hover:underline"
            >
              {String(node.locator)}
            </a>
          )}
          <div className="mt-2 space-y-0.5 font-data text-[10px] text-muted-foreground">
            {Boolean(node.published_at) && (
              <div>published: {new Date(String(node.published_at)).toLocaleDateString()}</div>
            )}
            {Boolean(node.event_at) && (
              <div>event: {new Date(String(node.event_at)).toLocaleDateString()}</div>
            )}
            {Boolean(node.fetched_at) && (
              <div>fetched: {new Date(String(node.fetched_at)).toLocaleString()}</div>
            )}
          </div>
        </div>
      )}

      {node.category === "note" && Boolean(node.content) && (
        <p className="mt-3 whitespace-pre-wrap text-xs leading-relaxed text-foreground/90">
          {String(node.content)}
        </p>
      )}

      {linked.length > 0 && (
        <div className="mt-4">
          <div className="font-data text-[10px] uppercase tracking-widest text-muted-foreground">
            Linked
          </div>
          <div className="mt-1 space-y-1">
            {linked.slice(0, 20).map(({ edge, other }) => (
              <button
                key={edge.id}
                onClick={() => onSelect(other.id)}
                className="flex w-full items-center justify-between gap-2 rounded border border-border px-2 py-1 text-left text-xs hover:border-primary"
              >
                <span className="truncate">{other.title}</span>
                <span
                  className={`shrink-0 font-data text-[10px] ${edge.polarity === "contradicts" ? "text-contradict" : "text-muted-foreground"}`}
                >
                  {edge.relation}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SourceLedger({
  invocations,
  nodes,
  onSelect,
}: {
  invocations: Tables<"invocations">[];
  nodes: Tables<"nodes">[];
  onSelect: (id: string) => void;
}) {
  const chunksByInvocation = new Map<string, number>();
  for (const n of nodes) {
    if (n.category === "source_chunk" && n.invocation_id) {
      const key = String(n.invocation_id);
      chunksByInvocation.set(key, (chunksByInvocation.get(key) ?? 0) + 1);
    }
  }
  return (
    <div className="h-full overflow-y-auto p-4 pt-14">
      <p className="mb-3 text-xs text-muted-foreground">
        Every attempted connector call — including empty and failed ones — stays inspectable here.
      </p>
      <div className="space-y-2">
        {invocations.length === 0 && (
          <p className="text-sm text-muted-foreground">No connector calls yet.</p>
        )}
        {invocations.map((inv) => (
          <div key={inv.id} className="rounded-md border border-border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-data text-xs text-primary">
                {String(inv.connector)} · {String(inv.operation)}
              </span>
              <span
                className={`font-data text-[10px] ${
                  inv.status === "succeeded"
                    ? "text-entity"
                    : inv.status === "empty"
                      ? "text-chunk"
                      : "text-destructive"
                }`}
              >
                {String(inv.status)}
              </span>
            </div>
            <div className="mt-1 truncate text-xs text-foreground/90">
              {String(inv.query ?? "")}
            </div>
            <div className="mt-1 font-data text-[10px] text-muted-foreground">
              agent {Number(inv.agent_index ?? 0) + 1} ·{" "}
              {chunksByInvocation.get(inv.id) ?? Number(inv.item_count ?? 0)} chunks · $
              {Number(inv.cost ?? 0).toFixed(3)}
              {Boolean(inv.error) && (
                <span className="text-destructive"> · {String(inv.error)}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
