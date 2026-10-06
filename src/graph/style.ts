import type { GraphCategory, GraphLink, GraphPoint, LinkFamily } from "./types.ts";

export const SPACE_SIZE = 2048;
export const INNER_RADIUS = 60;
export const SEED_SPREAD = 700;
const GREY: [number, number, number, number] = [0.62, 0.64, 0.6, 1];
const NOTE: [number, number, number, number] = [0.72, 0.55, 0.95, 1];

export function hashId(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return hash >>> 0;
}

/** Disk seed. The same id always lands in the same place, independent of arrival order. */
export function seedPosition(id: string, space = SPACE_SIZE): [number, number] {
  const hash = hashId(id);
  const angle = ((hash % 1_000_000) / 1_000_000) * Math.PI * 2;
  const unit = ((hash >>> 8) % 1_000_000) / 1_000_000;
  const radius = INNER_RADIUS + Math.sqrt(unit) * SEED_SPREAD;
  return [space / 2 + Math.cos(angle) * radius, space / 2 + Math.sin(angle) * radius];
}

export function clampWeight(weight: number): number {
  if (!Number.isFinite(weight) || weight <= 0) return 0;
  return Math.min(1, weight);
}

/** A self-loop counts once. An edge with a missing end is not incident. */
export function degrees(ids: readonly string[], links: readonly GraphLink[]): Map<string, { degree: number; averageWeight: number }> {
  const totals = new Map<string, { degree: number; weight: number }>();
  for (const id of ids) totals.set(id, { degree: 0, weight: 0 });
  for (const link of links) {
    const weight = clampWeight(link.weight);
    const ends = link.source === link.target ? [link.source] : [link.source, link.target];
    for (const id of ends) {
      const row = totals.get(id);
      if (!row) continue;
      row.degree += 1;
      row.weight += weight;
    }
  }
  return new Map([...totals].map(([id, row]) => [id, { degree: row.degree, averageWeight: row.degree ? row.weight / row.degree : 0 }]));
}

export function relevance(degree: number, maxDegree: number, averageWeight: number): number {
  const share = maxDegree > 0 ? degree / maxDegree : 0;
  const value = 0.7 * share + 0.3 * clampWeight(averageWeight);
  return Number.isFinite(value) ? value : 0;
}

export function pointSize(degree: number, score: number): number {
  return 4 + score * 5 + Math.min(degree, 16) * 0.2;
}

export function linkWidth(weight: number): number {
  return 0.5 + clampWeight(weight) * 1.5;
}

export function displayLabel(label: string): string {
  return label.length > 28 ? `${label.slice(0, 28)}…` : label;
}

export function parseColor(value: string): [number, number, number] | null {
  const hex = value.trim().match(/^#([0-9a-f]{6})$/i);
  if (hex?.[1]) {
    const raw = hex[1];
    return [parseInt(raw.slice(0, 2), 16) / 255, parseInt(raw.slice(2, 4), 16) / 255, parseInt(raw.slice(4, 6), 16) / 255];
  }
  const rgb = value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (rgb?.[1] && rgb[2] && rgb[3]) return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255];
  return null;
}

export function colourStops(palette: readonly [number, number, number][]): [number, number, number][] {
  const source = palette.length >= 2 ? palette : [[0.45, 0.75, 0.55] as [number, number, number], [0.55, 0.65, 0.85] as [number, number, number]];
  return Array.from({ length: 15 }, (_, index) => {
    const t = index / 14;
    const scaled = t * (source.length - 1);
    const left = Math.floor(scaled);
    const right = Math.min(source.length - 1, left + 1);
    const mix = scaled - left;
    const a = source[left] ?? source[0]!;
    const b = source[right] ?? a;
    return [a[0] + (b[0] - a[0]) * mix, a[1] + (b[1] - a[1]) * mix, a[2] + (b[2] - a[2]) * mix];
  });
}

export function pointColor(point: GraphPoint, stops: readonly [number, number, number][]): [number, number, number, number] {
  if (point.category === "source_chunk") return GREY;
  if (point.category === "note") return NOTE;
  const stop = stops[hashId(point.typeKey || point.category) % stops.length] ?? stops[0]!;
  return [stop[0], stop[1], stop[2], 1];
}

export function pointShape(category: GraphCategory): number {
  if (category === "primary_entity") return 1;
  if (category === "note") return 3;
  return 0;
}

export function linkColor(link: GraphLink): [number, number, number, number] {
  if (link.polarity === "contradicts") return [0.85, 0.45, 0.38, 0.9];
  if (link.family === "context") return [0.45, 0.55, 0.42, 0.35];
  if (link.family === "evidence") return [0.55, 0.78, 0.48, 0.9];
  return [0.48, 0.62, 0.4, 0.75];
}

export function linkStyle(family: LinkFamily): number {
  return family === "context" ? 1 : 0;
}
