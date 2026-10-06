# Implementation and verification status

The user narrowed the PRD to a standalone local development backend using Tavily web search only. This file distinguishes implementation from release proofs; targets in the PRD are not represented as measured results.

| Area | Local implementation | Verification / limitation |
| --- | --- | --- |
| Setup and run catalogue | Editable brief, criteria, source selection, 5–100 agents, budgets, run history | API admission validation and browser workflow tests |
| Research execution | Tavily snippets, OpenAI structured research and evaluation, concurrent fair queues | Fixture-tested; real OpenAI model availability checked before admission; paid research not run |
| Graph | Primary entities with typed fields/prose, authored notes, immutable source chunks, evidence and semantic edges | Evidence hashes/spans, field shapes, identity, endpoint and profile gate tests |
| Capture | Complete returned JSON saved before model context, per-invocation source associations, bounded transport | Crash replay and duplicate registration tests; oversized responses retained as partial |
| Consensus | Fixed graph revision, independent evaluator requests, configured-roster denominator, deterministic gates | Quorum and unmet-criteria fixture tests; qualitative entailment remains a model/human judgment |
| Stop/recovery | Request cancellation, durable stop, execution fence, checkpoint generations, child runs | No transparent reattach; interrupted runs require continuation |
| Source scope | Tavily public search; fixture is separate and visibly fictional | No CRM, enrichment, ingestion, full-page fetching, or outreach |
| Storage | SQLite and synced local checkpoint/capture files | Local disk only; not cloud object storage; keep one server process per data directory |
| Costs | Explicit reservations and conservative per-call accounting | One live run at a time; configured ceilings are not billing reconciliation or a provider-enforced hard-dollar guarantee |
| Interface | Cosmos live graph, Sigma exploration, details, source ledger, trace ring/grid, accessible tables | Browser smoke coverage; 100-agent/thousands-node growing-graph performance not certified |
| Exports | JSON interchange/state, Markdown vault ZIP/raw sources, private HTML | Sanitization and category/provenance tests; no public deployment |

Known product limits requiring further release work: evaluation context is bounded and may vote no when the complete evidence cannot fit; source-origin independence is conservative and cannot prove that separate publishers are editorially independent; local generated schema validation is supported but there is no platform schema migration or canonical promotion; checkpoint cost grows with the full graph; snapshot stream frames use coherent full state rather than a compressed per-object delta protocol. These do not justify suppressing gaps or claiming research consensus when deterministic criteria fail.

Verified locally: production build and TypeScript checks pass; 42 backend/integration tests and 3 Chromium browser workflows pass, including desktop continuation/export, mobile stop, and a 100-agent fixture roster. npm audit reports zero vulnerabilities. No paid provider calls or cloud performance benchmarks were run.
