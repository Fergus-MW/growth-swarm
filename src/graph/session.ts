import { frameTransform, focusZoom } from "./frame.ts";
import { colourStops, degrees, displayLabel, linkColor, linkStyle, linkWidth, pointColor, pointShape, pointSize, relevance, seedPosition } from "./style.ts";
import type { GraphDelta, GraphLink, GraphPoint, GraphUploader, HoverInfo, Viewport, ViewTransform } from "./types.ts";

const PENDING_LIMIT = 500;
const PENDING_TTL_MS = 8_000;
const SETTLE_MS = 8_000;

export interface SessionClock {
  now(): number;
  schedule(run: () => void): number;
  later(run: () => void, ms: number): number;
  cancel(id: number): void;
}

export interface CameraCommand {
  transform: ViewTransform;
  durationMs: number;
  reason: "auto" | "fit" | "focus";
}

interface StoredPoint extends GraphPoint {
  x: number;
  y: number;
  seen: boolean;
}

interface PendingEdge {
  link: GraphLink;
  queuedAt: number;
}

export interface VisibleGraph {
  nodes: GraphPoint[];
  edges: GraphLink[];
  viewReplacement?: boolean;
  terminal?: boolean;
}

export class GraphSession {
  private readonly points = new Map<string, StoredPoint>();
  private readonly links = new Map<string, GraphLink>();
  private readonly order: string[] = [];
  private readonly hidden = new Set<string>();
  private readonly pending: PendingEdge[] = [];
  private indexOf = new Map<string, number>();
  private activeIds: string[] = [];
  private fitted = false;
  private settled = true;
  private settleTimer: number | null = null;
  private frame = 0;
  private queued: VisibleGraph | null = null;
  private userOwned = false;
  private destroyed = false;
  private expiryTimer: number | null = null;
  private view: ViewTransform = { k: 1, x: 0, y: 0 };
  private capacity = 0;
  private pointPositions = new Float32Array(0);
  private pointColors = new Float32Array(0);
  private pointSizes = new Float32Array(0);
  private pointShapes = new Float32Array(0);
  readonly cameras: CameraCommand[] = [];
  readonly stats = { positionUploads: 0, visualUploads: 0, resyncs: 0, allocatedFloats: 0, renderer: 1 };

  constructor(
    private readonly uploader: GraphUploader,
    private readonly clock: SessionClock,
    private readonly reducedMotion: boolean,
    private readonly palette: readonly [number, number, number][],
    private readonly viewport: () => Viewport,
    private readonly onResync: (reason: string) => void,
  ) {}

  submit(graph: VisibleGraph): void {
    if (this.destroyed) return;
    this.queued = graph;
    if (this.frame) return;
    this.frame = this.clock.schedule(() => {
      this.frame = 0;
      if (this.destroyed) return;
      const next = this.queued;
      this.queued = null;
      if (next) this.replaceVisible(next);
    });
  }

  replaceVisible(graph: VisibleGraph): void {
    if (this.destroyed) return;
    this.pending.length = 0;
    this.disarmExpiry();
    const visible = new Set(graph.nodes.map((node) => node.id));
    for (const node of graph.nodes) this.remember(node);
    for (const id of this.points.keys()) {
      if (visible.has(id)) this.hidden.delete(id);
      else this.hidden.add(id);
    }
    this.links.clear();
    for (const link of graph.edges) {
      if (visible.has(link.source) && visible.has(link.target)) this.links.set(link.id, link);
    }
    this.publish(graph.viewReplacement === true, graph.terminal === true);
  }

