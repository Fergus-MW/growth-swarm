import { z } from "zod";
import { callModelJson } from "./ai.server";
import { webSearch, webSearchAvailable } from "./connectors.server";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;

export type RunRow = {
  id: string;
  user_id: string;
  parent_run_id: string | null;
  profile: string;
  objective: string;
  pain: string | null;
  universe: string | null;
  exclusions: string | null;
  completion_criteria: string;
  swarm_size: number;
  threshold: number;
  time_limit_sec: number;
  cost_cap: number;
  connectors: string[];
  status: string;
  outcome: string | null;
  stop_requested: boolean;
  graph_revision: number;
  assessment_version: number;
  epoch: number;
  spend: number;
  stats: Record<string, any>;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
};

const MODEL_CALL_COST = 0.004;
const SEARCH_CALL_COST = 0.008;
const MAX_ATTEMPTS = 3;
const MAX_OUTBOUND_PER_TASK = 40;
const WINDOW_MS = 75_000;
const CONCURRENCY = 4;
const EVAL_EVERY_TASKS = 6;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

async function emit(db: Db, runId: string, kind: string, agentIndex: number | null, payload: Record<string, any>) {
  await db.from("events").insert({ run_id: runId, kind, agent_index: agentIndex, payload });
}

async function bumpRevision(db: Db, run: RunRow): Promise<number> {
  const next = (run.graph_revision ?? 0) + 1;
  run.graph_revision = next;
  await db.from("runs").update({ graph_revision: next }).eq("id", run.id);
  return next;
}

async function charge(db: Db, run: RunRow, amount: number) {
  run.spend = Number(run.spend ?? 0) + amount;
  await db.from("runs").update({ spend: run.spend }).eq("id", run.id);
}

function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 180);
}

async function insertTask(
  db: Db,
  runId: string,
  kind: string,
  payload: Record<string, any>,
  priority: number,
  dedupeKey?: string,
  reservedFor?: number,
) {
  const row: Record<string, any> = { run_id: runId, kind, payload, priority };
  if (dedupeKey) row["dedupe_key"] = dedupeKey;
  if (reservedFor != null) row["reserved_for_agent"] = reservedFor;
  const { error } = await db.from("tasks").insert(row);
  if (error && !String(error.message).includes("duplicate")) {
    console.error("insertTask", kind, error.message);
  }
}

async function createNode(db: Db, run: RunRow, node: Record<string, any>, agentIndex: number | null) {
  const { data, error } = await db
    .from("nodes")
    .insert({ run_id: run.id, ...node, created_by_agent: agentIndex })
    .select("id")
    .single();
  if (error) {
    console.error("createNode", error.message);
    return null;
  }
  await bumpRevision(db, run);
  await emit(db, run.id, "node_created", agentIndex, {
    nodeId: data.id,
    category: node["category"],
    title: node["title"],
  });
  return data.id as string;
}

async function createEdge(
  db: Db,
  run: RunRow,
  relation: string,
  fromNode: string,
  toNode: string,
  extra: Record<string, any> = {},
) {
  // Deterministic dedupe: same relation + endpoints + assertion = one edge.
  const { data: existing } = await db
    .from("edges")
    .select("id")
    .eq("run_id", run.id)
    .eq("relation", relation)
    .eq("from_node", fromNode)
    .eq("to_node", toNode)
    .limit(1);
  if (existing && existing.length > 0) return existing[0].id as string;
  const { data, error } = await db
    .from("edges")
    .insert({ run_id: run.id, relation, from_node: fromNode, to_node: toNode, ...extra })
    .select("id")
    .single();
  if (error) {
    console.error("createEdge", error.message);
    return null;
  }
  await bumpRevision(db, run);
  return data.id as string;
}

// ---------------------------------------------------------------------------
// Capture contract: store the full response as chunks BEFORE any model reads
// ---------------------------------------------------------------------------

