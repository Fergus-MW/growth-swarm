import type { Tables } from "@/integrations/supabase/types";

export type ResearchNode = Tables<"nodes">;
export type ResearchEdge = Tables<"edges">;
export type ResearchAssertion = Tables<"assertions">;

export function objectFields(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function safeResearchUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

export function evidenceReferences(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    const item = objectFields(raw);
    const chunkId = item["chunk_id"] ?? item["chunkId"];
    if (typeof chunkId !== "string") return [];
    return [
      {
        chunkId,
        quote: typeof item["quote"] === "string" ? item["quote"] : "",
        polarity: typeof item["polarity"] === "string" ? item["polarity"] : "unspecified",
        start: typeof item["start"] === "number" ? item["start"] : null,
        end: typeof item["end"] === "number" ? item["end"] : null,
      },
    ];
  });
}

/** Only highlight offsets verified against the actual stored passage. */
export function resolveEvidenceSpan(
  content: string,
  ref: ReturnType<typeof evidenceReferences>[number],
) {
  if (!ref.quote) return null;
  if (ref.start !== null || ref.end !== null) {
    if (
      ref.start === null ||
      ref.end === null ||
      !Number.isInteger(ref.start) ||
      !Number.isInteger(ref.end) ||
      ref.start < 0 ||
      ref.end <= ref.start ||
      ref.end > content.length ||
      content.slice(ref.start, ref.end) !== ref.quote
    )
      return null;
    return { start: ref.start, end: ref.end };
  }
  const start = content.indexOf(ref.quote);
  // Legacy quote-only citations must resolve unambiguously; never guess a span.
  if (start < 0 || content.indexOf(ref.quote, start + 1) !== -1) return null;
  return { start, end: start + ref.quote.length };
}

export function summarizeRecordContext(input: {
  ownerIds: string[];
  nodes: ResearchNode[];
  edges: ResearchEdge[];
  assertions: ResearchAssertion[];
}) {
  const owners = new Set(input.ownerIds);
  const nodes = new Map(input.nodes.map((node) => [node.id, node]));
  const edges = [...new Map(input.edges.map((edge) => [edge.id, edge])).values()];
  const direct = edges.filter((edge) => owners.has(edge.from_node) || owners.has(edge.to_node));
  const painIds = new Set(
    direct
      .filter((edge) => edge.relation === "holds_pain" && owners.has(edge.from_node))
      .map((edge) => edge.to_node),
  );
  const employedPeople = new Set(
    direct
      .filter(
        (edge) =>
          edge.relation === "works_at" &&
          owners.has(edge.to_node) &&
          edge.polarity !== "contradicts",
      )
      .map((edge) => edge.from_node),
  );
  const relevant = edges.filter(
    (edge) =>
      direct.includes(edge) ||
      (edge.relation === "best_contact_for" &&
        painIds.has(edge.to_node) &&
        employedPeople.has(edge.from_node)),
  );
  const links = relevant.map((edge) => {
    const otherId = owners.has(edge.from_node) ? edge.to_node : edge.from_node;
    return { edge, node: nodes.get(otherId) ?? null };
  });
  const relatedIds = new Set(
    links.map((link) => link.node?.id).filter((id): id is string => Boolean(id)),
  );
  const assertions = input.assertions.filter(
    (assertion) =>
      owners.has(assertion.owner_node_id) ||
      (relatedIds.has(assertion.owner_node_id) &&
        nodes.get(assertion.owner_node_id)?.category === "note"),
  );
  const evidenceIds = new Set(
    assertions.flatMap((assertion) =>
      evidenceReferences(assertion.evidence).map((ref) => ref.chunkId),
    ),
  );
  for (const edge of direct)
    if (edge.relation === "evidences") {
      const source = nodes.get(edge.from_node);
      if (source?.category === "source_chunk") evidenceIds.add(source.id);
    }
  const contactIds = new Set(
    links
      .filter(
        ({ node, edge }) =>
          node?.entity_type === "person" &&
          ["works_at", "best_contact_for"].includes(edge.relation) &&
          edge.polarity !== "contradicts",
      )
      .map(({ node }) => node!.id),
  );
  return { links, assertions, evidenceIds: [...evidenceIds], contactIds: [...contactIds] };
}