  applyDelta(delta: GraphDelta): void {
    if (this.destroyed) return;
    for (const node of delta.upsertNodes ?? []) {
      this.hidden.delete(node.id);
      this.remember(node);
    }
    for (const id of delta.removeNodeIds ?? []) this.forget(id);
    for (const merge of delta.merges ?? []) this.merge(merge.from, merge.to);
    for (const id of delta.removeEdgeIds ?? []) {
      this.links.delete(id);
      this.dropPending(id);
    }
    const now = this.clock.now();
    for (const link of delta.upsertEdges ?? []) {
      this.dropPending(link.id);
      if (this.points.has(link.source) && this.points.has(link.target) && !this.hidden.has(link.source) && !this.hidden.has(link.target)) this.links.set(link.id, link);
      else {
        this.links.delete(link.id);
        this.enqueue(link, now);
      }
    }
    this.flushPending();
    this.publish(false, false);
  }

  hover(index: number | undefined): HoverInfo | null {
    if (index === undefined) return null;
    const id = this.activeIds[index];
    const point = id ? this.points.get(id) : undefined;
    if (!id || !point) return null;
    const degree = degrees(this.activeIds, [...this.links.values()]).get(id)?.degree ?? 0;
    return { id, label: displayLabel(point.label), category: point.category, typeKey: point.typeKey, degree };
  }

  selectId(index: number | undefined): string | null {
    if (index === undefined) return null;
    return this.activeIds[index] ?? null;
  }

  claimPointer(): void {
    this.userOwned = true;
  }

  fitView(): void {
    if (this.destroyed) return;
    this.userOwned = true;
    this.moveCamera("fit");
  }

  focus(id: string): void {
    if (this.destroyed) return;
    const index = this.indexOf.get(id);
    const point = this.points.get(id);
    if (index === undefined || !point || this.hidden.has(id)) return;
    this.userOwned = true;
    const zoom = focusZoom(this.view.k);
    const durationMs = this.reducedMotion ? 0 : 300;
    this.view = { ...this.viewFrom(point.x, point.y, zoom) };
    this.cameras.push({ transform: this.view, durationMs, reason: "focus" });
    this.uploader.focusIndex(index, durationMs, zoom);
  }

