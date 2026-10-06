import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Star, Search, ArrowUpDown, Loader2, Users, FileText } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { listLeads, updateLead } from "@/lib/leads.functions";
import { STAGES } from "@/lib/lead-stages";

export const Route = createFileRoute("/_authenticated/leads/")({
  validateSearch: (search: Record<string, unknown>): { kind?: "company" | "person"; run?: string } => {
    const kind = search["kind"];
    const run = search["run"];
    return {
      ...(kind === "company" || kind === "person" ? { kind } : {}),
      ...(typeof run === "string" && run ? { run } : {}),
    };
  },
  head: () => ({
    meta: [
      { title: "CRM — Auto Research" },
      { name: "description", content: "Companies and people transferred from completed research." },
      { property: "og:title", content: "CRM — Auto Research" },
      { property: "og:description", content: "Companies and people transferred from completed research." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LeadsPage,
});

const STATUS_STYLE: Record<string, string> = {
  qualified: "border-primary/50 text-primary",
  candidate: "border-chunk/50 text-chunk",
  unclear: "border-border text-muted-foreground",
  rejected: "border-destructive/50 text-destructive",
};
type SortKey = "score" | "name" | "evidence";

function LeadsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const kind = search.kind ?? "company";
  const fetchLeads = useServerFn(listLeads);
  const save = useServerFn(updateLead);
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["leads", kind, search.run ?? ""],
    queryFn: () => fetchLeads({ data: { kind, ...(search.run ? { runId: search.run } : {}), page: 1, pageSize: 200 } }),
  });
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [stage, setStage] = useState("all");
  const [starOnly, setStarOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "score", dir: -1 });
  const pageSize = 40;

  const filtered = useMemo(() => {
    let rows = data?.rows ?? [];
    if (q) rows = rows.filter((row) => `${row.name} ${row.website ?? ""} ${row.location ?? ""} ${row.role ?? ""}`.toLowerCase().includes(q.toLowerCase()));
    if (status !== "all") rows = rows.filter((row) => row.status === status);
    if (stage !== "all") rows = rows.filter((row) => row.stage === stage);
    if (starOnly) rows = rows.filter((row) => row.starred);
    return [...rows].sort((a, b) => (a[sort.key] > b[sort.key] ? 1 : a[sort.key] < b[sort.key] ? -1 : 0) * sort.dir);
  }, [data?.rows, q, status, stage, starOnly, sort]);
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  const filtersOn = Boolean(q || status !== "all" || stage !== "all" || starOnly || search.run);

  async function patch(id: string, p: { stage?: string; starred?: boolean }, updatedAt: string) {
    const previous = qc.getQueryData(["leads", kind, search.run ?? ""]);
    qc.setQueryData(["leads", kind, search.run ?? ""], (old: typeof data) => old && { ...old, rows: old.rows.map((row) => row.id === id ? { ...row, ...p } : row) });
    try {
      await save({ data: { key: id, ...p, expectedUpdatedAt: updatedAt } });
    } catch (failure) {
      qc.setQueryData(["leads", kind, search.run ?? ""], previous);
      toast.error(failure instanceof Error ? failure.message : "Could not save");
    }
  }

  const th = (key: SortKey, label: string) => (
    <th className="px-3 py-2 font-medium">
      <button onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))} className="inline-flex items-center gap-1 hover:text-foreground">
        {label} <ArrowUpDown className="h-3 w-3" />
      </button>
    </th>
  );

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">CRM</h1>
            <p className="mt-1 text-sm text-muted-foreground">Companies and people from completed research. In-progress runs stay on the graph until transfer.</p>
          </div>
          <div className="font-data text-xs text-muted-foreground">
            <div className="text-2xl text-foreground">{filtersOn ? filtered.length : (data?.total ?? filtered.length)}</div>
            {filtersOn ? "MATCHING" : "TOTAL"}
          </div>
        </div>
        <div className="mt-4 flex gap-2" role="tablist">
          {(["company", "person"] as const).map((value) => (
            <button key={value} role="tab" aria-selected={kind === value} className={`rounded-md border px-3 py-1.5 text-sm ${kind === value ? "border-primary text-primary" : "border-border text-muted-foreground"}`} onClick={() => { setPage(1); navigate({ to: "/leads", search: { kind: value, ...(search.run ? { run: search.run } : {}) } }); }}>
              {value === "company" ? "Companies" : "People"}
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder={kind === "company" ? "Search company, site, location" : "Search person or role"} className="w-72 max-w-full rounded-md border border-input bg-card py-2 pl-8 pr-3 text-sm outline-none focus:border-primary" />
          </div>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="rounded-md border border-input bg-card px-3 py-2 text-sm" aria-label="Research verdict">
            <option value="all">All fit verdicts</option>
            {["qualified", "candidate", "unclear", "rejected"].map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select value={stage} onChange={(e) => { setStage(e.target.value); setPage(1); }} className="rounded-md border border-input bg-card px-3 py-2 text-sm" aria-label="Workflow stage">
            <option value="all">All stages</option>
            {STAGES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <button onClick={() => { setStarOnly((value) => !value); setPage(1); }} className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm ${starOnly ? "border-chunk text-chunk" : "border-input text-muted-foreground"}`}>
            <Star className="h-3.5 w-3.5" /> Starred
          </button>
        </div>
        <div className="mt-4 overflow-x-auto rounded-lg border border-border">
          {isLoading ? (
            <div className="flex justify-center p-12"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
          ) : isError ? (
            <div className="p-12 text-center text-sm text-destructive">{error instanceof Error ? error.message : "Could not load the CRM."} <button className="text-primary underline" onClick={() => refetch()}>Retry</button></div>
          ) : visible.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              {filtersOn ? "No records match these filters." : "No transferred records yet. They appear here after a swarm completes successfully."}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-card text-left font-data text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="w-8 px-3 py-2" />
                  {th("name", kind === "company" ? "Company" : "Person")}
                  <th className="px-3 py-2 font-medium">Verdict</th>
                  {th("evidence", "Evidence")}
                  <th className="px-3 py-2 font-medium">{kind === "company" ? "People" : "Employer"}</th>
                  <th className="px-3 py-2 font-medium">Found by</th>
                  <th className="px-3 py-2 font-medium">Stage</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.id} className="border-t border-border hover:bg-card/60">
                    <td className="px-3 py-3">
                      <button onClick={() => patch(row.id, { starred: !row.starred }, row.updatedAt)} aria-label={row.starred ? "Unstar record" : "Star record"}>
                        <Star className={`h-4 w-4 ${row.starred ? "fill-chunk text-chunk" : "text-muted-foreground"}`} />
                      </button>
                    </td>
                    <td className="px-3 py-3">
                      <Link to="/leads/$key" params={{ key: row.id }} className="font-semibold hover:text-primary">{row.name}</Link>
                      <div className="font-data text-[11px] text-muted-foreground">
                        {kind === "company"
                          ? [row.website, row.location, row.size].filter(Boolean).join(" · ") || "Website, location, and size unknown"
                          : row.role || "Role unknown"}
                      </div>
                    </td>
                    <td className="px-3 py-3"><span className={`rounded border px-2 py-0.5 font-data text-[11px] uppercase ${STATUS_STYLE[row.status] ?? STATUS_STYLE["unclear"]}`}>{row.status}</span></td>
                    <td className="px-3 py-3 font-data text-xs text-muted-foreground"><span className="inline-flex items-center gap-1"><FileText className="h-3 w-3" />{row.evidence}</span></td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      {kind === "person" && row.contacts === 0 ? "Employer unknown" : <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{row.contacts}</span>}
                    </td>
                    <td className="max-w-56 px-3 py-3 text-xs text-muted-foreground"><div className="truncate">{row.runs.map((run) => run.objective).join(", ") || "—"}</div></td>
                    <td className="px-3 py-3">
                      <select value={row.stage} aria-label={`Stage for ${row.name}`} onChange={(e) => patch(row.id, { stage: e.target.value }, row.updatedAt)} className="rounded border border-input bg-background px-2 py-1 text-xs">
                        {STAGES.map((item) => <option key={item} value={item}>{item}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {filtered.length > pageSize && (
          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>{filtered.length} records</span>
            <div className="flex gap-2">
              <button className="rounded border border-border px-2 py-1 disabled:opacity-40" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>Previous</button>
              <button className="rounded border border-border px-2 py-1 disabled:opacity-40" disabled={page * pageSize >= filtered.length} onClick={() => setPage((value) => value + 1)}>Next</button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
