import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getLegacyCrmEdits } from "@/lib/crm-legacy.functions";

const reasons: Record<string, string> = {
  imported: "Copied to the uniquely matching company. The original entry is retained here.",
  ambiguous:
    "Several companies match this old key. These edits have not been assigned to a company.",
  unmatched:
    "No unique company was available during migration. These edits remain here for review.",
  existing_edits:
    "The matching company already has CRM edits. Both sets of user work are retained separately.",
  invalid: "The old stage or notes need review before applying them to a company.",
};

export function LegacyCrmEdits({ userId }: { userId: string }) {
  const load = useServerFn(getLegacyCrmEdits);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["crm", "legacy", userId],
    queryFn: () => load(),
  });
  if (isLoading) return null;
  if (error)
    return (
      <p role="alert" className="mt-6 text-sm text-destructive">
        Could not load earlier CRM edits.{" "}
        <button className="underline" onClick={() => void refetch()}>
          Retry
        </button>
      </p>
    );
  if (!data?.length) return null;
  const reviewCount = data.filter(
    (entry) => entry.status !== "imported" || entry.changedSinceImport,
  ).length;
  return (
    <details className="mt-6 rounded-lg border border-border bg-card p-4">
      <summary className="cursor-pointer text-sm font-medium">
        Earlier CRM edits ({data.length}){reviewCount ? ` · ${reviewCount} need review` : ""}
      </summary>
      <p className="mt-2 text-xs text-muted-foreground">
        Your earlier company notes, stages, and stars are retained below. Only an unambiguous match
        with no existing CRM edits was copied automatically. Future research will not reassign these
        entries.
      </p>
      <ul className="mt-4 space-y-3">
        {data.map((entry) => (
          <li key={entry.id} className="rounded border border-border p-3 text-sm">
            <p className="break-all font-medium">{entry.key}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {reasons[entry.status] ?? "Retained for review."}
            </p>
            {entry.changedSinceImport && (
              <p className="mt-1 text-xs">
                This earlier entry changed after migration. The newer edits below have not
                overwritten the stable CRM record.
              </p>
            )}
            <p className="mt-2">
              Stage: {entry.stage} · Starred: {entry.starred ? "yes" : "no"}
            </p>
            <p className="mt-1 whitespace-pre-wrap">{entry.notes || "No notes"}</p>
          </li>
        ))}
      </ul>
    </details>
  );
}