async function captureSearch(
  db: Db,
  run: RunRow,
  taskId: string,
  agentIndex: number,
  query: string,
  retrievalTargetId?: string,
): Promise<{ chunks: Array<{ id: string; title: string; content: string; url: string }>; status: string }> {
  const { data: invocation } = await db
    .from("invocations")
    .insert({
      run_id: run.id,
      task_id: taskId,
      agent_index: agentIndex,
      connector: "web_search",
      provider: "tavily",
      operation: "search",
      query,
      status: "pending",
    })
    .select("id")
    .single();

  const outcome = await webSearch(query);
  await charge(db, run, SEARCH_CALL_COST);

  if (!outcome.ok) {
    await db
      .from("invocations")
      .update({ status: outcome.status === "empty" ? "empty" : "failed", error: outcome.error, finished_at: new Date().toISOString() })
      .eq("id", invocation.id);
    await emit(db, run.id, "search", agentIndex, { query, status: outcome.status, error: outcome.error });
    return { chunks: [], status: outcome.status };
  }

  const chunks: Array<{ id: string; title: string; content: string; url: string }> = [];
  for (const item of outcome.items) {
    const id = await createNode(
      db,
      run,
      {
        category: "source_chunk",
        title: item.title,
        content: item.content,
        locator: item.url,
        provider: "tavily",
        connector: "web_search",
        is_snippet: true,
        published_at: item.publishedDate ?? null,
        fetched_at: new Date().toISOString(),
        invocation_id: invocation.id,
        provenance: "research",
      },
      agentIndex,
    );
    if (id) {
      chunks.push({ id, title: item.title, content: item.content, url: item.url });
      if (retrievalTargetId) {
        await createEdge(db, run, "retrieved_for", id, retrievalTargetId, { rationale: `Query: ${query}` });
      }
    }
  }

  await db
    .from("invocations")
    .update({ status: "succeeded", item_count: chunks.length, finished_at: new Date().toISOString() })
    .eq("id", invocation.id);
  await emit(db, run.id, "search", agentIndex, { query, status: "succeeded", results: chunks.length });
  return { chunks, status: "succeeded" };
}

// ---------------------------------------------------------------------------
// Model schemas per task kind
// ---------------------------------------------------------------------------

const decomposeSchema = z.object({
  pain_summary: z.string(),
  symptoms: z.array(z.string()),
  segments: z.array(z.object({ name: z.string(), rationale: z.string() })),
  discovery_queries: z.array(z.string()),
  assumptions: z.array(z.string()),
});

const discoverySchema = z.object({
  companies: z.array(
    z.object({
      name: z.string(),
      website: z.string().nullable(),
      location: z.string().nullable(),
      size: z.string().nullable(),
      why_relevant: z.string(),
      evidence_chunk_index: z.number().nullable(),
      evidence_quote: z.string().nullable(),
    }),
  ),
  more_queries: z.array(z.string()),
  negative_finding: z.string().nullable(),
});

const qualifySchema = z.object({
  verdict: z.enum(["qualified", "unqualified", "uncertain"]),
  rationale: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  free_text: z.string(),
  evidence: z.array(
    z.object({ chunk_index: z.number(), quote: z.string(), polarity: z.enum(["supports", "contradicts", "qualifies"]) }),
  ),
  claims: z.array(z.object({ title: z.string(), body: z.string(), confidence: z.enum(["high", "medium", "low"]) })),
});

const signalsSchema = z.object({
  signals: z.array(
    z.object({
      title: z.string(),
      kind: z.string(),
      interpretation: z.string(),
      event_date: z.string().nullable(),
      date_basis: z.string().nullable(),
      evidence_chunk_index: z.number().nullable(),
      evidence_quote: z.string().nullable(),
    }),
  ),
  negative_finding: z.string().nullable(),
});

const contactsSchema = z.object({
  people: z.array(
    z.object({
      name: z.string(),
      role: z.string(),
      is_founder_or_ceo: z.boolean(),
      current_role_confidence: z.enum(["high", "medium", "low"]),
      contact_rationale: z.string(),
      evidence_chunk_index: z.number().nullable(),
      evidence_quote: z.string().nullable(),
    }),
  ),
  gap: z.string().nullable(),
});

const voteSchema = z.object({
  decision: z.enum(["yes", "no"]),
  rationale: z.string(),
  gap_task: z.string().nullable(),
});

