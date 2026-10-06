import { useState } from "react";
import { Bot, Pin, ArrowUpRight } from "lucide-react";
import {
  agentStatus,
  eventFields,
  eventText,
  type AgentEvent,
  type AgentVote,
} from "@/lib/agent-history";

export function AgentActivityPanel({
  index,
  events,
  votes,
  runStatus,
  onSelect,
}: {
  index: number;
  events: AgentEvent[];
  votes: AgentVote[];
  runStatus: string;
  onSelect: (id: string) => void;
}) {
  const [pinned, setPinned] = useState(false);
  const name = `Agent ${String(index + 1).padStart(2, "0")}`;
  const status = agentStatus(events, runStatus);
  const latest = events.at(-1);
  const searches = events.filter((event) => event.kind === "search");
  const explanations = events.filter((event) => event.kind === "agent_voted");
  const voteEpochs = new Set(explanations.map((event) => eventFields(event)["epoch"]));
  const savedVotes = votes.filter((vote) => !voteEpochs.has(vote.epoch));
  function entry(event: AgentEvent) {
    const fields = eventFields(event);
    const nodeId = fields["nodeId"];
    const chunkIds = Array.isArray(fields["chunkIds"])
      ? fields["chunkIds"].filter((id): id is string => typeof id === "string")
      : [];
    return (
      <li
        key={event.id}
        className="space-y-1 border-t border-border pt-2 first:border-0 first:pt-0"
      >
        <div className="font-data text-[9px] text-muted-foreground">
          <time dateTime={event.created_at}>{new Date(event.created_at).toLocaleTimeString()}</time>{" "}
          · {event.kind.replaceAll("_", " ")}
        </div>
        <p className="whitespace-pre-wrap text-xs leading-relaxed">{eventText(event)}</p>
        {event.kind === "search" && (
          <p className="font-data text-[10px] text-muted-foreground">
            {typeof fields["status"] === "string" ? fields["status"] : "Recorded"}
            {typeof fields["results"] === "number" && ` · ${fields["results"]} results`}
          </p>
        )}
        {event.kind === "agent_voted" && (
          <p className="font-data text-[10px] text-muted-foreground">
            {typeof fields["decision"] === "string" ? fields["decision"] : "Recorded vote"} ·
            revision {typeof fields["revision"] === "number" ? fields["revision"] : "unavailable"}
          </p>
        )}
        {typeof nodeId === "string" && (
          <button
            onClick={() => onSelect(nodeId)}
            className="inline-flex items-center gap-1 text-[10px] text-primary"
          >
            Inspect finding
            <ArrowUpRight className="h-3 w-3" />
          </button>
        )}
        {chunkIds.map((id) => (
          <button
            key={id}
            onClick={() => onSelect(id)}
            className="mr-2 inline-flex items-center gap-1 text-[10px] text-primary"
          >
            Inspect source
            <ArrowUpRight className="h-3 w-3" />
          </button>
        ))}
      </li>
    );
  }
  return (
    <article
      aria-label={name}
      className={`min-w-0 space-y-2 rounded-md border bg-card p-2.5 [overflow-wrap:anywhere] ${pinned ? "border-primary" : "border-border"}`}
    >
      <div className="flex items-center justify-between gap-1">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold">
          <Bot className="h-3 w-3 text-primary" />
          {name}
        </h2>
        <button
          aria-label={`${pinned ? "Unpin" : "Pin"} ${name}`}
          aria-pressed={pinned}
          onClick={() => setPinned(!pinned)}
          className="text-muted-foreground hover:text-primary"
        >
          <Pin className="h-3 w-3" />
        </button>
      </div>
      <div
        className={`font-data text-[10px] ${status === "Error" ? "text-destructive" : status === "Working" || status === "Evaluating" ? "text-primary" : "text-muted-foreground"}`}
      >
        {status}
      </div>
      <p className="line-clamp-2 text-xs text-foreground/90">
        {latest ? eventText(latest) : "Waiting for an available task."}
      </p>
      <details className="border-t border-border pt-2 text-[11px]">
        <summary className="cursor-pointer text-primary">Trace history ({events.length})</summary>
        <div className="mt-2 max-h-60 overflow-y-auto overscroll-contain pr-1">
          <p className="mb-2 text-[10px] text-muted-foreground">
            Recorded activity and provided explanations. Separate reasoning summaries are
            unavailable.
          </p>
          {events.length === 100 && (
            <p className="mb-2 text-[10px] text-muted-foreground">
              Latest 100 entries for this agent.
            </p>
          )}
          {events.length ? (
            <ol className="space-y-2">{events.map(entry)}</ol>
          ) : (
            <p>No activity recorded yet.</p>
          )}
        </div>
      </details>
      <details className="border-t border-border pt-2 text-[11px]">
        <summary className="cursor-pointer text-primary">
          Actions & results ({searches.length})
        </summary>
        <div className="mt-2 max-h-60 overflow-y-auto overscroll-contain pr-1">
          {searches.length ? (
            <ol className="space-y-2">{searches.map(entry)}</ol>
          ) : (
            <p>No source actions recorded yet.</p>
          )}
        </div>
      </details>
      <details className="border-t border-border pt-2 text-[11px]">
        <summary className="cursor-pointer text-primary">
          Decision explanations ({explanations.length + savedVotes.length})
        </summary>
        <div className="mt-2 max-h-60 overflow-y-auto overscroll-contain pr-1">
          {explanations.length || savedVotes.length ? (
            <ol className="space-y-2">
              {explanations.map(entry)}
              {savedVotes.map((vote) => (
                <li key={vote.id} className="space-y-1 border-t border-border pt-2">
                  <div className="font-data text-[9px] text-muted-foreground">
                    {vote.decision} · revision {vote.revision} · epoch {vote.epoch}
                  </div>
                  <p className="whitespace-pre-wrap text-xs">
                    {vote.rationale || "No decision explanation provided."}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <p>No decision explanation recorded yet.</p>
          )}
        </div>
      </details>
    </article>
  );
}
