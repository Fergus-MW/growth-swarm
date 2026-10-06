import { Graph } from "@cosmos.gl/graph";
import { cosmosMountConfig } from "./config.ts";
import { GraphSession, type SessionClock, type VisibleGraph } from "./session.ts";
import { parseColor } from "./style.ts";
import type { GraphDelta, GraphUploader, HoverInfo, Viewport } from "./types.ts";

export interface LiveGraphHandlers {
  onSelect: (id: string) => void;
  onHover: (info: HoverInfo | null) => void;
  onResync: (reason: string) => void;
  onError: (error: Error) => void;
  reducedMotion: boolean;
  backgroundColor?: string;
}

const FALLBACK_PALETTE: [number, number, number][] = [
  [0.31, 0.78, 0.72],
  [0.62, 0.48, 0.95],
  [0.86, 0.72, 0.38],
  [0.78, 0.38, 0.32],
  [0.48, 0.7, 0.48],
];

export function readPalette(): [number, number, number][] {
  if (typeof document === "undefined") return FALLBACK_PALETTE;
  const root = getComputedStyle(document.documentElement);
  const parsed = ["--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5"].map((name) => parseColor(root.getPropertyValue(name)));
  return parsed.every((color): color is [number, number, number] => color !== null) ? parsed : FALLBACK_PALETTE;
}

export class LiveGraph {
  private readonly session: GraphSession;
  private readonly graph: Graph;
  private failed = false;

  constructor(container: HTMLElement, private readonly handlers: LiveGraphHandlers) {
    const config = cosmosMountConfig({
      pixelRatio: window.devicePixelRatio || 1,
      reducedMotion: handlers.reducedMotion,
      ...(handlers.backgroundColor ? { backgroundColor: handlers.backgroundColor } : {}),
    });
    let graph: Graph;
    try {
      graph = new Graph(container as HTMLDivElement, {
        ...config,
        onClick: (index) => {
          const id = this.session.selectId(index);
          if (id) handlers.onSelect(id);
        },
        onPointMouseOver: (index) => handlers.onHover(this.session.hover(index)),
        onPointMouseOut: () => handlers.onHover(null),
        onZoomStart: (_event, userDriven) => { if (userDriven) this.session.claimPointer(); },
        onDragStart: () => this.session.claimPointer(),
        onSimulationEnd: () => this.session.noteAlphaSettled(),
      });
    } catch (error) {
      this.failed = true;
      this.graph = null as unknown as Graph;
      this.session = null as unknown as GraphSession;
      handlers.onError(error instanceof Error ? error : new Error("WebGL initialization failed"));
      return;
    }
    this.graph = graph;
    this.session = new GraphSession(adapt(graph), browserClock(), handlers.reducedMotion, readPalette(), () => measure(container), handlers.onResync);
    void graph.ready.catch((error: unknown) => {
      this.fail(error instanceof Error ? error : new Error("WebGL initialization failed"));
    });
  }

  update(graph: VisibleGraph): void {
    if (!this.failed) this.session.submit(graph);
  }

  applyDelta(delta: GraphDelta): void {
    if (!this.failed) this.session.applyDelta(delta);
  }

  fitView(): void {
    if (!this.failed) this.session.fitView();
  }

  focus(id: string): void {
    if (!this.failed) this.session.focus(id);
  }

  claimPointer(): void {
    if (!this.failed) this.session.claimPointer();
  }

  destroy(): void {
    if (this.failed) return;
    this.session.destroy();
    this.graph.destroy();
  }

  private fail(error: Error): void {
    if (this.failed) return;
    this.failed = true;
    this.session.destroy();
    this.graph.destroy();
    this.handlers.onError(error);
  }
}

function measure(container: HTMLElement): Viewport {
  const rect = container.getBoundingClientRect();
  return { width: rect.width || 1, height: rect.height || 1, insets: { left: 0, right: 0, top: 0, bottom: 0 } };
}

function browserClock(): SessionClock {
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  let next = 1;
  return {
    now: () => performance.now(),
    schedule: (run) => {
      const id = next;
      next += 1;
      const handle = requestAnimationFrame(() => {
        timers.delete(id);
        run();
      });
      timers.set(id, handle as unknown as ReturnType<typeof setTimeout>);
      return id;
    },
    later: (run, ms) => {
      const id = next;
      next += 1;
      timers.set(id, setTimeout(() => {
        timers.delete(id);
        run();
      }, ms));
      return id;
    },
    cancel: (id) => {
      const handle = timers.get(id);
      if (handle === undefined) return;
      clearTimeout(handle);
      cancelAnimationFrame(handle as unknown as number);
      timers.delete(id);
    },
  };
}

function currentView(graph: Graph): { k: number; x: number; y: number } {
  const zoom = (graph as unknown as { zoomInstance?: { eventTransform?: { k: number; x: number; y: number } } }).zoomInstance?.eventTransform;
  if (zoom && Number.isFinite(zoom.k) && Number.isFinite(zoom.x) && Number.isFinite(zoom.y)) return { k: zoom.k, x: zoom.x, y: zoom.y };
  return { k: graph.getZoomLevel() || 1, x: 0, y: 0 };
}

let viewFrame = 0;

function animateView(graph: Graph, transform: { k: number; x: number; y: number }, durationMs: number): void {
  if (viewFrame) cancelAnimationFrame(viewFrame);
  if (durationMs <= 0) {
    graph.setViewTransform(transform);
    viewFrame = 0;
    return;
  }
  const from = currentView(graph);
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / durationMs);
    const eased = t * t * (3 - 2 * t);
    graph.setViewTransform({
      k: from.k + (transform.k - from.k) * eased,
      x: from.x + (transform.x - from.x) * eased,
      y: from.y + (transform.y - from.y) * eased,
    });
    viewFrame = t < 1 ? requestAnimationFrame(step) : 0;
  };
  viewFrame = requestAnimationFrame(step);
}

function adapt(graph: Graph): GraphUploader {
  return {
    setPointPositions: (data) => graph.setPointPositions(data, true),
    setPointColors: (data) => graph.setPointColors(data),
    setPointSizes: (data) => graph.setPointSizes(data),
    setPointShapes: (data) => graph.setPointShapes(data),
    setLinks: (data) => graph.setLinks(data),
    setLinkColors: (data) => graph.setLinkColors(data),
    setLinkWidths: (data) => graph.setLinkWidths(data),
    setLinkStyles: (data) => graph.setLinkStyles(data),
    getPointPositions: () => graph.getPointPositionsArray(),
    render: (alpha) => graph.render(alpha, 0),
    pause: () => graph.pause(),
    start: (alpha) => graph.start(alpha),
    setViewTransform: (transform, durationMs) => animateView(graph, transform, durationMs),
    focusIndex: (index, duration, scale) => graph.zoomToPointByIndex(index, duration, scale, true, false),
  };
}