  noteAlphaSettled(): void {
    if (this.destroyed) return;
    this.completeSettle();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.settleTimer !== null) this.clock.cancel(this.settleTimer);
    if (this.frame) this.clock.cancel(this.frame);
    this.disarmExpiry();
    this.settleTimer = null;
    this.frame = 0;
    this.queued = null;
  }

  private remember(node: GraphPoint): void {
    const existing = this.points.get(node.id);
    if (existing) {
      existing.label = node.label;
      existing.category = node.category;
      existing.typeKey = node.typeKey;
      return;
    }
    const [x, y] = seedPosition(node.id);
    this.points.set(node.id, { ...node, x, y, seen: true });
    this.order.push(node.id);
  }

  private forget(id: string): void {
    this.points.delete(id);
    this.hidden.delete(id);
    this.order = this.order.filter((item) => item !== id);
    for (const [edgeId, link] of this.links) if (link.source === id || link.target === id) this.links.delete(edgeId);
    for (let index = this.pending.length - 1; index >= 0; index -= 1) {
      const link = this.pending[index]?.link;
      if (link && (link.source === id || link.target === id)) this.pending.splice(index, 1);
    }
    if (!this.pending.length) this.disarmExpiry();
  }

  private merge(from: string, to: string): void {
    if (from === to || !this.points.has(from) || !this.points.has(to)) return;
    for (const [id, link] of this.links) {
      const source = link.source === from ? to : link.source;
      const target = link.target === from ? to : link.target;
      this.links.set(id, { ...link, source, target });
    }
    this.forget(from);
  }

  private dropPending(id: string): void {
    for (let index = this.pending.length - 1; index >= 0; index -= 1) {
      if (this.pending[index]?.link.id === id) this.pending.splice(index, 1);
    }
  }

  private enqueue(link: GraphLink, now: number): void {
    this.dropPending(link.id);
    this.pending.push({ link, queuedAt: now });
    if (this.pending.length > PENDING_LIMIT) {
      this.pending.length = 0;
      this.disarmExpiry();
      this.stats.resyncs += 1;
      this.onResync("pending-overflow");
      return;
    }
    this.armExpiry();
  }

  private armExpiry(): void {
    if (this.destroyed || this.expiryTimer !== null || !this.pending.length) return;
    const now = this.clock.now();
    let due = Number.POSITIVE_INFINITY;
    for (const item of this.pending) due = Math.min(due, item.queuedAt + PENDING_TTL_MS);
    this.expiryTimer = this.clock.later(() => {
      this.expiryTimer = null;
      if (this.destroyed) return;
      const before = this.pending.length;
      this.flushPending();
      if (this.pending.length !== before) this.publish(false, false);
      this.armExpiry();
    }, Math.max(0, due - now));
  }

  private disarmExpiry(): void {
    if (this.expiryTimer === null) return;
    this.clock.cancel(this.expiryTimer);
    this.expiryTimer = null;
  }

  private flushPending(): void {
    const now = this.clock.now();
    const keep: PendingEdge[] = [];
    let expired = false;
    for (const item of this.pending) {
      if (now - item.queuedAt >= PENDING_TTL_MS) {
        expired = true;
        continue;
      }
      if (this.points.has(item.link.source) && this.points.has(item.link.target) && !this.hidden.has(item.link.source) && !this.hidden.has(item.link.target)) this.links.set(item.link.id, item.link);
      else keep.push(item);
    }
    this.pending.length = 0;
    this.pending.push(...keep);
    if (!this.pending.length) this.disarmExpiry();
    if (expired) {
      this.stats.resyncs += 1;
      this.onResync("pending-expired");
    }
  }

  private publish(viewReplacement: boolean, terminal: boolean): void {
    const nextIds = this.order.filter((id) => this.points.has(id) && !this.hidden.has(id));
    const signature = this.edgeSignature();
    const topology = nextIds.join("\0") !== this.activeIds.join("\0") || signature !== this.lastSignature;
    if (topology) this.captureSimulatedPositions();
    this.activeIds = nextIds;
    this.indexOf = new Map(nextIds.map((id, index) => [id, index]));
    const links = [...this.links.values()].filter((link) => this.indexOf.has(link.source) && this.indexOf.has(link.target));
    this.upload(nextIds, links, topology);
    this.lastSignature = signature;
    if (!nextIds.length) {
      this.uploader.pause();
      this.settled = true;
      return;
    }
    if (topology) {
      const automatic = !this.userOwned && (viewReplacement || !this.fitted);
      this.fitted = this.fitted && !automatic;
      this.settled = false;
      if (this.settleTimer !== null) this.clock.cancel(this.settleTimer);
      this.settleTimer = this.clock.later(() => this.completeSettle(), SETTLE_MS);
      if (!this.reducedMotion) this.uploader.start(1);
      else this.uploader.pause();
    } else if (terminal && !this.settled) {
      this.completeSettle();
    }
  }

  private lastSignature = "";

  private edgeSignature(): string {
    return [...this.links.values()].map((link) => `${link.id}:${link.source}:${link.target}:${link.relation}`).sort().join("|");
  }

  private captureSimulatedPositions(): void {
    if (!this.activeIds.length) return;
    const values = this.uploader.getPointPositions();
    this.activeIds.forEach((id, index) => {
      const x = values[index * 2];
      const y = values[index * 2 + 1];
      const point = this.points.get(id);
      if (!point || x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) return;
      point.x = x;
      point.y = y;
    });
  }

  private ensurePointBuffers(count: number): void {
    if (this.capacity >= count) return;
    this.capacity = Math.max(64, 2 ** Math.ceil(Math.log2(Math.max(count, 1))));
    this.pointPositions = new Float32Array(this.capacity * 2);
    this.pointColors = new Float32Array(this.capacity * 4);
    this.pointSizes = new Float32Array(this.capacity);
    this.pointShapes = new Float32Array(this.capacity);
    this.stats.allocatedFloats += this.capacity * 8;
  }

  private upload(ids: string[], links: GraphLink[], topology: boolean): void {
    const count = ids.length;
    this.ensurePointBuffers(count);
    const positions = this.pointPositions.subarray(0, count * 2);
    const colors = this.pointColors.subarray(0, count * 4);
    const sizes = this.pointSizes.subarray(0, count);
    const shapes = this.pointShapes.subarray(0, count);
    const incident = degrees(ids, links);
    const maxDegree = Math.max(0, ...[...incident.values()].map((row) => row.degree));
    const stops = colourStops(this.palette);
    ids.forEach((id, index) => {
      const point = this.points.get(id);
      if (!point) return;
      positions[index * 2] = point.x;
      positions[index * 2 + 1] = point.y;
      const row = incident.get(id) ?? { degree: 0, averageWeight: 0 };
      const score = relevance(row.degree, maxDegree, row.averageWeight);
      const color = pointColor(point, stops);
      colors.set(color, index * 4);
      sizes[index] = pointSize(row.degree, score);
      shapes[index] = pointShape(point.category);
    });
    const linkPositions = new Float32Array(links.length * 2);
    const linkColors = new Float32Array(links.length * 4);
    const linkWidths = new Float32Array(links.length);
    const linkStyles = new Float32Array(links.length);
    links.forEach((link, index) => {
      linkPositions[index * 2] = this.indexOf.get(link.source) ?? 0;
      linkPositions[index * 2 + 1] = this.indexOf.get(link.target) ?? 0;
      linkColors.set(linkColor(link), index * 4);
      linkWidths[index] = linkWidth(link.weight);
      linkStyles[index] = linkStyle(link.family);
    });
    if (topology) {
      this.uploader.setPointPositions(positions);
      this.stats.positionUploads += 1;
    }
    this.uploader.setPointColors(colors);
    this.uploader.setPointSizes(sizes);
    this.uploader.setPointShapes(shapes);
    this.uploader.setLinks(linkPositions);
    this.uploader.setLinkColors(linkColors);
    this.uploader.setLinkWidths(linkWidths);
    this.uploader.setLinkStyles(linkStyles);
    this.uploader.render(undefined);
    this.stats.visualUploads += 1;
  }

  private completeSettle(): void {
    if (this.destroyed || this.settled) return;
    this.settled = true;
    if (this.settleTimer !== null) this.clock.cancel(this.settleTimer);
    this.settleTimer = null;
    this.uploader.pause();
    if (this.userOwned || this.fitted || this.reducedMotion) return;
    this.fitted = true;
    this.captureSimulatedPositions();
    this.moveCamera("auto");
  }

  private moveCamera(reason: "auto" | "fit"): void {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const id of this.activeIds) {
      const point = this.points.get(id);
      if (!point) continue;
      xs.push(point.x);
      ys.push(point.y);
    }
    const transform = frameTransform(xs, ys, this.viewport());
    if (!transform) return;
    const durationMs = this.reducedMotion ? 0 : 300;
    this.view = transform;
    this.cameras.push({ transform, durationMs, reason });
    this.uploader.setViewTransform(transform, durationMs);
  }

  private viewFrom(x: number, y: number, k: number): ViewTransform {
    const viewport = this.viewport();
    return frameTransform([x, x, x], [y, y, y], viewport) ? { ...this.centered(x, y, k, viewport) } : { k, x: 0, y: 0 };
  }

  private centered(x: number, y: number, k: number, viewport: Viewport): ViewTransform {
    const usableW = Math.max(1, viewport.width - viewport.insets.left - viewport.insets.right);
    const usableH = Math.max(1, viewport.height - viewport.insets.top - viewport.insets.bottom);
    const centerX = viewport.insets.left + usableW / 2;
    const centerY = viewport.insets.top + usableH / 2;
    const space = 2048;
    return {
      k,
      x: centerX - k * (x + (viewport.width - space) / 2),
      y: centerY - k * ((space - y) + (viewport.height - space) / 2),
    };
  }
}
