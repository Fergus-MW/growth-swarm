import { useEffect, useRef, useState } from "react";
import { LiveGraph } from "@/graph/mount";
import type { GraphLink, GraphPoint, LinkFamily, LinkPolarity } from "@/graph/types";

export type GraphNode = {
  id: string;
  category: "primary_entity" | "note" | "source_chunk";
  title: string;
  entity_type?: string | null;
  semantic_kind?: string | null;
};

export type GraphEdge = {
  id: string;
  relation: string;
  from_node: string;
  to_node: string;
  polarity?: string | null;
  weight?: number | null;
};

const EVIDENCE = new Set(["evidences", "holds_pain", "best_contact_for", "works_at", "exhibits"]);

function family(relation: string): LinkFamily {
  if (relation === "retrieved_for" || relation === "mentions" || relation === "related_to" || relation === "references") return "context";
  if (EVIDENCE.has(relation) || relation === "evidences") return "evidence";
  return "semantic";
}

function polarity(value: string | null | undefined): LinkPolarity {
  if (value === "contradicts" || value === "qualifies") return value;
  return "supports";
}

function toPoint(node: GraphNode): GraphPoint {
  return { id: node.id, label: node.title, category: node.category, typeKey: node.entity_type || node.semantic_kind || node.category };
}

function toLink(edge: GraphEdge): GraphLink {
  const kind = family(edge.relation);
  return {
    id: edge.id,
    source: edge.from_node,
    target: edge.to_node,
    relation: edge.relation,
    family: kind,
    polarity: polarity(edge.polarity),
    weight: typeof edge.weight === "number" ? edge.weight : kind === "context" ? 0.2 : 0.8,
  };
}

/**
 * One Cosmos instance for the life of the live graph. WebGL failure stays an
 * error: this view does not switch to another renderer.
 */
export function GraphCanvas({
  nodes,
  edges,
  selectedId,
  onSelect,
  showChunks,
  running = true,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  showChunks: boolean;
  running?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<LiveGraph | null>(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const [hover, setHover] = useState<string>("");
  const [error, setError] = useState<string>("");
  const previousFilter = useRef(showChunks);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let graph: LiveGraph;
    try {
      graph = new LiveGraph(container, {
        reducedMotion,
        onSelect: (id) => selectRef.current(id),
        onHover: (info) => setHover(info ? `${info.label} · ${info.category.replaceAll("_", " ")} · ${info.typeKey} · degree ${info.degree}` : ""),
        onResync: () => setError("The graph asked for a fresh snapshot. The next run update will refill it."),
        onError: (failure) => setError(failure.message),
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "WebGL initialization failed");
      return;
    }
    graphRef.current = graph;
    const claim = () => graph.claimPointer();
    const onKey = (event: KeyboardEvent) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      claim();
    };
    container.addEventListener("pointerdown", claim);
    container.addEventListener("wheel", claim, { passive: true });
    container.addEventListener("keydown", onKey);
    return () => {
      container.removeEventListener("pointerdown", claim);
      container.removeEventListener("wheel", claim);
      container.removeEventListener("keydown", onKey);
      graph.destroy();
      graphRef.current = null;
    };
  }, []);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    const visible = nodes.filter((node) => showChunks || node.category !== "source_chunk");
    const ids = new Set(visible.map((node) => node.id));
    const viewReplacement = previousFilter.current !== showChunks;
    previousFilter.current = showChunks;
    graph.update({
      nodes: visible.map(toPoint),
      edges: edges.filter((edge) => ids.has(edge.from_node) && ids.has(edge.to_node)).map(toLink),
      viewReplacement,
      terminal: !running,
    });
  }, [nodes, edges, showChunks, running]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} tabIndex={0} className="h-full w-full outline-none" role="img" aria-label={`Research graph with ${nodes.length} objects`} />
      <div className="absolute bottom-3 right-3 z-10 flex gap-2">
        <button type="button" className="rounded-md border border-border bg-card/90 px-2 py-1 text-xs disabled:opacity-40" disabled={!selectedId} onClick={() => { if (selectedId) graphRef.current?.focus(selectedId); }}>
          Focus
        </button>
        <button type="button" className="rounded-md border border-border bg-card/90 px-2 py-1 text-xs" onClick={() => graphRef.current?.fitView()}>
          Fit view
        </button>
      </div>
      {hover && <div className="pointer-events-none absolute left-3 bottom-3 z-10 max-w-sm rounded-md border border-border bg-card/90 px-2 py-1 text-xs">{hover}</div>}
      {error && <div className="absolute inset-x-3 bottom-12 z-10 rounded-md border border-destructive bg-card px-3 py-2 text-xs text-destructive" role="alert">{error}</div>}
    </div>
  );
}
