export type GraphCategory = "primary_entity" | "note" | "source_chunk";
export type LinkFamily = "context" | "evidence" | "semantic";
export type LinkPolarity = "supports" | "contradicts" | "qualifies";

export interface GraphPoint {
  id: string;
  label: string;
  category: GraphCategory;
  typeKey: string;
}

export interface GraphLink {
  id: string;
  source: string;
  target: string;
  relation: string;
  family: LinkFamily;
  polarity: LinkPolarity;
  weight: number;
}

export interface GraphDelta {
  upsertNodes?: GraphPoint[];
  removeNodeIds?: string[];
  upsertEdges?: GraphLink[];
  removeEdgeIds?: string[];
  merges?: { from: string; to: string }[];
}

export interface ViewTransform {
  k: number;
  x: number;
  y: number;
}

export interface Viewport {
  width: number;
  height: number;
  insets: { left: number; right: number; top: number; bottom: number };
}

export interface HoverInfo {
  id: string;
  label: string;
  category: GraphCategory;
  typeKey: string;
  degree: number;
}

/** Uploads match the pinned Cosmos 3.5.0 setters. Tests use a recording double. */
export interface GraphUploader {
  setPointPositions(data: Float32Array): void;
  setPointColors(data: Float32Array): void;
  setPointSizes(data: Float32Array): void;
  setPointShapes(data: Float32Array): void;
  setLinks(data: Float32Array): void;
  setLinkColors(data: Float32Array): void;
  setLinkWidths(data: Float32Array): void;
  setLinkStyles(data: Float32Array): void;
  getPointPositions(): Float32Array;
  render(alpha: number | undefined): void;
  pause(): void;
  start(alpha: number): void;
  setViewTransform(transform: ViewTransform, durationMs: number): void;
  focusIndex(index: number, durationMs: number, scale: number): void;
}
