import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { ArrowUpDown, Loader2, Search, Star } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { LegacyCrmEdits } from "@/components/LegacyCrmEdits";
import { listCrmRecords } from "@/lib/crm-list.functions";
import { filterCrmList } from "@/lib/crm-list";
import type { CrmListRecord, CrmSortKey } from "@/lib/crm-list";
import { STAGES } from "@/lib/lead-stages";

export const Route = createFileRoute("/_authenticated/leads/")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { runId?: string; kind?: "company" | "person" } => ({
    ...(typeof search["runId"] === "string" && search["runId"] ? { runId: search["runId"] } : {}),
    ...(search["kind"] === "company" || search["kind"] === "person"
      ? { kind: search["kind"] }
      : {}),
  }),
  head: () => ({
    meta: [
      { title: "CRM — Auto Research" },
      {
        name: "description",
        content: "Companies and people from completed research, ready to work with.",
      },
    ],
  }),
  component: LeadsPage,
});

const PAGE_SIZE = 50;
const controlClass =
  "rounded-md border border-input bg-card px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";

export function CrmRecordLinks({ record, runId }: { record: CrmListRecord; runId: string }) {
  const related = record.related.filter((item) => !runId || item.runIds.includes(runId));
  return related.length ? (
    <div className="flex flex-col gap-1">
      {related.map((item) => (
        <Link
          key={item.id}
          to="/leads/$key"
          params={{ key: item.id }}
          className="hover:text-primary hover:underline"
        >
          {item.name}
        </Link>
      ))}
    </div>
  ) : (
    <span className="text-muted-foreground">
      {record.entityType === "person" ? "Employer unknown" : "No linked people"}
    </span>
  );
}