const gapSchema = z.object({
  findings: z.array(z.object({ title: z.string(), body: z.string(), confidence: z.enum(["high", "medium", "low"]) })),
  companies: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// Task executors
// ---------------------------------------------------------------------------

function briefText(run: RunRow): string {
  return [
    `Objective: ${run.objective}`,
    run.pain ? `Pain: ${run.pain}` : null,
    run.universe ? `Universe: ${run.universe}` : null,
    run.exclusions ? `Exclusions: ${run.exclusions}` : null,
    `Completion criteria: ${run.completion_criteria}`,
  ]
    .filter(Boolean)
    .join("\n");
}

const RESEARCH_RULES = `Rules:
- Prefer primary sources. Never invent companies, people, dates, or URLs.
- Every factual claim needs an evidence quote copied verbatim from a provided source chunk (use chunk_index), or it will be rejected.
- If the evidence is not there, say so explicitly (negative_finding / gap). Unknowns stay visible.
- Keep inferred pain distinct from statements the company itself made.
- An acquisition or vacancy is a clue, not proof of budget or buying intent.`;

async function execDecompose(db: Db, run: RunRow, task: any, agent: number) {
  const out = await callModelJson({
    instructions: `You are a go-to-market research lead decomposing a brief into a bounded discovery plan. ${RESEARCH_RULES}`,
    input: `${briefText(run)}\n\nProduce a pain summary with observable symptoms, market segments to cover, and 4-8 concrete web discovery queries.`,
    schema: decomposeSchema,
    schemaName: "decompose",
    effort: "medium",
  });
  await charge(db, run, MODEL_CALL_COST);

  const painNoteId = await createNode(
    db,
    run,
    {
      category: "note",
      editorial_type: "framework",
      semantic_kind: "pain",
      title: `Pain: ${out.pain_summary.slice(0, 80)}`,
      content: `${out.pain_summary}\n\nObservable symptoms:\n${out.symptoms.map((s) => `- ${s}`).join("\n")}\n\nAssumptions:\n${out.assumptions.map((a) => `- ${a}`).join("\n")}`,
      confidence: "medium",
      provenance: "inference",
    },
    agent,
  );

  for (const seg of out.segments) {
    await createNode(
      db,
      run,
      {
        category: "note",
        editorial_type: "framework",
        semantic_kind: "segment",
        title: `Segment: ${seg.name}`,
        content: seg.rationale,
        confidence: "medium",
        provenance: "inference",
      },
      agent,
    );
  }

  for (const q of out.discovery_queries.slice(0, 8)) {
    await insertTask(db, run.id, "discovery", { query: q, painNoteId }, 20, `discovery:${normalizeKey(q)}`);
  }
  return `Decomposed brief into ${out.segments.length} segments and ${out.discovery_queries.length} discovery queries`;
}

async function execDiscovery(db: Db, run: RunRow, task: any, agent: number) {
  const query: string = task.payload.query;
  const painNoteId: string | undefined = task.payload.painNoteId;

  const { chunks, status } = await captureSearch(db, run, task.id, agent, query, painNoteId);
  if (status === "unavailable") {
    return "Web search unavailable — capability gap recorded";
  }

  const chunkList = chunks.map((c, i) => `[${i}] ${c.title} — ${c.url}\n${c.content.slice(0, 700)}`).join("\n\n");
  const out = await callModelJson({
    instructions: `You are a discovery agent finding companies that plausibly hold a stated pain, inside a stated universe. Record candidates even with partial fields. Excluded or irrelevant results stay out of the candidate list. ${RESEARCH_RULES}`,
    input: `${briefText(run)}\n\nSearch query: ${query}\n\nSource chunks:\n${chunkList || "(no results returned)"}\n\nList candidate companies found in these results. If none, say so in negative_finding. Suggest up to 3 follow-up queries that are semantically distinct, not rephrasings.`,
    schema: discoverySchema,
    schemaName: "discovery",
    effort: "low",
  });
  await charge(db, run, MODEL_CALL_COST);

  let created = 0;
  for (const c of out.companies.slice(0, 10)) {
    const { data: dup } = await db
      .from("nodes")
      .select("id")
      .eq("run_id", run.id)
      .eq("category", "primary_entity")
      .ilike("title", c.name)
      .limit(1);
    let companyId: string | null = dup?.[0]?.id ?? null;

    const evidence =
      c.evidence_chunk_index != null && chunks[c.evidence_chunk_index]
        ? [{ chunk_id: chunks[c.evidence_chunk_index]!.id, quote: c.evidence_quote ?? "", polarity: "supports" }]
        : [];

    if (!companyId) {
      companyId = await createNode(
        db,
        run,
        {
          category: "primary_entity",
          entity_type: "company",
          title: c.name,
          fields: { website: c.website, location: c.location, size: c.size, status: "candidate" },
          free_text: c.why_relevant,
          confidence: "low",
          provenance: "research",
        },
        agent,
      );
      created++;
    }
    if (companyId) {
      if (evidence.length > 0) {
        const { data: assertion } = await db
          .from("assertions")
          .insert({
            run_id: run.id,
            owner_node_id: companyId,
            field_key: "existence",
            claim: `${c.name} is a candidate in this universe: ${c.why_relevant}`,
            confidence: "low",
            assessment_version: run.assessment_version,
            evidence,
            created_by_agent: agent,
          })
          .select("id")
          .single();
        await createEdge(db, run, "evidences", evidence[0]!.chunk_id, companyId, {
          assertion_id: assertion?.id,
          polarity: "supports",
        });
      }
      await insertTask(db, run.id, "qualify", { companyId, companyName: c.name, painNoteId }, 30, `qualify:${companyId}`);
    }
  }

  for (const q of out.more_queries.slice(0, 3)) {
    await insertTask(db, run.id, "discovery", { query: q, painNoteId }, 40, `discovery:${normalizeKey(q)}`);
  }
  return `Discovery "${query}": ${created} new companies (${out.companies.length} candidates)${out.negative_finding ? `; negative: ${out.negative_finding}` : ""}`;
}

async function execQualify(db: Db, run: RunRow, task: any, agent: number) {
  const companyId: string = task.payload.companyId;
  const painNoteId: string | undefined = task.payload.painNoteId;

  const { data: company } = await db.from("nodes").select("*").eq("id", companyId).single();
  if (!company) return "Company node missing";

  // Gather evidence: chunks already linked to this company, plus one fresh targeted search.
  const { data: linkedEdges } = await db
    .from("edges")
    .select("from_node")
    .eq("run_id", run.id)
    .eq("to_node", companyId)
    .in("relation", ["evidences", "retrieved_for", "mentions"]);
  const chunkIds = (linkedEdges ?? []).map((e: any) => e.from_node);
  let chunks: Array<{ id: string; title: string; content: string }> = [];
  if (chunkIds.length > 0) {
    const { data } = await db.from("nodes").select("id, title, content").in("id", chunkIds).limit(12);
    chunks = data ?? [];
  }
  if (webSearchAvailable() && task.outbound_calls < MAX_OUTBOUND_PER_TASK) {
    const fresh = await captureSearch(db, run, task.id, agent, `${company.title} ${run.pain ?? run.objective}`, companyId);
    chunks = chunks.concat(fresh.chunks.map((c) => ({ id: c.id, title: c.title, content: c.content })));
  }

  const chunkList = chunks.map((c, i) => `[${i}] ${c.title}\n${(c.content ?? "").slice(0, 700)}`).join("\n\n");
  const out = await callModelJson({
    instructions: `You are a qualification agent. Judge whether the company plausibly holds the stated pain, using only the evidence chunks. A query mentioning the company is not proof. Look for contrary evidence. ${RESEARCH_RULES}`,
    input: `${briefText(run)}\n\nCompany: ${company.title}\nKnown fields: ${JSON.stringify(company.fields)}\nExisting notes: ${company.free_text ?? "(none)"}\n\nEvidence chunks:\n${chunkList || "(no evidence captured yet)"}\n\nReturn a verdict, rationale, updated company free-text (markdown), per-chunk evidence with verbatim quotes and polarity, and atomic claims worth their own note.`,
    schema: qualifySchema,
    schemaName: "qualify",
    effort: "medium",
  });
  await charge(db, run, MODEL_CALL_COST);

  const evidence = out.evidence
    .filter((e) => chunks[e.chunk_index])
    .map((e) => ({ chunk_id: chunks[e.chunk_index]!.id, quote: e.quote, polarity: e.polarity }));

  const { data: assertion } = await db
    .from("assertions")
    .insert({
      run_id: run.id,
      owner_node_id: companyId,
      field_key: "holds_pain",
      claim: out.rationale,
      confidence: out.confidence,
      assessment_version: run.assessment_version,
      evidence,
      created_by_agent: agent,
    })
    .select("id")
    .single();

  for (const e of evidence) {
    await createEdge(db, run, "evidences", e.chunk_id, companyId, {
      assertion_id: assertion?.id,
      polarity: e.polarity,
    });
  }

  await db
    .from("nodes")
    .update({
      free_text: out.free_text,
      confidence: out.confidence,
      fields: { ...company.fields, status: out.verdict },
      revision: (company.revision ?? 1) + 1,
    })
    .eq("id", companyId);
  await bumpRevision(db, run);

  if (out.verdict === "qualified" && painNoteId) {
    await createEdge(db, run, "holds_pain", companyId, painNoteId, {
      assertion_id: assertion?.id,
      rationale: out.rationale,
      score: out.confidence === "high" ? 1 : out.confidence === "medium" ? 0.7 : 0.4,
    });
    await insertTask(db, run.id, "signals", { companyId, companyName: company.title }, 35, `signals:${companyId}:v${run.assessment_version}`);
    await insertTask(db, run.id, "contacts", { companyId, companyName: company.title }, 35, `contacts:${companyId}:v${run.assessment_version}`);
  }

  for (const claim of out.claims.slice(0, 4)) {
    const noteId = await createNode(
      db,
      run,
      {
        category: "note",
        editorial_type: "evidence",
        title: claim.title,
        content: claim.body,
        confidence: claim.confidence,
        provenance: "research",
      },
      agent,
    );
    if (noteId) await createEdge(db, run, "related_to", noteId, companyId, {});
  }

  return `Qualified ${company.title}: ${out.verdict} (${out.confidence})`;
}

async function execSignals(db: Db, run: RunRow, task: any, agent: number) {
  const companyId: string = task.payload.companyId;
  const companyName: string = task.payload.companyName;

  const { chunks, status } = await captureSearch(
    db,
    run,
    task.id,
    agent,
    `${companyName} (hiring OR funding OR acquisition OR "job posting" OR announcement) 2025 2026`,
    companyId,
  );
  if (status === "unavailable") return "Web search unavailable — capability gap recorded";

  const chunkList = chunks.map((c, i) => `[${i}] ${c.title} — ${c.url}\n${c.content.slice(0, 700)}`).join("\n\n");
  const out = await callModelJson({
    instructions: `You are a demand-signal agent. Find dated signals that the company feels the pain now: hiring, acquisitions/funding, leadership changes, statements of the problem, regulatory deadlines, migrations/RFPs, peer adoption, public complaints. Never invent a date for an undated snippet — keep event_date null and name the date basis. ${RESEARCH_RULES}`,
    input: `${briefText(run)}\n\nCompany: ${companyName}\n\nSource chunks:\n${chunkList || "(no results)"}\n\nReturn dated signal interpretations with evidence. If nothing, say so in negative_finding.`,
    schema: signalsSchema,
    schemaName: "signals",
    effort: "low",
  });
  await charge(db, run, MODEL_CALL_COST);

  let count = 0;
  for (const s of out.signals.slice(0, 6)) {
    const chunk = s.evidence_chunk_index != null ? chunks[s.evidence_chunk_index]! : null;
    const noteId = await createNode(
      db,
      run,
      {
        category: "note",
        editorial_type: "evidence",
        semantic_kind: "demand_signal",
        title: s.title,
        content: `${s.interpretation}\n\nSignal kind: ${s.kind}\nDate basis: ${s.date_basis ?? "unknown"}`,
        confidence: s.event_date ? "medium" : "low",
        provenance: "research",
        event_at: s.event_date ?? null,
      },
      agent,
    );
    if (!noteId) continue;
    count++;
    if (chunk) {
      const { data: assertion } = await db
        .from("assertions")
        .insert({
          run_id: run.id,
          owner_node_id: noteId,
          field_key: "signal",
          claim: s.interpretation,
          confidence: "medium",
          assessment_version: run.assessment_version,
          evidence: [{ chunk_id: chunk.id, quote: s.evidence_quote ?? "", polarity: "supports" }],
          created_by_agent: agent,
        })
        .select("id")
        .single();
      await createEdge(db, run, "evidences", chunk.id, noteId, { assertion_id: assertion?.id, polarity: "supports" });
    }
    await createEdge(db, run, "exhibits", companyId, noteId, { rationale: s.interpretation });
  }
  return `Signals for ${companyName}: ${count} dated notes${out.negative_finding ? `; negative: ${out.negative_finding}` : ""}`;
}

async function execContacts(db: Db, run: RunRow, task: any, agent: number) {
  const companyId: string = task.payload.companyId;
  const companyName: string = task.payload.companyName;

  const { chunks, status } = await captureSearch(
    db,
    run,
    task.id,
    agent,
    `${companyName} founder OR CEO OR "head of" OR director leadership team`,
    companyId,
  );
  if (status === "unavailable") return "Web search unavailable — capability gap recorded";

  const chunkList = chunks.map((c, i) => `[${i}] ${c.title} — ${c.url}\n${c.content.slice(0, 700)}`).join("\n\n");
  const out = await callModelJson({
    instructions: `You are a contacts agent. Identify the founder or current CEO, and the person closest to the stated pain (process owner / budget holder). A same-name match must be constrained by company evidence. Historical or negated employment does not count as current. If a name cannot be confirmed, record the gap — never invent a person. ${RESEARCH_RULES}`,
    input: `${briefText(run)}\n\nCompany: ${companyName}\n\nSource chunks:\n${chunkList || "(no results)"}\n\nReturn confirmed people with role evidence and a pain-specific contact rationale.`,
    schema: contactsSchema,
    schemaName: "contacts",
    effort: "low",
  });
  await charge(db, run, MODEL_CALL_COST);

  let count = 0;
  for (const p of out.people.slice(0, 4)) {
    const chunk = p.evidence_chunk_index != null ? chunks[p.evidence_chunk_index]! : null;
    if (!chunk) continue; // no evidence, no person — the swarm does not invent people
    const personId = await createNode(
      db,
      run,
      {
        category: "primary_entity",
        entity_type: "person",
        title: p.name,
        fields: { role: p.role, founder_or_ceo: p.is_founder_or_ceo },
        free_text: p.contact_rationale,
        confidence: p.current_role_confidence,
        provenance: "research",
      },
      agent,
    );
    if (!personId) continue;
    count++;
    const { data: assertion } = await db
      .from("assertions")
      .insert({
        run_id: run.id,
        owner_node_id: personId,
        field_key: "employment",
        claim: `${p.name} — ${p.role} at ${companyName}`,
        confidence: p.current_role_confidence,
        assessment_version: run.assessment_version,
        evidence: [{ chunk_id: chunk.id, quote: p.evidence_quote ?? "", polarity: "supports" }],
        created_by_agent: agent,
      })
      .select("id")
      .single();
    await createEdge(db, run, "evidences", chunk.id, personId, { assertion_id: assertion?.id, polarity: "supports" });
    await createEdge(db, run, "works_at", personId, companyId, { rationale: p.role });
    if (task.payload.painNoteId) {
      await createEdge(db, run, "best_contact_for", personId, task.payload.painNoteId, {
        rationale: p.contact_rationale,
      });
    }
  }
  return `Contacts for ${companyName}: ${count} confirmed people${out.gap ? `; gap: ${out.gap}` : ""}`;
}

async function execGap(db: Db, run: RunRow, task: any, agent: number) {
  const gap: string = task.payload.gap ?? "unspecified gap";
  const { chunks } = await captureSearch(db, run, task.id, agent, gap);
  const chunkList = chunks.map((c, i) => `[${i}] ${c.title}\n${c.content.slice(0, 600)}`).join("\n\n");
  const out = await callModelJson({
    instructions: `You are an integrity agent repairing a specific research gap. ${RESEARCH_RULES}`,
    input: `${briefText(run)}\n\nGap to repair: ${gap}\n\nSource chunks:\n${chunkList || "(none)"}\n\nWrite atomic findings. Name any companies the findings attach to.`,
    schema: gapSchema,
    schemaName: "gap",
    effort: "low",
  });
  await charge(db, run, MODEL_CALL_COST);
  for (const f of out.findings.slice(0, 3)) {
    await createNode(
      db,
      run,
      { category: "note", editorial_type: "evidence", title: f.title, content: f.body, confidence: f.confidence, provenance: "research" },
      agent,
    );
  }
  return `Gap repair: ${out.findings.length} findings for "${gap.slice(0, 60)}"`;
}

// ---------------------------------------------------------------------------
// Coordinator
// ---------------------------------------------------------------------------

async function claimTask(db: Db, run: RunRow, agent: number): Promise<any | null> {
  const now = new Date().toISOString();
  const { data: candidates } = await db
    .from("tasks")
    .select("*")
    .eq("run_id", run.id)
    .eq("status", "open")
    .or(`lease_expires_at.is.null,lease_expires_at.lt.${now}`)
    .or(`reserved_for_agent.is.null,reserved_for_agent.eq.${agent}`)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(5);
  for (const task of candidates ?? []) {
    const token = crypto.randomUUID();
    const { data: claimed } = await db
      .from("tasks")
      .update({
        status: "claimed",
        owner_agent: agent,
        claim_token: token,
        attempts: task.attempts + 1,
        lease_expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      })
      .eq("id", task.id)
      .eq("status", "open")
      .select()
      .single();
    if (claimed) return claimed;
  }
  return null;
}

async function runOneTask(db: Db, run: RunRow, task: any, agent: number) {
  await emit(db, run.id, "task_started", agent, { taskId: task.id, kind: task.kind, payload: task.payload });
  try {
    let summary: string;
    switch (task.kind) {
      case "decompose":
        summary = await execDecompose(db, run, task, agent);
        break;
      case "discovery":
        summary = await execDiscovery(db, run, task, agent);
        break;
      case "qualify":
        summary = await execQualify(db, run, task, agent);
        break;
      case "signals":
        summary = await execSignals(db, run, task, agent);
        break;
      case "contacts":
        summary = await execContacts(db, run, task, agent);
        break;
      case "gap":
        summary = await execGap(db, run, task, agent);
        break;
      default:
        summary = `Unknown task kind ${task.kind}`;
    }
    await db
      .from("tasks")
      .update({ status: "done", result_summary: summary, completed_at: new Date().toISOString() })
      .eq("id", task.id);
    await emit(db, run.id, "task_done", agent, { taskId: task.id, kind: task.kind, summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = task.attempts + 1 >= MAX_ATTEMPTS;
    await db
      .from("tasks")
      .update({ status: failed ? "failed" : "open", result_summary: message, owner_agent: null, claim_token: null })
      .eq("id", task.id);
    await emit(db, run.id, "task_error", agent, { taskId: task.id, kind: task.kind, error: message, failed });
    throw error;
  }
}

async function computeStats(db: Db, run: RunRow) {
  const { data: companies } = await db
    .from("nodes")
    .select("id, fields")
    .eq("run_id", run.id)
    .eq("category", "primary_entity")
    .eq("entity_type", "company");
  const all = companies ?? [];
  const qualified = all.filter((c: any) => c.fields?.status === "qualified");
  const { data: signalNotes } = await db
    .from("nodes")
    .select("id")
    .eq("run_id", run.id)
    .eq("semantic_kind", "demand_signal");
  const { data: people } = await db
    .from("nodes")
    .select("id")
    .eq("run_id", run.id)
    .eq("category", "primary_entity")
    .eq("entity_type", "person");
  const { data: chunkRows } = await db.from("nodes").select("id").eq("run_id", run.id).eq("category", "source_chunk");
  const { count: openTasks } = await db.from("tasks").select("id", { count: "exact", head: true }).eq("run_id", run.id).eq("status", "open");
  const { count: doneTasks } = await db.from("tasks").select("id", { count: "exact", head: true }).eq("run_id", run.id).eq("status", "done");
  return {
    companies: all.length,
    qualified: qualified.length,
    signals: signalNotes?.length ?? 0,
    people: people?.length ?? 0,
    chunks: chunkRows?.length ?? 0,
    openTasks: openTasks ?? 0,
    doneTasks: doneTasks ?? 0,
  };
}

async function evaluateEpoch(db: Db, run: RunRow): Promise<"consensus" | "continue"> {
  const epoch = run.epoch + 1;
  run.epoch = epoch;
  await db.from("runs").update({ epoch }).eq("id", run.id);
  const stats = await computeStats(db, run);
  const needed = Math.ceil(run.threshold * run.swarm_size);
  await emit(db, run.id, "epoch_opened", null, { epoch, revision: run.graph_revision, needed, roster: run.swarm_size, stats });

  const criteriaHashInput = `${run.completion_criteria}|${run.objective}`;
  const voterInput = `${briefText(run)}\n\nMeasured graph statistics at revision ${run.graph_revision}:\n${JSON.stringify(stats)}\n\nCriteria hash input: ${criteriaHashInput.length} chars. Vote yes only if the completion criteria are genuinely met; otherwise vote no and name one specific gap task.`;

  const votes: Array<{ decision: string; rationale: string; gap_task: string | null }> = [];
  const roster = Math.min(run.swarm_size, 100);
  const batch = 8;
  for (let i = 0; i < roster; i += batch) {
    const slice = Array.from({ length: Math.min(batch, roster - i) }, (_, k) => i + k);
    const results = await Promise.allSettled(
      slice.map((agentIdx) =>
        callModelJson({
          instructions: `You are research agent ${agentIdx + 1} of ${roster}, independently evaluating whether the run's completion criteria are met against a fixed graph revision. You see statistics, not other agents' votes. Be strict: unmet measurable predicates mean no.`,
          input: voterInput,
          schema: voteSchema,
          schemaName: "vote",
          effort: "low",
        }),
      ),
    );
    for (let k = 0; k < results.length; k++) {
      const r = results[k];
      if (r && r.status === "fulfilled") {
        votes.push(r.value);
        await db.from("votes").insert({
          run_id: run.id,
          epoch,
          agent_index: slice[k],
          revision: run.graph_revision,
          decision: r.value.decision,
          rationale: r.value.rationale,
          gap_task: r.value.gap_task,
        });
      }
    }
    await charge(db, run, MODEL_CALL_COST * slice.length);
  }

  const yes = votes.filter((v) => v.decision === "yes").length;
  const gatesPass = stats.qualified > 0; // deterministic gate: at least one qualified company
  await emit(db, run.id, "epoch_closed", null, { epoch, yes, needed, total: votes.length, gatesPass });

  if (yes >= needed && gatesPass) return "consensus";

  // Reserve each distinct proposed gap for its voter.
  const gapTasks = new Set<string>();
  for (const v of votes) {
    if (v.decision === "no" && v.gap_task) gapTasks.add(v.gap_task);
  }
  for (const gap of Array.from(gapTasks).slice(0, 6)) {
    await insertTask(db, run.id, "gap", { gap }, 15, `gap:${normalizeKey(gap)}`);
  }
  return "continue";
}

async function checkpoint(db: Db, run: RunRow, generation: number) {
  const stats = await computeStats(db, run);
  await db.from("checkpoints").insert({
    run_id: run.id,
    generation,
    manifest: {
      outcome: run.outcome,
      status: run.status,
      revision: run.graph_revision,
      spend: run.spend,
      stats,
      objective: run.objective,
      criteria: run.completion_criteria,
      connectors: run.connectors,
      parent_run_id: run.parent_run_id,
    },
  });
  await db.from("runs").update({ stats }).eq("id", run.id);
  return stats;
}

/**
 * One bounded execution window. The live screen calls this repeatedly while
 * the run is live — if the stream drops, new work stops (interactive v1).
 */
export async function executeWindow(db: Db, runId: string): Promise<{ status: string; stats: Record<string, any> }> {
  const { data: run } = await db.from("runs").select("*").eq("id", runId).single();
  if (!run) throw new Error("Run not found");
  if (run.status !== "running") {
    return { status: run.status, stats: run.stats ?? {} };
  }

  const deadline = Date.now() + WINDOW_MS;
  let sinceEval = 0;
  let generation = 1;

  const { count: existingTasks } = await db.from("tasks").select("id", { count: "exact", head: true }).eq("run_id", runId);
  if ((existingTasks ?? 0) === 0) {
    await insertTask(db, runId, "decompose", {}, 1, `decompose:v${run.assessment_version}`);
    await emit(db, runId, "run_started", null, { objective: run.objective, swarmSize: run.swarm_size });
  }

  while (Date.now() < deadline) {
    // Control checks: stop flag, budgets, wall clock.
    const { data: fresh } = await db.from("runs").select("stop_requested, status, spend, started_at").eq("id", runId).single();
    if (!fresh || fresh.status !== "running") break;
    if (fresh.stop_requested) {
      await finishRun(db, run, "stopped_by_user");
      break;
    }
    if (Number(fresh.spend) >= Number(run.cost_cap)) {
      await finishRun(db, run, "budget_cost");
      break;
    }
    if (run.started_at && Date.now() - new Date(run.started_at).getTime() > run.time_limit_sec * 1000) {
      await finishRun(db, run, "budget_wall_clock");
      break;
    }

    // Claim and run a batch of tasks concurrently.
    const claims = await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => claimTask(db, run, i)));
    const batch = claims.filter(Boolean);
    if (batch.length === 0) {
      // Frontier exhausted: evaluate; if still no work after gaps, finish.
      const verdict = await evaluateEpoch(db, run);
      if (verdict === "consensus") {
        await finishRun(db, run, "consensus");
        break;
      }
      const { count: openNow } = await db.from("tasks").select("id", { count: "exact", head: true }).eq("run_id", runId).eq("status", "open");
      if ((openNow ?? 0) === 0) {
        await finishRun(db, run, "criteria_unmet");
        break;
      }
      continue;
    }

    const results = await Promise.allSettled(batch.map((task: any, i: number) => runOneTask(db, run, task, i)));
    const failures = results.filter((r) => r.status === "rejected");
    if (failures.length === results.length) {
      // Systemic failure (e.g. model access denied): stop, don't burn budget.
      const err = (failures[0] as PromiseRejectedResult).reason;
      const status = err?.status ?? 0;
      if (status === 402 || status === 403 || status === 401) {
        await finishRun(db, run, "failed");
        await emit(db, runId, "run_error", null, { error: err?.message ?? "model access failed" });
        break;
      }
    }
    sinceEval += batch.length;

    if (sinceEval >= EVAL_EVERY_TASKS) {
      sinceEval = 0;
      const verdict = await evaluateEpoch(db, run);
      if (verdict === "consensus") {
        await finishRun(db, run, "consensus");
        break;
      }
    }
    await checkpoint(db, run, generation++);
  }

  const stats = await checkpoint(db, run, generation);
  const { data: finalRun } = await db.from("runs").select("status").eq("id", runId).single();
  return { status: finalRun?.status ?? run.status, stats };
}

async function finishRun(db: Db, run: RunRow, outcome: string) {
  await db
    .from("runs")
    .update({ status: outcome === "consensus" ? "completed" : "ended", outcome, ended_at: new Date().toISOString() })
    .eq("id", run.id);
  run.status = outcome === "consensus" ? "completed" : "ended";
  run.outcome = outcome;
  await emit(db, run.id, "run_finished", null, { outcome });
  await checkpoint(db, run, 9999);
}
