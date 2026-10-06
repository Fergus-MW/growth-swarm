import { CrmHandoff } from "@/components/CrmHandoff";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Pause, Play, RotateCcw } from "lucide-react";
import { getRun } from "@/lib/runs.functions";
import { getRunEvents } from "@/lib/leads.functions";

export const Route = createFileRoute("/_authenticated/swarm/$runId")({
  head: () => ({
    meta: [
      { title: "Swarm view — Auto Research" },
      { name: "description", content: "Watch the research agents fan out across the search and fill in the map live." },
      { property: "og:title", content: "Swarm view — Auto Research" },
      { property: "og:description", content: "Watch the research agents fan out across the search live." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SwarmPage,
});

type Ev = { id: number; kind: string; agent_index: number | null; payload: any; created_at: string };

const ZONES = [
  { kind: "decompose", label: "Framing the brief" },
  { kind: "discovery", label: "Discovering companies" },
  { kind: "qualify", label: "Qualifying fit" },
  { kind: "signals", label: "Buying signals" },
  { kind: "contacts", label: "Finding people" },
  { kind: "gap", label: "Filling gaps" },
];

function cssVar(name: string) {
  if (typeof window === "undefined") return "#888";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
}

function SwarmPage() {
  const { runId } = Route.useParams();
  const { user } = Route.useRouteContext();
  const fetchRun = useServerFn(getRun);
  const fetchEvents = useServerFn(getRunEvents);
  const { data: runData } = useQuery({ queryKey: ["run-lite", runId], queryFn: () => fetchRun({ data: { id: runId } }), refetchInterval: 8000 });
  const run = runData?.run;
  const live = run?.status === "running" || run?.status === "stopping";

  const eventsRef = useRef<Ev[]>([]);
  const lastIdRef = useRef(0);
  const [eventCount, setEventCount] = useState(0);
  const cursorRef = useRef(0);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(4);
  const playingRef = useRef(playing); playingRef.current = playing;
  const speedRef = useRef(speed); speedRef.current = speed;
  const [log, setLog] = useState<string[]>([]);
  const [counts, setCounts] = useState({ companies: 0, notes: 0, sources: 0, searches: 0 });

  // Poll new events (all on first load, then incremental).
  useEffect(() => {
    let stop = false;
    async function tick() {
      try {
        const rows = (await fetchEvents({ data: { id: runId, after: lastIdRef.current } })) as Ev[];
        if (rows.length) {
          eventsRef.current.push(...rows);
          lastIdRef.current = rows[rows.length - 1]!.id;
          setEventCount(eventsRef.current.length);
        }
      } catch { /* retry next tick */ }
      if (!stop) setTimeout(tick, rows_more() ? 300 : 3000);
    }
    const rows_more = () => false;
    tick();
    return () => { stop = true; };
  }, [runId, fetchEvents]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<any>(null);

  function resetScene() {
    sceneRef.current = { agents: new Map(), dots: [], ripples: [], pulse: 0, zoneHeat: {} as Record<string, number> };
    cursorRef.current = 0; setCursor(0); setLog([]); setCounts({ companies: 0, notes: 0, sources: 0, searches: 0 });
  }
  if (!sceneRef.current) sceneRef.current = { agents: new Map(), dots: [], ripples: [], pulse: 0, zoneHeat: {} };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const colors = { primary: cssVar("--primary"), note: cssVar("--note"), chunk: cssVar("--chunk"), muted: cssVar("--muted-foreground"), border: cssVar("--border"), fg: cssVar("--foreground"), danger: cssVar("--destructive") };
    let raf = 0;
    let acc = 0;
    let last = performance.now();
    const size = run?.swarm_size ?? 20;

    function geometry() {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.32;
      const zones = ZONES.map((z, i) => {
        const a = -Math.PI / 2 + (i / ZONES.length) * Math.PI * 2;
        return { ...z, x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R, a };
      });
      return { w, h, cx, cy, R, zones };
    }
    function agent(i: number) {
      const s = sceneRef.current;
      if (!s.agents.has(i)) {
        const g = geometry();
        const a = (i / size) * Math.PI * 2;
        s.agents.set(i, { x: g.cx + Math.cos(a) * 30, y: g.cy + Math.sin(a) * 30, tx: null, zone: null, phase: Math.random() * 6 });
      }
      return s.agents.get(i);
    }
    function apply(e: Ev) {
      const s = sceneRef.current;
      const g = geometry();
      const ai = e.agent_index ?? -1;
      const push = (t: string) => setLog((l) => [t, ...l].slice(0, 40));
      if (e.kind === "task_started" && ai >= 0) {
        const a = agent(ai); a.zone = e.payload?.kind ?? null;
        s.zoneHeat[a.zone] = (s.zoneHeat[a.zone] ?? 0) + 1;
        push(`agent ${ai} → ${ZONES.find((z) => z.kind === a.zone)?.label ?? a.zone}`);
      } else if (e.kind === "task_done" && ai >= 0) {
        const a = agent(ai); if (a.zone) s.zoneHeat[a.zone] = Math.max(0, (s.zoneHeat[a.zone] ?? 1) - 1); a.zone = null;
      } else if (e.kind === "search") {
        const a = ai >= 0 ? agent(ai) : { x: g.cx, y: g.cy };
        s.ripples.push({ x: a.x, y: a.y, r: 2, life: 1, color: e.payload?.status === "succeeded" ? colors.chunk : colors.danger });
        setCounts((c) => ({ ...c, searches: c.searches + 1 }));
        if (e.payload?.query) push(`search: “${String(e.payload.query).slice(0, 60)}”`);
      } else if (e.kind === "node_created") {
        const a = ai >= 0 ? agent(ai) : { x: g.cx, y: g.cy };
        const cat = e.payload?.category;
        const ang = Math.random() * Math.PI * 2;
        const ring = cat === "primary_entity" ? g.R * 1.45 : cat === "note" ? g.R * 1.3 : g.R * 1.18 + Math.random() * g.R * 0.35;
        s.dots.push({ x: a.x, y: a.y, tx: g.cx + Math.cos(ang) * ring, ty: g.cy + Math.sin(ang) * ring * 0.85, cat, title: e.payload?.title, born: 1 });
        setCounts((c) => ({ ...c, companies: c.companies + (cat === "primary_entity" ? 1 : 0), notes: c.notes + (cat === "note" ? 1 : 0), sources: c.sources + (cat === "source_chunk" ? 1 : 0) }));
        if (cat === "primary_entity") push(`★ found ${e.payload?.title}`);
      } else if (e.kind === "epoch_opened" || e.kind === "epoch_closed") {
        s.pulse = 1; push(e.kind === "epoch_opened" ? "swarm voting on completeness…" : `vote: ${e.payload?.yes}/${e.payload?.total} yes`);
      } else if (e.kind === "run_finished") {
        s.pulse = 1.5; push(`finished: ${e.payload?.outcome}`);
      }
    }

    function frame(now: number) {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== canvas.clientWidth * dpr) { canvas.width = canvas.clientWidth * dpr; canvas.height = canvas.clientHeight * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const g = geometry();
      const s = sceneRef.current;

      // Advance playback.
      if (playingRef.current) {
        acc += dt * speedRef.current * 3;
        const evs = eventsRef.current;
        while (acc >= 1 && cursorRef.current < evs.length) { apply(evs[cursorRef.current++]!); acc -= 1; }
        if (cursorRef.current >= evs.length) acc = 0;
        setCursor(cursorRef.current);
      }

      ctx.clearRect(0, 0, g.w, g.h);
      // Core
      s.pulse = Math.max(0, s.pulse - dt * 0.6);
      ctx.beginPath(); ctx.arc(g.cx, g.cy, 26 + s.pulse * 40, 0, Math.PI * 2);
      ctx.strokeStyle = colors.primary; ctx.globalAlpha = 0.25 + s.pulse * 0.5; ctx.lineWidth = 1.5; ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillStyle = colors.muted; ctx.font = "10px IBM Plex Mono, monospace"; ctx.textAlign = "center";
      ctx.fillText("SWARM", g.cx, g.cy + 3);

      // Zones
      for (const z of g.zones) {
        const heat = Math.min(1, (s.zoneHeat[z.kind] ?? 0) / 4);
        ctx.beginPath(); ctx.moveTo(g.cx, g.cy); ctx.lineTo(z.x, z.y);
        ctx.strokeStyle = colors.border; ctx.globalAlpha = 0.5; ctx.lineWidth = 1; ctx.setLineDash([3, 5]); ctx.stroke(); ctx.setLineDash([]);
        const grd = ctx.createRadialGradient(z.x, z.y, 0, z.x, z.y, 70);
        grd.addColorStop(0, colors.primary); grd.addColorStop(1, "transparent");
        ctx.globalAlpha = 0.05 + heat * 0.3; ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(z.x, z.y, 70, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(z.x, z.y, 34, 0, Math.PI * 2); ctx.strokeStyle = heat > 0 ? colors.primary : colors.border; ctx.stroke();
        ctx.fillStyle = heat > 0 ? colors.fg : colors.muted; ctx.font = "11px Space Grotesk, sans-serif";
        ctx.fillText(z.label, z.x, z.y + 50);
      }

      // Knowledge dots drifting to outer rings.
      for (const d of s.dots) {
        d.x += (d.tx - d.x) * dt * 1.5; d.y += (d.ty - d.y) * dt * 1.5; d.born = Math.max(0, d.born - dt);
        const c = d.cat === "primary_entity" ? colors.primary : d.cat === "note" ? colors.note : colors.chunk;
        const r = d.cat === "primary_entity" ? 4 : d.cat === "note" ? 2.5 : 1.6;
        ctx.fillStyle = c; ctx.globalAlpha = d.cat === "source_chunk" ? 0.55 : 0.95;
        ctx.beginPath(); ctx.arc(d.x, d.y, r + d.born * 5, 0, Math.PI * 2); ctx.fill();
        if (d.cat === "primary_entity" && d.born < 0.05) { ctx.globalAlpha = 0.7; ctx.font = "9px IBM Plex Mono, monospace"; ctx.fillText(String(d.title ?? "").slice(0, 22), d.x, d.y - 8); }
      }
      ctx.globalAlpha = 1;

      // Ripples
      s.ripples = s.ripples.filter((r: any) => r.life > 0);
      for (const r of s.ripples) { r.r += dt * 60; r.life -= dt * 1.2; ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); ctx.strokeStyle = r.color; ctx.globalAlpha = Math.max(0, r.life); ctx.stroke(); }
      ctx.globalAlpha = 1;

      // Agents
      for (const [i, a] of s.agents) {
        const z = g.zones.find((zz) => zz.kind === a.zone);
        a.phase += dt * 2;
        const tx = z ? z.x + Math.cos(a.phase + i) * 22 : g.cx + Math.cos(a.phase * 0.3 + i) * 50;
        const ty = z ? z.y + Math.sin(a.phase + i) * 22 : g.cy + Math.sin(a.phase * 0.3 + i) * 50;
        a.x += (tx - a.x) * dt * 3; a.y += (ty - a.y) * dt * 3;
        ctx.fillStyle = z ? colors.primary : colors.muted;
        ctx.shadowColor = colors.primary; ctx.shadowBlur = z ? 10 : 0;
        ctx.beginPath(); ctx.arc(a.x, a.y, 3, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [run?.swarm_size]);

  const progress = eventCount ? Math.round((cursor / eventCount) * 100) : 0;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <Link to="/runs/$runId" params={{ runId }} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"><ArrowLeft className="h-3.5 w-3.5" /> Search</Link>
          <span className="truncate text-sm font-semibold">{run?.objective ?? "…"}</span>
          {live && <span className="font-data text-xs text-primary"><span className="animate-pulse-dot mr-1 inline-block h-1.5 w-1.5 rounded-full bg-primary align-middle" />LIVE</span>}
        </div>
        <div className="flex items-center gap-2 font-data text-xs">
          <button onClick={() => setPlaying((p) => !p)} className="rounded-md border border-border p-1.5 hover:border-primary" aria-label={playing ? "Pause" : "Play"}>{playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}</button>
          <button onClick={resetScene} className="rounded-md border border-border p-1.5 hover:border-primary" aria-label="Replay"><RotateCcw className="h-3.5 w-3.5" /></button>
          {[1, 4, 12, 40].map((s) => (
            <button key={s} onClick={() => setSpeed(s)} className={`rounded px-2 py-1 ${speed === s ? "bg-secondary text-primary" : "text-muted-foreground"}`}>{s}×</button>
          ))}
        </div>
      </header>
      {run && <CrmHandoff runId={runId} userId={user.id} status={run.status} outcome={run.outcome} />}
      <div className="flex min-h-0 flex-1">
        <div className="relative flex-1">
          <canvas ref={canvasRef} className="h-full w-full" />
          <div className="absolute left-4 top-4 flex gap-5 font-data text-[11px] text-muted-foreground">
            <Stat label="COMPANIES" v={counts.companies} cls="text-primary" />
            <Stat label="FINDINGS" v={counts.notes} cls="text-note" />
            <Stat label="SOURCES" v={counts.sources} cls="text-chunk" />
            <Stat label="SEARCHES" v={counts.searches} cls="text-foreground" />
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-secondary"><div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} /></div>
          {eventCount === 0 && <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">Waiting for the swarm to start…</div>}
        </div>
        <aside className="hidden w-72 flex-col border-l border-border md:flex">
          <div className="px-3 py-2 font-data text-[10px] tracking-widest text-muted-foreground">ACTIVITY</div>
          <div className="flex-1 space-y-1 overflow-y-auto px-3 pb-3 font-data text-[11px]">
            {log.map((l, i) => <div key={i} className={l.startsWith("★") ? "text-primary" : "text-muted-foreground"} style={{ opacity: Math.max(0.3, 1 - i * 0.03) }}>{l}</div>)}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, v, cls }: { label: string; v: number; cls: string }) {
  return <div><div className={`text-xl ${cls}`}>{v}</div>{label}</div>;
}
