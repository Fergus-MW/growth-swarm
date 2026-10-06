import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Radar, Loader2, Play } from "lucide-react";
import { createRun, startRun } from "@/lib/runs.functions";
import { webSearchStatus } from "@/lib/meta.functions";

export const Route = createFileRoute("/_authenticated/setup")({
  validateSearch: (search: Record<string, unknown>): { from?: string } => (typeof search["from"] === "string" ? { from: search["from"] } : {}),
  head: () => ({
    meta: [
      { title: "New research run — Auto Research" },
      { name: "description", content: "Configure a research swarm: brief, connectors, roster size, consensus threshold, and budgets." },
      { property: "og:title", content: "New research run — Auto Research" },
      { property: "og:description", content: "Configure a research swarm: brief, connectors, roster size, consensus threshold, and budgets." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SetupPage,
});

const DEFAULT_CRITERIA =
  "At least 10 in-universe, non-excluded companies are qualified with evidence. Each qualified company has at least one dated demand signal and one confirmed contact. Discovery has stopped producing new eligible companies.";

function SetupPage() {
  const navigate = useNavigate();
  const create = useServerFn(createRun);
  const start = useServerFn(startRun);

  const [profile, setProfile] = useState<"gtm" | "blank">("gtm");
  const [objective, setObjective] = useState("");
  const [pain, setPain] = useState("");
  const [universe, setUniverse] = useState("");
  const [exclusions, setExclusions] = useState("");
  const [criteria, setCriteria] = useState(DEFAULT_CRITERIA);
  const [swarmSize, setSwarmSize] = useState(20);
  const [threshold, setThreshold] = useState(0.7);
  const [timeLimit, setTimeLimit] = useState(30);
  const [costCap, setCostCap] = useState(5);
  const [webSearch, setWebSearch] = useState(true);
  const [busy, setBusy] = useState(false);

  const yesVotes = Math.ceil(threshold * swarmSize);

  async function handleLaunch(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { id } = await create({
        data: {
          profile,
          objective,
          pain: pain || undefined,
          universe: universe || undefined,
          exclusions: exclusions || undefined,
          completion_criteria: criteria,
          swarm_size: swarmSize,
          threshold,
          time_limit_sec: timeLimit * 60,
          cost_cap: costCap,
          connectors: webSearch ? ["web_search"] : [],
        },
      });
      await start({ data: { id } });
      toast.success("Run launched — the swarm is researching.");
      navigate({ to: "/runs/$runId", params: { runId: id } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not launch run");
      setBusy(false);
    }
  }

  const field =
    "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary placeholder:text-muted-foreground/60";
  const label = "mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground";

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-2">
          <Radar className="h-5 w-5 text-primary" />
          <span className="text-sm font-semibold tracking-wide">AUTO RESEARCH</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8">
        <h1 className="text-2xl font-bold">Set up a research run</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configuration is fixed at launch. To change sources or the brief later, you continue as a child run — the parent stays untouched.
        </p>

        <form onSubmit={handleLaunch} className="mt-8 space-y-6">
          <div className="flex gap-2">
            {(["gtm", "blank"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setProfile(p)}
                className={`rounded-md border px-4 py-2 text-sm font-medium transition-colors ${
                  profile === p ? "border-primary bg-accent text-accent-foreground" : "border-border text-muted-foreground hover:border-primary"
                }`}
              >
                {p === "gtm" ? "Go-to-market profile" : "Blank brief"}
              </button>
            ))}
          </div>

          <div>
            <label className={label}>Objective</label>
            <textarea
              required
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              rows={2}
              placeholder="What should the swarm find out?"
              className={field}
            />
          </div>

          {profile === "gtm" && (
            <>
              <div>
                <label className={label}>Pain statement</label>
                <textarea
                  value={pain}
                  onChange={(e) => setPain(e.target.value)}
                  rows={2}
                  placeholder="e.g. Finance teams reconciling supplier invoices by hand across several ERP instances after acquisitions."
                  className={field}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={label}>Universe</label>
                  <textarea
                    value={universe}
                    onChange={(e) => setUniverse(e.target.value)}
                    rows={2}
                    placeholder="e.g. UK & Ireland industrials, 200–2,000 headcount, PE-backed or recently acquired."
                    className={field}
                  />
                </div>
                <div>
                  <label className={label}>Exclusions</label>
                  <textarea
                    value={exclusions}
                    onChange={(e) => setExclusions(e.target.value)}
                    rows={2}
                    placeholder="Companies or conditions left out of the qualified population."
                    className={field}
                  />
                </div>
              </div>
            </>
          )}

          <div>
            <label className={label}>Completion criteria</label>
            <textarea value={criteria} onChange={(e) => setCriteria(e.target.value)} rows={3} className={field} />
            <p className="mt-1 text-xs text-muted-foreground">
              Measurable predicates are computed from the graph — agents never guess them from the slice they happen to read.
            </p>
          </div>

          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-sm font-semibold">Connectors</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Turning a connector on authorizes research reads only — never arbitrary actions.
            </p>
            <label className="mt-3 flex items-center justify-between rounded-md border border-border px-4 py-3">
              <div>
                <div className="text-sm font-medium">Web search</div>
                <div className="text-xs text-muted-foreground">Live read · captures every result before any model reads it</div>
              </div>
              <input
                type="checkbox"
                checked={webSearch}
                onChange={(e) => setWebSearch(e.target.checked)}
                className="h-4 w-4 accent-[oklch(0.82_0.14_185)]"
              />
            </label>
            <WebSearchNote />
          </div>

          <div className="grid gap-4 rounded-lg border border-border bg-card p-5 sm:grid-cols-2">
            <div>
              <label className={label}>Swarm size: {swarmSize} agents</label>
              <input
                type="range"
                min={5}
                max={100}
                value={swarmSize}
                onChange={(e) => setSwarmSize(Number(e.target.value))}
                className="w-full accent-[oklch(0.82_0.14_185)]"
              />
            </div>
            <div>
              <label className={label}>Consensus threshold: {Math.round(threshold * 100)}%</label>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="w-full accent-[oklch(0.82_0.14_185)]"
              />
              <p className="mt-1 font-data text-xs text-primary">
                Completion needs {yesVotes} of {swarmSize} agents voting yes on the same graph revision.
              </p>
            </div>
            <div>
              <label className={label}>Time limit (minutes)</label>
              <input type="number" min={1} max={60} value={timeLimit} onChange={(e) => setTimeLimit(Number(e.target.value))} className={field} />
            </div>
            <div>
              <label className={label}>Cost cap (USD)</label>
              <input type="number" min={0.5} max={100} step={0.5} value={costCap} onChange={(e) => setCostCap(Number(e.target.value))} className={field} />
            </div>
          </div>

          <button
            type="submit"
            disabled={busy || objective.trim().length < 3}
            className="glow-primary inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-transform hover:scale-[1.02] disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Launch swarm
          </button>
        </form>
      </main>
    </div>
  );
}

function WebSearchNote() {
  const [available, setAvailable] = useState<boolean | null>(null);
  useState(() => {
    webSearchStatus().then((r) => setAvailable(r.available));
  });
  if (available === null || available) return null;
  return (
    <p className="mt-2 rounded-md border border-chunk/40 bg-chunk/10 px-3 py-2 text-xs text-chunk">
      Web search is not configured yet (no Tavily API key on the backend). The swarm can still research with the model
      alone, but captured web sources will be a visible gap. Add the key in project secrets to enable it.
    </p>
  );
}
