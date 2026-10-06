import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CRM_EDITABLE_FIELDS, reapplyCrmDraft } from "@/lib/crm-workflow";
import type { CrmWorkingHistory, CrmWorkingState } from "@/lib/crm-workflow";
import { getCrmWorkingState, saveCrmWorkingState } from "@/lib/crm-workflow.functions";
import { STAGES } from "@/lib/lead-stages";

type Props = {
  recordId: string;
  entityType: "company" | "person";
  researchFields: Record<string, unknown>;
  onSaved?: () => void;
};

/** Remount drafts when navigating between stable identities. */
export function CrmRecordEditor(props: Props) {
  return <RecordEditor key={props.recordId} {...props} />;
}

function RecordEditor({ recordId, entityType, researchFields, onSaved }: Props) {
  const load = useServerFn(getCrmWorkingState);
  const save = useServerFn(saveCrmWorkingState);
  const [base, setBase] = useState<CrmWorkingState | null>(null);
  const [draft, setDraft] = useState<CrmWorkingState | null>(null);
  const [history, setHistory] = useState<CrmWorkingHistory[]>([]);
  const [conflict, setConflict] = useState<CrmWorkingState | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let ignore = false;
    setError("");
    load({ data: { recordId } })
      .then((result) => {
        if (ignore) return;
        setBase(result.state);
        setDraft(result.state);
        setHistory(result.history);
      })
      .catch((reason: unknown) => {
        if (!ignore)
          setError(reason instanceof Error ? reason.message : "Could not load CRM edits");
      });
    return () => {
      ignore = true;
    };
  }, [recordId, load, retry]);

  async function submit() {
    if (!draft || !base || saving || conflict) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await save({
        data: {
          recordId,
          expectedVersion: base.version,
          stage: draft.stage,
          starred: draft.starred,
          notes: draft.notes,
          overrides: draft.overrides,
        },
      });
      if (result.conflict) {
        setConflict(result.state);
        return;
      }
      if (!result.ok) throw new Error("Could not save CRM edits");
      setHistory((items) =>
        [
          {
            id: `saved-${result.state.version}`,
            record_id: recordId,
            actor_id: result.state.user_id,
            version: result.state.version,
            before_state: base,
            after_state: result.state,
            created_at: result.state.updated_at ?? "",
          },
          ...items,
        ].slice(0, 30),
      );
      setBase(result.state);
      setDraft(result.state);
      setNotice("Saved");
      onSaved?.();
    } catch (reason) {
      setError(
        `${reason instanceof Error ? reason.message : "Save failed"}. Your draft is still here; nothing has been marked saved.`,
      );
    } finally {
      setSaving(false);
    }
  }

  if (!draft || !base)
    return (
      <section className="rounded-lg border border-border p-4" aria-label="CRM workflow">
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button onClick={() => setRetry((n) => n + 1)}>Retry loading edits</button>
          </>
        ) : (
          <p>Loading CRM edits…</p>
        )}
      </section>
    );

  const dirty =
    JSON.stringify({ ...draft, updated_at: null }) !==
    JSON.stringify({ ...base, updated_at: null });
  const control = "w-full rounded border border-input bg-background px-3 py-2 text-sm";
  return (
    <section className="space-y-4 rounded-lg border border-border p-4" aria-label="CRM workflow">
      <div>
        <h2 className="font-semibold">Your CRM workspace</h2>
        <p className="text-xs text-muted-foreground">
          Sales stages and corrections are separate from the research assessment. Research and
          evidence stay unchanged.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {conflict && (
        <div role="alert" className="space-y-2 rounded border border-amber-500 p-3 text-sm">
          <p>
            Another session saved this record. Your draft has been kept. Review the latest saved
            version below before applying your changes.
          </p>
          <p>
            Saved stage: {conflict.stage}; starred: {conflict.starred ? "yes" : "no"}
          </p>
          <p className="whitespace-pre-wrap">Saved notes: {conflict.notes || "None"}</p>
          <pre className="overflow-auto whitespace-pre-wrap">
            Saved corrections: {JSON.stringify(conflict.overrides, null, 2)}
          </pre>
          <button
            className="rounded border px-3 py-2"
            onClick={() => {
              setDraft(reapplyCrmDraft(base, draft, conflict));
              setBase(conflict);
              setConflict(null);
              setNotice(
                "Reviewed version loaded. Check your draft, combine any notes you need to keep, then save. Prior notes remain in history.",
              );
            }}
          >
            I reviewed the latest version; keep my changes
          </button>
          <button
            className="ml-2 rounded border px-3 py-2"
            onClick={() => {
              setBase(conflict);
              setDraft(conflict);
              setConflict(null);
              setNotice("Loaded the latest saved version; discarded your draft.");
            }}
          >
            Discard my draft and use saved version
          </button>
        </div>
      )}
      <fieldset disabled={saving} className="space-y-4 disabled:opacity-60">
        <div className="flex items-end gap-4">
          <label className="flex-1 text-sm">
            Sales stage
            <select
              aria-label="Sales stage"
              className={control}
              value={draft.stage}
              onChange={(event) =>
                setDraft({ ...draft, stage: event.target.value as CrmWorkingState["stage"] })
              }
            >
              {STAGES.map((stage) => (
                <option key={stage} value={stage}>
                  {stage}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 py-2 text-sm">
            <input
              type="checkbox"
              checked={draft.starred}
              onChange={(event) => setDraft({ ...draft, starred: event.target.checked })}
            />
            Starred
          </label>
        </div>
        <label className="block text-sm">
          Your notes
          <textarea
            aria-label="Your notes"
            className={`${control} min-h-28`}
            maxLength={10000}
            value={draft.notes ?? ""}
            onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
          />
        </label>
        <details>
          <summary className="cursor-pointer text-sm font-medium">
            Business and contact corrections
          </summary>
          <div className="mt-3 space-y-3">
            {CRM_EDITABLE_FIELDS[entityType].map((field) => {
              const original = researchFields[field];
              const researched =
                original == null
                  ? ""
                  : typeof original === "string"
                    ? original
                    : JSON.stringify(original);
              const overridden = Object.hasOwn(draft.overrides, field);
              return (
                <div key={field} className="rounded border border-border p-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={overridden}
                      onChange={(event) => {
                        const overrides = { ...draft.overrides };
                        if (event.target.checked) overrides[field] = researched;
                        else delete overrides[field];
                        setDraft({ ...draft, overrides });
                      }}
                    />
                    Correct {field}
                  </label>
                  <p className="mt-1 break-words text-xs text-muted-foreground">
                    Research value: {researched || "Unknown"}
                  </p>
                  {overridden && (
                    <>
                      <input
                        aria-label={`Corrected ${field}`}
                        className={`${control} mt-2`}
                        maxLength={2000}
                        value={draft.overrides[field] ?? ""}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            overrides: { ...draft.overrides, [field]: event.target.value },
                          })
                        }
                      />
                      {draft.overrides[field] !== researched && (
                        <p className="mt-1 text-xs">
                          Your correction differs from research. Both values are retained.
                        </p>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </details>
        <button
          disabled={!dirty || !!conflict || saving}
          className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
          onClick={submit}
        >
          {saving ? "Saving…" : "Save CRM changes"}
        </button>
        {dirty && <span className="ml-3 text-xs text-muted-foreground">Unsaved draft</span>}
      </fieldset>
      <details>
        <summary className="cursor-pointer text-sm">
          Edit history ({history.length}
          {history.length === 30 ? "+" : ""})
        </summary>
        {history.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">No user edits yet.</p>
        ) : (
          <ol className="mt-2 space-y-3">
            {history.map((entry) => (
              <li key={entry.id} className="rounded border border-border p-2 text-xs">
                <p>
                  Version {entry.version} ·{" "}
                  {entry.created_at ? new Date(entry.created_at).toLocaleString() : "Just now"}
                </p>
                <p className="break-all text-muted-foreground">Edited by {entry.actor_id}</p>
                <p>
                  Stage: {entry.after_state.stage} · Starred:{" "}
                  {entry.after_state.starred ? "yes" : "no"}
                </p>
                <p className="whitespace-pre-wrap">Notes: {entry.after_state.notes || "None"}</p>
                <pre className="overflow-auto whitespace-pre-wrap">
                  Corrections: {JSON.stringify(entry.after_state.overrides, null, 2)}
                </pre>
              </li>
            ))}
          </ol>
        )}
      </details>
    </section>
  );
}
