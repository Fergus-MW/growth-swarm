import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Star, Search, ArrowUpDown, Loader2, Users, FileText } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { listLeads, updateLead } from "@/lib/leads.functions";

export const Route = createFileRoute("/_authenticated/leads/")({
  head: () => ({
    meta: [
      { title: "Leads — Auto Research" },
      { name: "description", content: "Every company the research swarm found, ranked by fit and evidence." },
      { property: "og:title", content: "Leads — Auto Research" },
      { property: "og:description", content: "Every company the research swarm found, ranked by fit and evidence." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LeadsPage,
});

import { STAGES } from "@/lib/lead-stages";
const STATUS_STYLE: Record<string, string> = {
  qualified: "border-primary/50 text-primary",
  candidate: "border-chunk/50 text-chunk",
  unclear: "border-border text-muted-foreground",
  rejected: "border-destructive/50 text-destructive",
};
type SortKey = "score" | "name" | "evidence" | "firstSeen";

function LeadsPage() {
  const fetchLeads = useServerFn(listLeads);
  const save = useServerFn(updateLead);
  const qc = useQueryClient();
  const { data: leads, isLoading } = useQuery({ queryKey: ["leads"], queryFn: () => fetchLeads(), refetchInterval: 10000 });
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [stage, setStage] = useState("all");
  const [starOnly, setStarOnly] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "score", dir: -1 });

  const rows = useMemo(() => {
    let r = leads ?? [];
    if (q) r = r.filter((l) => `${l.name} ${l.website ?? ""} ${l.location ?? ""}`.toLowerCase().includes(q.toLowerCase()));
    if (status !== "all") r = r.filter((l) => l.status === status);
    if (stage !== "all") r = r.filter((l) => l.stage === stage);
    if (starOnly) r = r.filter((l) => l.starred);
    return [...r].sort((a: any, b: any) => (a[sort.key] > b[sort.key] ? 1 : a[sort.key] < b[sort.key] ? -1 : 0) * sort.dir);
  }, [leads, q, status, stage, starOnly, sort]);

  async function patch(key: string, p: { stage?: string; starred?: boolean }) {
    qc.setQueryData(["leads"], (old: any[] | undefined) => old?.map((l) => (l.key === key ? { ...l, ...p } : l)));
    await save({ data: { key, ...p } });
  }
  const th = (key: SortKey, label: string, cls = "") => (
    <th className={`px-3 py-2 font-medium ${cls}`}>
      <button onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : -1 }))} className="inline-flex items-center gap-1 hover:text-foreground">
        {label} <ArrowUpDown className="h-3 w-3" />
      </button>
    </th>
  );
  const qualified = (leads ?? []).filter((l) => l.status === "qualified").length;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Leads</h1>
            <p className="mt-1 text-sm text-muted-foreground">Every company your searches surfaced, merged and ranked by fit.</p>
          </div>
          <div className="flex gap-6 font-data text-xs text-muted-foreground">
            <div><div className="text-2xl text-foreground">{leads?.length ?? 0}</div>TOTAL</div>
            <div><div className="text-2xl text-primary">{qualified}</div>QUALIFIED</div>
            <div><div className="text-2xl text-chunk">{(leads ?? []).filter((l) => l.starred).length}</div>STARRED</div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search company, site, location" className="w-72 rounded-md border border-input bg-card py-2 pl-8 pr-3 text-sm outline-none focus:border-primary" />
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-md border border-input bg-card px-3 py-2 text-sm">
            <option value="all">All fit verdicts</option>
            {["qualified", "candidate", "unclear", "rejected"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={stage} onChange={(e) => setStage(e.target.value)} className="rounded-md border border-input bg-card px-3 py-2 text-sm">
            <option value="all">All stages</option>
            {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={() => setStarOnly((v) => !v)} className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm ${starOnly ? "border-chunk text-chunk" : "border-input text-muted-foreground"}`}>
            <Star className="h-3.5 w-3.5" /> Starred
          </button>
        </div>

        <div className="mt-4 overflow-x-auto rounded-lg border border-border">
          {isLoading ? (
            <div className="flex justify-center p-12"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
          ) : rows.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              No leads yet. <Link to="/setup" className="text-primary underline">Start a search</Link> and companies will appear here as the swarm finds them.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-card text-left font-data text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="w-8 px-3 py-2" />
                  {th("score", "Fit", "w-28")}
                  {th("name", "Company")}
                  <th className="px-3 py-2 font-medium">Verdict</th>
                  {th("evidence", "Evidence")}
                  <th className="px-3 py-2 font-medium">Found by</th>
                  <th className="px-3 py-2 font-medium">Stage</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.key} className="border-t border-border hover:bg-card/60">
                    <td className="px-3 py-3">
                      <button onClick={() => patch(l.key, { starred: !l.starred })} aria-label="Star lead">
                        <Star className={`h-4 w-4 ${l.starred ? "fill-chunk text-chunk" : "text-muted-foreground"}`} />
                      </button>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <span className="w-7 font-data text-sm font-semibold">{l.score}</span>
                        <div className="h-1.5 w-14 rounded-full bg-secondary"><div className="h-full rounded-full bg-primary" style={{ width: `${l.score}%` }} /></div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <Link to="/leads/$key" params={{ key: l.key }} className="font-semibold hover:text-primary">{l.name}</Link>
                      <div className="font-data text-[11px] text-muted-foreground">{[l.website, l.location, l.size].filter(Boolean).join(" · ") || "—"}</div>
                    </td>
                    <td className="px-3 py-3"><span className={`rounded border px-2 py-0.5 font-data text-[11px] uppercase ${STATUS_STYLE[l.status] ?? STATUS_STYLE["unclear"]}`}>{l.status}</span></td>
                    <td className="px-3 py-3 font-data text-xs text-muted-foreground">
                      <span className="mr-3 inline-flex items-center gap-1"><FileText className="h-3 w-3" />{l.evidence}</span>
                      <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{l.contacts}</span>
                    </td>
                    <td className="max-w-56 px-3 py-3 text-xs text-muted-foreground"><div className="truncate">{l.runs.map((r: any) => r.objective).join(", ")}</div></td>
                    <td className="px-3 py-3">
                      <select value={l.stage} onChange={(e) => patch(l.key, { stage: e.target.value })} className="rounded border border-input bg-background px-2 py-1 text-xs">
                        {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
}