export function LeadsPage() {
  const { user } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const kind = search.kind ?? "company";
  const runId = search.runId ?? "";
  const fetchRecords = useServerFn(listCrmRecords);
  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["crm", "list", user.id],
    queryFn: () => fetchRecords(),
    refetchInterval: 10000,
  });
  const [query, setQuery] = useState("");
  const [verdict, setVerdict] = useState("all");
  const [stage, setStage] = useState("all");
  const [starred, setStarred] = useState(false);
  const [sort, setSort] = useState<{ key: CrmSortKey; direction: 1 | -1 }>({
    key: "name",
    direction: 1,
  });
  const [page, setPage] = useState(0);
  // A denied refresh must not keep cached names/contact data visible.
  const records = useMemo(() => (isError ? [] : (data ?? [])), [data, isError]);
  const runs = useMemo(
    () => [
      ...new Map(
        records.flatMap((record) => record.runs.map((run) => [run.id, run] as const)),
      ).values(),
    ],
    [records],
  );
  const verdicts = useMemo(
    () =>
      [...new Set(records.flatMap((record) => record.verdicts.map((value) => value.value)))].sort(),
    [records],
  );
  const scoped = records.filter((record) => !runId || record.runs.some((run) => run.id === runId));
  const rows = useMemo(
    () =>
      filterCrmList(records, {
        kind,
        query,
        runId,
        verdict,
        stage,
        starred,
        sort: sort.key,
        direction: sort.direction,
      }),
    [records, kind, query, runId, verdict, stage, starred, sort],
  );
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const visible = rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const kindCount = scoped.filter((record) => record.entityType === kind).length;
  const changeFilter = (change: () => void) => {
    setPage(0);
    change();
  };
  const resetFilters = () => {
    setQuery("");
    setVerdict("all");
    setStage("all");
    setStarred(false);
    setPage(0);
  };
  const th = (key: CrmSortKey, label: string) => (
    <th
      scope="col"
      className="px-3 py-3 font-medium"
      aria-sort={sort.key === key ? (sort.direction === 1 ? "ascending" : "descending") : "none"}
    >
      <button
        onClick={() =>
          changeFilter(() =>
            setSort((old) => ({ key, direction: old.key === key && old.direction === 1 ? -1 : 1 })),
          )
        }
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        {label}
        <ArrowUpDown aria-hidden="true" className="h-3 w-3" />
      </button>
    </th>
  );

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-bold">CRM</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Companies and people transferred from completed research. Every research verdict remains
          available.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div role="group" aria-label="Record type" className="flex gap-2">
            {(["company", "person"] as const).map((value) => (
              <button
                key={value}
                aria-pressed={kind === value}
                onClick={() => {
                  resetFilters();
                  void navigate({ search: { ...search, kind: value } });
                }}
                className={`${controlClass} ${kind === value ? "border-primary text-primary" : "text-muted-foreground"}`}
              >
                {value === "company" ? "Companies" : "People"}{" "}
                <span className="ml-1 font-data">
                  {isPending || isError
                    ? "…"
                    : scoped.filter((record) => record.entityType === value).length}
                </span>
              </button>
            ))}
          </div>
          <label className="flex min-w-0 items-center gap-2 text-sm">
            Originating run
            <select
              aria-label="Originating run"
              value={runId}
              onChange={(event) => {
                setPage(0);
                void navigate({
                  search: event.target.value ? { ...search, runId: event.target.value } : { kind },
                });
              }}
              className={`${controlClass} max-w-64`}
            >
              <option value="">All completed research</option>
              {runId && !runs.some((run) => run.id === runId) && (
                <option value={runId}>Selected run</option>
              )}
              {runs.map((run) => (
                <option key={run.id} value={run.id}>
                  {run.objective}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 grow sm:grow-0">
            <Search
              aria-hidden="true"
              className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground"
            />
            <input
              aria-label="Search CRM records"
              value={query}
              onChange={(event) => changeFilter(() => setQuery(event.target.value))}
              placeholder={
                kind === "company"
                  ? "Search company, website, location"
                  : "Search person, role, company, contact"
              }
              className={`${controlClass} w-full pl-8 sm:w-80`}
            />
          </div>
          <select
            aria-label="Research verdict"
            value={verdict}
            onChange={(event) => changeFilter(() => setVerdict(event.target.value))}
            className={controlClass}
          >
            <option value="all">All research verdicts</option>
            {verdicts.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <select
            aria-label="Workflow stage"
            value={stage}
            onChange={(event) => changeFilter(() => setStage(event.target.value))}
            className={controlClass}
          >
            <option value="all">All workflow stages</option>
            {STAGES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <button
            aria-pressed={starred}
            onClick={() => changeFilter(() => setStarred((value) => !value))}
            className={`${controlClass} inline-flex items-center gap-2 ${starred ? "border-primary text-primary" : ""}`}
          >
            <Star aria-hidden="true" className="h-4 w-4" />
            Starred
          </button>
        </div>
        {isError && (
          <div role="alert" className="mt-4 rounded-md border border-destructive p-4 text-sm">
            Could not load CRM records. Cached records are hidden until access can be verified.{" "}
            <button onClick={() => void refetch()} disabled={isFetching} className="ml-2 underline">
              Retry
            </button>
          </div>
        )}
        <div className="mt-4 rounded-lg border border-border">
          {isPending ? (
            <div role="status" className="flex items-center justify-center gap-2 p-12 text-sm">
              <Loader2
                aria-hidden="true"
                className="h-5 w-5 animate-spin motion-reduce:animate-none"
              />
              Loading CRM records…
            </div>
          ) : isError ? null : !kindCount ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No {kind === "company" ? "companies" : "people"} from completed research{" "}
              {runId ? "in this run" : "yet"}. Records appear after the completed result transfers
              to the CRM.{" "}
              <Link to="/runs" className="text-primary underline">
                View searches
              </Link>
            </div>
          ) : !rows.length ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No records match these filters.{" "}
              <button onClick={resetFilters} className="text-primary underline">
                Clear filters
              </button>
            </div>
          ) : (
            <>
              <div
                role="region"
                aria-label={`${kind === "company" ? "Companies" : "People"} table, scroll horizontally for more columns`}
                tabIndex={0}
                className="overflow-x-auto rounded-t-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                <table className="w-full min-w-[780px] text-sm">
                  <caption className="sr-only">
                    {kind === "company" ? "Companies" : "People"} from completed research. Select a
                    name to open its record.
                  </caption>
                  <thead className="bg-card text-left text-xs text-muted-foreground">
                    <tr>
                      {th("name", kind === "company" ? "Company" : "Person")}
                      {kind === "company"
                        ? th("location", "Location / size")
                        : th("role", "Evidenced role / contacts")}
                      <th scope="col" className="px-3 py-3 font-medium">
                        Research verdict
                      </th>
                      {th("related", kind === "company" ? "Linked people" : "Linked companies")}
                      {th("stage", "Workflow stage")}
                      <th scope="col" className="px-3 py-3 font-medium">
                        Originating runs
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((record) => (
                      <tr key={record.id} className="border-t border-border hover:bg-card/60">
                        <td className="max-w-72 px-3 py-3 align-top">
                          <Link
                            to="/leads/$key"
                            params={{ key: record.id }}
                            className="break-words font-semibold hover:text-primary hover:underline"
                          >
                            {record.name}
                          </Link>
                          {record.starred && (
                            <Star
                              aria-label="Starred"
                              className="ml-1 inline h-3 w-3 fill-primary text-primary"
                            />
                          )}
                          <div className="mt-1 break-all text-xs text-muted-foreground">
                            {kind === "company"
                              ? (record.website ?? "Website unknown")
                              : (record.profile ?? "Profile unknown")}
                          </div>
                        </td>
                        <td className="max-w-64 px-3 py-3 align-top text-xs">
                          {kind === "company" ? (
                            <>
                              {record.location ?? "Location unknown"}
                              <div className="mt-1 text-muted-foreground">
                                {record.size ?? "Size unknown"}
                              </div>
                            </>
                          ) : (
                            <>
                              <div>{record.role ?? "Role unknown"}</div>
                              <div className="mt-1 break-all text-muted-foreground">
                                {record.email ?? "Email unknown"}
                              </div>
                              <div className="text-muted-foreground">
                                {record.phone ?? "Phone unknown"}
                              </div>
                              {record.gaps.length > 0 && (
                                <div className="mt-2 text-muted-foreground">
                                  Research gaps: {record.gaps.join("; ")}
                                </div>
                              )}
                            </>
                          )}
                        </td>
                        <td className="px-3 py-3 align-top">
                          <div className="flex flex-wrap gap-1">
                            {[
                              ...new Set(
                                record.verdicts
                                  .filter((value) => !runId || value.runId === runId)
                                  .map((value) => value.value),
                              ),
                            ].map((value) => (
                              <span
                                key={value}
                                className="rounded border border-border px-2 py-0.5 text-xs"
                              >
                                {value}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="max-w-56 px-3 py-3 align-top text-xs">
                          <CrmRecordLinks record={record} runId={runId} />
                        </td>
                        <td className="px-3 py-3 align-top text-xs">{record.stage}</td>
                        <td className="max-w-64 px-3 py-3 align-top text-xs text-muted-foreground">
                          <div className="flex flex-col gap-1">
                            {record.runs.map((run) => (
                              <Link
                                key={run.id}
                                to="/runs/$runId"
                                params={{ runId: run.id }}
                                className="hover:text-primary hover:underline"
                              >
                                {run.objective}
                              </Link>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-3 py-3 text-xs">
                <p aria-live="polite">
                  {currentPage * PAGE_SIZE + 1}–
                  {Math.min((currentPage + 1) * PAGE_SIZE, rows.length)} of {rows.length} matching
                  records ({kindCount} total)
                </p>
                <nav aria-label="CRM pagination" className="flex items-center gap-3">
                  <button
                    disabled={currentPage === 0}
                    onClick={() => setPage(currentPage - 1)}
                    className="rounded border px-3 py-1 disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <span>
                    Page {currentPage + 1} of {totalPages}
                  </span>
                  <button
                    disabled={currentPage + 1 >= totalPages}
                    onClick={() => setPage(currentPage + 1)}
                    className="rounded border px-3 py-1 disabled:opacity-40"
                  >
                    Next
                  </button>
                </nav>
              </div>
            </>
          )}
        </div>
        <LegacyCrmEdits userId={user.id} />
      </main>
    </div>
  );
}
