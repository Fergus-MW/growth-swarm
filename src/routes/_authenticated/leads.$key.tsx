import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, ExternalLink, Loader2, Star, User, Quote, Lightbulb, Network } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { getLead, updateLead } from "@/lib/leads.functions";
import { STAGES } from "@/lib/lead-stages";

export const Route = createFileRoute("/_authenticated/leads/$key")({
  head: () => ({
    meta: [
      { title: "Lead details — Auto Research" },
      { name: "description", content: "Everything the research swarm found on this company: verdict, people, signals and sources." },
      { property: "og:title", content: "Lead details — Auto Research" },
      { property: "og:description", content: "Everything the research swarm found on this company." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LeadPage,
});

function LeadPage() {
  const { key } = Route.useParams();
  const fetchLead = useServerFn(getLead);
  const save = useServerFn(updateLead);
  const qc = useQueryClient();
  const { data: lead, isLoading } = useQuery({ queryKey: ["lead", key], queryFn: () => fetchLead({ data: { key } }) });
  const [notes, setNotes] = useState("");
  useEffect(() => setNotes(lead?.crm?.notes ?? ""), [lead?.crm?.notes]);

  async function patch(p: { stage?: string; starred?: boolean; notes?: string }) {
    await save({ data: { key, ...p } });
    qc.invalidateQueries({ queryKey: ["lead", key] });
    qc.invalidateQueries({ queryKey: ["leads"] });
  }

  if (isLoading) return <div className="flex min-h-screen items-center justify-center bg-background"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  if (!lead) return (
    <div className="min-h-screen bg-background"><AppHeader /><div className="p-12 text-center text-muted-foreground">Lead not found. <Link to="/leads" className="text-primary underline">Back to leads</Link></div></div>
  );

  const primary = lead.records[0] as any;
  const fields: any = Object.assign({}, ...lead.records.map((r: any) => r.fields ?? {}));
  const people = lead.links.filter((l: any) => l.node.category === "primary_entity" && l.node.entity_type === "person");
  const signals = lead.links.filter((l: any) => l.node.category === "note" && l.node.semantic_kind === "demand_signal");
  const notesFound = lead.links.filter((l: any) => l.node.category === "note" && l.node.semantic_kind !== "demand_signal");
  const sources = lead.links.filter((l: any) => l.node.category === "source_chunk");
  const writeup = lead.records.map((r: any) => r.free_text).filter(Boolean).join("\n\n---\n\n");
  const stage = lead.crm?.stage ?? "new";
  const starred = lead.crm?.starred ?? false;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Link to="/leads" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"><ArrowLeft className="h-3 w-3" /> All leads</Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold">{primary.title}</h1>
              <span className="rounded border border-primary/50 px-2 py-0.5 font-data text-[11px] uppercase text-primary">{fields.status ?? "candidate"}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-3 font-data text-xs text-muted-foreground">
              {fields.website && <a href={fields.website.startsWith("http") ? fields.website : `https://${fields.website}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-primary">{fields.website} <ExternalLink className="h-3 w-3" /></a>}
              {fields.location && <span>{fields.location}</span>}
              {fields.size && <span>{fields.size}</span>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => patch({ starred: !starred })} className={`rounded-md border px-3 py-2 ${starred ? "border-chunk text-chunk" : "border-border text-muted-foreground"}`} aria-label="Star"><Star className={`h-4 w-4 ${starred ? "fill-chunk" : ""}`} /></button>
            <select value={stage} onChange={(e) => patch({ stage: e.target.value })} className="rounded-md border border-input bg-card px-3 py-2 text-sm">
              {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Section title="Swarm write-up" icon={<Lightbulb className="h-4 w-4" />}>
              {writeup ? <div className="whitespace-pre-wrap text-sm leading-relaxed">{writeup}</div> : <Empty>No write-up yet — this company hasn't been qualified.</Empty>}
            </Section>

            <Section title={`Claims (${lead.assertions.length})`} icon={<Quote className="h-4 w-4" />}>
              {lead.assertions.length === 0 ? <Empty>No verified claims yet.</Empty> : (
                <ul className="space-y-2">
                  {lead.assertions.map((a: any) => (
                    <li key={a.id} className="rounded-md border border-border bg-background p-3 text-sm">
                      <div className="flex justify-between gap-3"><span>{a.claim}</span><Conf v={a.confidence} /></div>
                      {Array.isArray(a.evidence) && a.evidence.slice(0, 2).map((e: any, i: number) => e?.quote && <blockquote key={i} className="mt-2 border-l-2 border-chunk pl-2 text-xs italic text-muted-foreground">“{e.quote}”</blockquote>)}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title={`Buying signals (${signals.length})`} icon={<Network className="h-4 w-4" />}>
              {signals.length === 0 ? <Empty>No demand signals captured.</Empty> : signals.map((s: any, i: number) => <NoteCard key={i} l={s} />)}
            </Section>

            {notesFound.length > 0 && (
              <Section title={`Other findings (${notesFound.length})`}>{notesFound.map((s: any, i: number) => <NoteCard key={i} l={s} />)}</Section>
            )}

            <Section title={`Sources (${sources.length})`}>
              {sources.length === 0 ? <Empty>No sources linked.</Empty> : (
                <ul className="space-y-2">
                  {sources.map((s: any, i: number) => (
                    <li key={i} className="rounded-md border border-border bg-background p-3 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <a href={s.node.locator ?? "#"} target="_blank" rel="noreferrer" className="truncate font-semibold text-chunk hover:underline">{s.node.title}</a>
                        <span className={`font-data uppercase ${s.polarity === "contradicts" ? "text-destructive" : "text-muted-foreground"}`}>{s.relation}{s.polarity ? ` · ${s.polarity}` : ""}</span>
                      </div>
                      {s.rationale && <p className="mt-1 text-muted-foreground">{s.rationale}</p>}
                      {s.node.content && <p className="mt-1 line-clamp-3 text-muted-foreground/80">{s.node.content}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>

          <div className="space-y-6">
            <Section title={`People (${people.length})`} icon={<User className="h-4 w-4" />}>
              {people.length === 0 ? <Empty>No contacts found yet.</Empty> : people.map((p: any, i: number) => (
                <div key={i} className="mb-2 rounded-md border border-border bg-background p-3">
                  <div className="font-semibold">{p.node.title}</div>
                  <div className="text-xs text-muted-foreground">{p.node.fields?.role ?? "—"}{p.node.fields?.founder_or_ceo ? " · Founder/CEO" : ""}</div>
                  {p.relation === "best_contact_for" && <div className="mt-1 font-data text-[10px] uppercase text-primary">Best contact</div>}
                </div>
              ))}
            </Section>

            <Section title="Your notes">
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={6} placeholder="Outreach plan, call notes…" className="w-full rounded-md border border-input bg-background p-2 text-sm outline-none focus:border-primary" />
              <button onClick={async () => { await patch({ notes }); toast.success("Notes saved"); }} className="mt-2 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">Save notes</button>
            </Section>

            <Section title="Found in searches">
              {lead.runs.map((r: any) => (
                <div key={r.id} className="mb-2 text-sm">
                  <Link to="/runs/$runId" params={{ runId: r.id }} className="hover:text-primary">{r.objective}</Link>
                  <div className="flex gap-3 font-data text-[11px] text-muted-foreground">
                    <span>{r.outcome ?? r.status}</span>
                    <Link to="/swarm/$runId" params={{ runId: r.id }} className="text-primary hover:underline">watch swarm</Link>
                  </div>
                </div>
              ))}
            </Section>
          </div>
        </div>
      </main>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 flex items-center gap-2 font-data text-xs uppercase tracking-widest text-muted-foreground">{icon}{title}</h2>
      {children}
    </section>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}
function Conf({ v }: { v: string }) {
  const c = v === "high" ? "text-primary" : v === "low" ? "text-destructive" : "text-chunk";
  return <span className={`shrink-0 font-data text-[10px] uppercase ${c}`}>{v}</span>;
}
function NoteCard({ l }: { l: any }) {
  return (
    <div className="mb-2 rounded-md border border-border bg-background p-3 text-sm">
      <div className="flex justify-between gap-2"><span className="font-semibold">{l.node.title}</span>{l.node.confidence && <Conf v={l.node.confidence} />}</div>
      {(l.node.content || l.node.free_text) && <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{l.node.content ?? l.node.free_text}</p>}
    </div>
  );
}
