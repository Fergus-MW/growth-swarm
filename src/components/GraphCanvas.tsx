import { useEffect, useRef, useCallback } from "react";

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
};

type SimNode = GraphNode & { x: number; y: number; vx: number; vy: number };

const COLORS = {
  primary_entity: "#4fd8c4",
  note: "#b78cff",
  source_chunk: "#e8c15a",
};

const EVIDENCE_RELATIONS = new Set(["evidences", "holds_pain", "best_contact_for", "works_at", "exhibits"]);

/**
 * Live force-directed graph. Category is shown by shape + color:
 * entity = diamond, note = circle, chunk = square. Evidence relations draw
 * solid bright lines; retrieval context draws faint dashed lines.
 */
export function GraphCanvas({
  nodes,
  edges,
  selectedId,
  onSelect,
  showChunks,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  showChunks: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<Map<string, SimNode>>(new Map());
  const edgesRef = useRef<GraphEdge[]>([]);
  const selectedRef = useRef<string | null>(null);
  const cameraRef = useRef({ x: 0, y: 0, zoom: 1, userControlled: false });
  const dragRef = useRef<{ id: string | null; panning: boolean; sx: number; sy: number }>({ id: null, panning: false, sx: 0, sy: 0 });

  selectedRef.current = selectedId;
  edgesRef.current = edges;

  // Sync nodes into the simulation, preserving existing positions.
  useEffect(() => {
    const sim = simRef.current;
    const visible = new Set<string>();
    for (const n of nodes) {
      if (n.category === "source_chunk" && !showChunks) continue;
      visible.add(n.id);
      if (!sim.has(n.id)) {
        const angle = Math.random() * Math.PI * 2;
        const r = 60 + Math.random() * 160;
        sim.set(n.id, { ...n, x: Math.cos(angle) * r, y: Math.sin(angle) * r, vx: 0, vy: 0 });
      }
    }
    for (const key of Array.from(sim.keys())) {
      if (!visible.has(key)) sim.delete(key);
    }
  }, [nodes, showChunks]);

  const tick = useCallback(() => {
    const sim = simRef.current;
    const edgeList = edgesRef.current;
    const arr = Array.from(sim.values());

    // Forces: repulsion, springs, centering.
    for (let i = 0; i < arr.length; i++) {
      const a = arr[i]!;
      for (let j = i + 1; j < arr.length; j++) {
        const b = arr[j]!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          d2 = 1;
        }
        const d = Math.sqrt(d2);
        const rep = Math.min(2400 / d2, 8);
        const fx = (dx / d) * rep;
        const fy = (dy / d) * rep;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
      a.vx -= a.x * 0.004;
      a.vy -= a.y * 0.004;
    }
    for (const e of edgeList) {
      const a = sim.get(e.from_node);
      const b = sim.get(e.to_node);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.max(Math.hypot(dx, dy), 1);
      const target = 110;
      const f = (d - target) * 0.012;
      a.vx += (dx / d) * f;
      a.vy += (dy / d) * f;
      b.vx -= (dx / d) * f;
      b.vy -= (dy / d) * f;
    }
    for (const n of arr) {
      n.vx *= 0.82;
      n.vy *= 0.82;
      n.x += n.vx;
      n.y += n.vy;
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;

    const render = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      tick();
      const cam = cameraRef.current;

      // Auto-fit once when the user hasn't taken control.
      const sim = simRef.current;
      const arr = Array.from(sim.values());
      if (!cam.userControlled && arr.length > 0) {
        const xs = arr.map((n) => n.x).sort((a, b) => a - b);
        const ys = arr.map((n) => n.y).sort((a, b) => a - b);
        const lo = (v: number[]) => v[Math.floor(v.length * 0.02)] ?? v[0]!;
        const hi = (v: number[]) => v[Math.min(Math.floor(v.length * 0.98), v.length - 1)] ?? v[v.length - 1]!;
        const cx = (lo(xs) + hi(xs)) / 2;
        const cy = (lo(ys) + hi(ys)) / 2;
        const span = Math.max(hi(xs) - lo(xs), hi(ys) - lo(ys), 200);
        const targetZoom = Math.min(w, h) / (span + 160);
        cam.x += (cx - cam.x) * 0.06;
        cam.y += (cy - cam.y) * 0.06;
        cam.zoom += (targetZoom - cam.zoom) * 0.06;
      }

      const toScreen = (x: number, y: number) => ({
        x: (x - cam.x) * cam.zoom + w / 2,
        y: (y - cam.y) * cam.zoom + h / 2,
      });

      // Edges.
      for (const e of edgesRef.current) {
        const a = sim.get(e.from_node);
        const b = sim.get(e.to_node);
        if (!a || !b) continue;
        const pa = toScreen(a.x, a.y);
        const pb = toScreen(b.x, b.y);
        const evidence = EVIDENCE_RELATIONS.has(e.relation);
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        if (e.polarity === "contradicts") {
          ctx.strokeStyle = "rgba(240, 90, 70, 0.8)";
          ctx.lineWidth = 1.6;
          ctx.setLineDash([]);
        } else if (evidence) {
          ctx.strokeStyle = "rgba(79, 216, 196, 0.55)";
          ctx.lineWidth = 1.4;
          ctx.setLineDash([]);
        } else {
          ctx.strokeStyle = "rgba(140, 150, 170, 0.22)";
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 4]);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Nodes.
      for (const n of arr) {
        const p = toScreen(n.x, n.y);
        if (p.x < -40 || p.x > w + 40 || p.y < -40 || p.y > h + 40) continue;
        const size = n.category === "primary_entity" ? 9 : n.category === "note" ? 7 : 5;
        const color = COLORS[n.category];
        const selected = selectedRef.current === n.id;

        ctx.beginPath();
        if (n.category === "primary_entity") {
          ctx.moveTo(p.x, p.y - size);
          ctx.lineTo(p.x + size, p.y);
          ctx.lineTo(p.x, p.y + size);
          ctx.lineTo(p.x - size, p.y);
          ctx.closePath();
        } else if (n.category === "note") {
          ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
        } else {
          ctx.rect(p.x - size, p.y - size, size * 2, size * 2);
        }
        ctx.fillStyle = color;
        ctx.globalAlpha = n.category === "source_chunk" ? 0.75 : 1;
        ctx.fill();
        ctx.globalAlpha = 1;
        if (selected) {
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        if (n.category !== "source_chunk" || cam.zoom > 0.8) {
          ctx.font = "10px 'IBM Plex Mono', monospace";
          ctx.fillStyle = selected ? "#ffffff" : "rgba(220, 226, 240, 0.75)";
          ctx.textAlign = "center";
          const labelText = n.title.length > 28 ? `${n.title.slice(0, 28)}…` : n.title;
          ctx.fillText(labelText, p.x, p.y + size + 12);
        }
      }

      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [tick]);

  // Interaction: click selects, drag pans or moves a node, wheel zooms.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const toWorld = (sx: number, sy: number) => {
      const cam = cameraRef.current;
      const rect = canvas.getBoundingClientRect();
      return {
        x: (sx - rect.left - rect.width / 2) / cam.zoom + cam.x,
        y: (sy - rect.top - rect.height / 2) / cam.zoom + cam.y,
      };
    };
    const hit = (sx: number, sy: number): string | null => {
      const w = toWorld(sx, sy);
      let best: string | null = null;
      let bestD = 14 / cameraRef.current.zoom;
      for (const n of simRef.current.values()) {
        const d = Math.hypot(n.x - w.x, n.y - w.y);
        if (d < bestD) {
          bestD = d;
          best = n.id;
        }
      }
      return best;
    };

    const onDown = (e: PointerEvent) => {
      const id = hit(e.clientX, e.clientY);
      dragRef.current = { id, panning: !id, sx: e.clientX, sy: e.clientY };
      if (id) onSelect(id);
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      const cam = cameraRef.current;
      if (drag.id) {
        const w = toWorld(e.clientX, e.clientY);
        const n = simRef.current.get(drag.id);
        if (n) {
          n.x = w.x;
          n.y = w.y;
          n.vx = 0;
          n.vy = 0;
        }
      } else if (drag.panning) {
        cam.x -= (e.clientX - drag.sx) / cam.zoom;
        cam.y -= (e.clientY - drag.sy) / cam.zoom;
        cam.userControlled = true;
        drag.sx = e.clientX;
        drag.sy = e.clientY;
      }
    };
    const onUp = () => {
      dragRef.current = { id: null, panning: false, sx: 0, sy: 0 };
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const cam = cameraRef.current;
      cam.zoom = Math.min(4, Math.max(0.15, cam.zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
      cam.userControlled = true;
    };
    const onDbl = () => {
      cameraRef.current.userControlled = false; // recenter
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("dblclick", onDbl);
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("dblclick", onDbl);
    };
  }, [onSelect]);

  return <canvas ref={canvasRef} className="h-full w-full cursor-grab active:cursor-grabbing" />;
}
