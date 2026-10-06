import type { Tables } from "@/integrations/supabase/types";

export type AgentEvent = Pick<
  Tables<"events">,
  "id" | "kind" | "agent_index" | "payload" | "created_at"
>;
export type AgentVote = Tables<"votes">;

export function eventFields(event: AgentEvent): Record<string, unknown> {
  return event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
    ? event.payload
    : {};
}

export function eventText(event: AgentEvent): string {
  const fields = eventFields(event);
  if (event.kind === "task_error" || event.kind === "agent_vote_error")
    return "The action failed. Recorded source details remain in the source ledger.";
  for (const key of ["summary", "rationale", "query", "title", "kind"]) {
    if (typeof fields[key] === "string" && fields[key]) return fields[key];
  }
  return "No display summary provided.";
}

export function mergeAgentEvents(previous: AgentEvent[], incoming: AgentEvent[]): AgentEvent[] {
  const unique = new Map([...previous, ...incoming].map((event) => [event.id, event]));
  const ordered = [...unique.values()].sort((a, b) => a.id - b.id);
  const counts = new Map<number | null, number>();
  const retained: AgentEvent[] = [];
  for (let index = ordered.length - 1; index >= 0; index--) {
    const event = ordered[index]!;
    const count = (counts.get(event.agent_index) ?? 0) + 1;
    counts.set(event.agent_index, count);
    if (count <= 100) retained.push(event);
  }
  return retained.reverse();
}

export function agentStatus(events: AgentEvent[], runStatus: string): string {
  const lifecycle = [...events]
    .reverse()
    .find((event) =>
      [
        "task_started",
        "task_done",
        "task_error",
        "agent_vote_started",
        "agent_voted",
        "agent_vote_error",
      ].includes(event.kind),
    );
  if (lifecycle?.kind === "task_error" || lifecycle?.kind === "agent_vote_error") return "Error";
  if (runStatus === "completed") return "Completed";
  if (runStatus === "ended") return "Finished";
  if (lifecycle?.kind === "task_started") return "Working";
  if (lifecycle?.kind === "agent_vote_started") return "Evaluating";
  return "Waiting";
}
