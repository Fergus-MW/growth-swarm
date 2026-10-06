import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCrmTransfer, retryCrmTransfer } from "@/lib/crm-transfer.functions";

export function CrmHandoff({
  runId,
  userId,
  status,
  outcome,
}: {
  runId: string;
  userId: string;
  status: string;
  outcome: string | null;
}) {
  const successful = status === "completed" && outcome === "consensus";
  const read = useServerFn(getCrmTransfer);
  const retry = useServerFn(retryCrmTransfer);
  const queryClient = useQueryClient();
  const queryKey = ["crm", "transfer", userId, runId];
  const query = useQuery({
    queryKey,
    queryFn: () => read({ data: { runId } }),
    enabled: successful,
    retry: false,
    refetchInterval: (state) =>
      successful && state.state.data?.status === "pending" ? 3000 : false,
  });
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const invalidated = useRef<string | null>(null);
  const transfer = query.data;
  useEffect(() => {
    if (!successful || transfer?.status !== "ready") return;
    const version = `${userId}:${runId}:${transfer.updated_at}`;
    if (invalidated.current === version) return;
    invalidated.current = version;
    void queryClient.invalidateQueries({ queryKey: ["crm", "list", userId] });
  }, [successful, transfer?.status, transfer?.updated_at, userId, runId, queryClient]);

  async function retryTransfer() {
    setRetrying(true);
    setRetryError(null);
    try {
      const result = await retry({ data: { runId } });
      queryClient.setQueryData(queryKey, result);
      await query.refetch();
    } catch (error) {
      setRetryError(error instanceof Error ? error.message : "Could not prepare CRM records.");
    } finally {
      setRetrying(false);
    }
  }

  if (!successful) return null;
  return (
    <section
      aria-label="Completed research CRM transfer"
      className="shrink-0 border-b border-border bg-card px-4 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div aria-live="polite">
          <h2 className="text-sm font-semibold">Research complete</h2>
          {query.isPending ? (
            <p className="text-sm text-muted-foreground">Checking CRM records…</p>
          ) : query.isError ? (
            <p role="alert" className="text-sm text-destructive">
              Could not check CRM transfer: {query.error.message}
            </p>
          ) : transfer?.status === "ready" ? (
            <>
              <p className="text-sm">
                CRM ready · {transfer.company_count} companies · {transfer.person_count} people
              </p>
              {transfer.source_count === 0 ? (
                <p className="text-xs text-muted-foreground">
                  This completed result contains no companies or people.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {transfer.source_count} research entities mapped: {transfer.created_count} new CRM
                  records · {transfer.linked_count} linked to existing records.
                </p>
              )}
            </>
          ) : transfer?.status === "failed" ? (
            <>
              <p className="text-sm text-destructive">
                CRM transfer failed. Your completed research is still available.
              </p>
              <p className="text-xs text-muted-foreground">
                {transfer.failed_count} records need transfer. {transfer.error}
              </p>
            </>
          ) : transfer?.status === "pending" ? (
            <p className="text-sm text-muted-foreground">Preparing CRM records…</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              CRM records have not been prepared for this completed run.
            </p>
          )}
          {retryError && (
            <p role="alert" className="mt-1 text-sm text-destructive">
              {retryError}
            </p>
          )}
        </div>
        {transfer?.status === "ready" && !query.isError ? (
          <Link
            to="/leads"
            search={{ runId }}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            Open in CRM
          </Link>
        ) : query.isError ? (
          <button
            className="rounded border border-border px-3 py-2 text-sm"
            onClick={() => void query.refetch()}
          >
            Check again
          </button>
        ) : !query.isPending && transfer?.status !== "pending" ? (
          <button
            disabled={retrying}
            onClick={() => void retryTransfer()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {retrying
              ? "Preparing CRM records…"
              : transfer?.status === "failed"
                ? "Retry CRM transfer"
                : "Prepare CRM records"}
          </button>
        ) : null}
      </div>
    </section>
  );
}
