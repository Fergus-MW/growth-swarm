# Auto Research

Product requirements for a configurable research swarm. You give it a brief and completion criteria. Five to one hundred agents research that brief through connectors you select, and they build one shared graph. You watch the graph and the agent traces while the run is live, then you explore, export, or continue the saved result.

**Owner:** Fergus McKenzie-Wilson

## 1. Product

The graph has three node categories.

| Category | What it holds |
|---|---|
| Primary entity | The tenant's typed fields for that entity type, plus that entity's own free-text section. |
| Note | Agent-authored research: claims, questions, mechanisms, interpretations, and other concepts. |
| Source chunk | Material a connector returned: search results, pages, documents, records, or extracted passages. |

Agents write notes and entity prose. Connector capture writes source chunks. A relevance link records that a query returned a chunk in the context of an entity or note. An evidence link records that a specific claim cites an exact span in a stored chunk. Those are different edges.

The default profile is go-to-market research. You state a pain and a universe. The swarm looks for companies that plausibly hold that pain, dated demand signals, and people worth contacting, including the founder or CEO and the person closest to the pain. Unknowns and negative results stay visible. A run that has stopped finding new companies has not proved that every possible company has been found.

Research may use public sources and private connector material you are allowed to read, including records already ingested into the platform, through a read path. The swarm does not replace scheduled ingestion, change upstream records, send outreach, or write its output into canonical platform entities on its own. Turning a connector on authorizes research reads. It does not authorize arbitrary actions on that connector.

Version one is interactive. If the execution stream drops, new work stops. You recover from the last saved checkpoint by starting a child run. Detached jobs that outlive the browser, and several people watching one live execution, come later. A partial result stays inspectable when quality gates fail.

## 2. Core loop

1. Choose the go-to-market profile or a blank brief. Enter the objective, the universe, and the exclusions.
2. Enable or disable any connector instance you can access. Web search is selected when you can use it. Read each connector's capabilities, freshness, and estimated cost before you start.
3. Set the swarm size (5 to 100, default 20), the consensus threshold (default 70 percent of the configured roster), the completion criteria, and explicit spend and time limits.
4. Start. Primary entities, notes, and source chunks appear as the run commits them.
5. Open a claim and read the supporting passage, the connector that returned it, and any conflicting evidence.
6. Stop the run yourself, or let consensus or a budget end it. Explore or export the saved result.
7. Continue from that result as a child. You may change the objective, the criteria, the roster size, the connectors, the exclusions, and the budgets. The parent stays as it was.

Setup shows the interpretation of any count, date, or contact rule before launch, and the vote denominator in plain numbers. Seventy percent of twenty agents is fourteen yes votes. The screen shows that fraction of the configured roster. It does not substitute the share of agents who happened to vote recently.

## 3. Go-to-market profile

The profile is configuration on top of the shared graph, connector, and task contracts. A new profile may need new task behaviour. It is not guaranteed to be a JSON file alone.

### 3.1 Inputs

| Input | Meaning |
|---|---|
| Pain statement | The problem whose public or permitted private evidence the swarm should seek. |
| Universe | Free-text geography, sector, size, ownership, and any other constraint. |
| Exclusions | Companies or conditions left out of the qualified population. |
| Completion criteria | Editable prose, plus the displayed reading of any measurable predicate. |
| Connector selection | Any accessible connector instances. Web search starts selected when you can use it. Individual agents may receive a narrower subset. |
| Swarm and threshold | 5 to 100 agents, default 20. Default threshold is 70 percent of that roster. |
| Budget and freshness | Explicit time, money, and per-provider caps. The default signal window is 12 months. |

Example pain: finance teams reconciling supplier invoices by hand across several ERP instances after acquisitions. Example universe: UK and Ireland industrials, distribution, and specialist manufacturers, 200 to 2,000 headcount, private-equity-backed or recently acquired.

### 3.2 Graph shape

```text
source chunk ──evidences──▶ company ──holds_pain──▶ pain note
     │                       typed fields + free text
     └──evidences──▶ demand-signal note ◀──exhibits── company
person ──works_at──▶ company
person ──best_contact_for──▶ pain note
```

Pain, segments, mechanisms, signal interpretations, and open questions are notes. Each note has an editorial type and a semantic kind. Companies and confirmed people are primary entities on the tenant schema, each with its own free text. Search results, filings, adverts, CRM records, and other connector returns are source chunks. An evidence note explains what a chunk means. The note does not replace the chunk.

### 3.3 How the profile researches

**Decompose the universe.** The first tasks produce segment notes, a pain note with observable symptoms, and a bounded discovery plan. Assumptions and exclusions are written down. The tasks inspect the connectors you enabled. A company register, a private portfolio list, and web search need different queries. No task may assume web search is on, and no task may call a connector you disabled.

**Discover and qualify companies.** Discovery records candidates with partial or unknown fields. Identity resolution uses strong keys and the tenant's allowed name fallback. Every returned source item is kept, including candidates later excluded. Qualification judges the evidence against the current pain and universe, updates the company's free text, and writes atomic notes where a claim is worth its own node.

A qualification assertion creates `company → pain note` with supporting chunks, a rationale, a confidence, and an assessment version. A query that happened to mention the company does not create `holds_pain`. Unqualified and excluded companies stay in the graph with a reason and a search history. Their counts stay separate from qualified companies and from the completion denominator.

Sources may include job adverts, filings, acquisition records, permitted internal notes, conference talks, or operational descriptions. An acquisition or a vacancy is a clue. It is not proof of budget or buying intent. Agents look for contrary evidence and keep an inferred pain distinct from a sentence the company itself wrote.

**Find demand signals.** Signal tasks create dated signal notes. They do not invent a date field on an undated snippet. Event date, publication date, and fetch date are stored separately. An advert retrieved today may have been published last year. The signal window uses the event date or the evidenced publication date, and the date basis is visible.

Candidate signal kinds include hiring, acquisitions and funding, leadership changes, a statement of the problem, regulatory deadlines, technical migration or requests for proposal, peer adoption, and public complaints. Rank by specificity, source quality, and recency. A signal interpretation links to its chunks. A supported `exhibits` assertion links the company to the signal note. Unknown dates stay null.

**Find leadership and contacts.** One task seeks the founder or the current CEO. Another seeks the process owner, the budget holder, and the person living with the pain. Each confirmed person is a primary entity, with free-text rationale and evidence for employer and role. A same-name match has to be constrained by company and identifiers. Historical or negated employment does not count as current employment.

`best_contact_for` links the person to the pain note under the current assessment version, with a rationale and supporting chunks. The link is an inference grounded in role evidence. It does not claim the person has said they want to buy. If a required name cannot be found after bounded authorized research, the gap stays. The swarm does not invent a person to pass completion.

### 3.4 Default completion criteria

Setup offers these criteria and names the qualified denominator:

- At least 50 in-universe, non-excluded, qualified companies have a current `holds_pain` assessment supported by at least two independent source origins.
- At least 80 percent of those companies have one demand signal inside the configured window (default 12 months), with an evidenced date basis.
- Each of those companies has a confirmed founder or CEO and another named relevant contact, with current-role evidence and a pain-specific contact rationale.
- Required schema fields for a qualified state, source-capture completeness, evidence spans, identity integrity, and authored-link quality gates all pass.
- Every defined discovery segment has been covered, and the last 40 completed discovery attempts have produced no new eligible company.

The last rule is a bounded saturation indicator. It does not guarantee exhaustive market coverage. Six links per note and fixed note counts are advisory. They are not hidden completion rules.

The chosen percentage of the entire roster must still vote yes on the same final graph revision. Measurable predicates are computed from the graph. An agent does not guess them from the slice of the graph it happens to be reading.

If the universe looks smaller than 50, or the required public or private evidence is unavailable, the run reports unmet criteria. You can continue with different criteria or sources. The product does not change the brief on its own. Source access restrictions still apply to every evaluator.

### 3.5 Scheduling inside the profile

Fair queues keep reserved capacity for coverage work. Discovery cannot indefinitely outrank qualification, signals, or contacts. Deep source-checking may cluster by claim kind, while per-company coverage statistics stay visible. A no vote reserves a specific uncovered gap for that voter.

A child run may change the pain, the universe, the sources, and the time window. Authorized source observations are reused. Pain-fit and contact assessments that depend on the objective are computed again. Entities excluded under the parent can become relevant under new exclusions. Stale leadership and stale signals can be researched again. Entity prose revisions and parent history remain.

### 3.6 How to judge the profile

Evaluate fixed briefs, known small universes, contradictory sources, and mixes of private and public connectors. Measure precision, discovery coverage, signal and contact completeness, duplicate identities, citation support, cost, and wall time separately. Run 20-agent and 100-agent benchmarks only after the smaller correctness and capture tests pass.

In explore mode you can regroup by capability or segment, open conflicting evidence, and inspect weak or unknown claims. Every view keeps the three categories and their provenance visible.

On a representative go-to-market benchmark at 20 agents, the target is consensus within 20 minutes. For the qualified, in-universe, non-excluded companies the profile counts:

- At least 80 percent survive a human pain-fit spot-check.
- Each qualification has two independent source origins, and at least 80 percent have a dated demand signal inside the configured window.
- Each has an identified founder or CEO and at least one other relevant named contact, with evidence and a contact rationale. Missing public evidence stays a visible gap.
- Every accepted external claim resolves to a stored supporting passage and a source locator. Whether that URL still loads is reported separately from whether the stored passage supports the claim.
- The 200-company benchmark contains no duplicate companies. People who share a name stay distinct.
- All returned connector material is accounted for. Access controls that came from the source survive export and continuation. A disabled connector cannot be called.

A smaller universe may fail the default counts. Only you can change the criteria, and a change starts a child run. Saturation alone never overrides unmet criteria.

## 4. Swarm

| ID | Requirement |
|---|---|
| S-1 | You configure 5 to 100 agents. The default is 20. |
| S-2 | Every agent can read the same graph and propose writes. A committed write is visible at once through the validated storage layer. |
| S-3 | The default model is `gpt-4.1-mini` on the OpenAI API. `OPENAI_MODEL` selects another model. The run records the model and the endpoint. An unavailable model is rejected at admission. Structured output has to be shown to work before release. |
| S-4 | Web search (Tavily) is the default search option inside the connector catalogue you can access. |
| S-5 | Each agent periodically evaluates your criteria on its own, against one identified graph revision. |
| S-6 | A no vote names a gap task reserved for that agent. If another task already covers the gap, the voter waits for it or takes another uncovered gap. |
| S-7 | Completion needs at least `ceil(threshold × swarm size)` fresh yes votes on the same final evaluation revision, plus the deterministic gates. Missing voters stay in the denominator. |
| S-8 | Leases, fencing, and semantic deduplication stop duplicate committed results. A retry may repeat an external call. That cost is bounded and recorded. |
| S-9 | Spend and credits are reserved before each outbound call. Wall-clock, tool-call, storage, and no-progress limits are enforced on their own, separate from voting. |

Agents research and judge completion independently. A deterministic coordinator handles fairness, claims, writes, budgets, and evaluation epochs. The coordinator is not a model. Every agent reads the committed graph and receives only the connector tools enabled for it.

```text
until stop:
    honour the execution fence, cancellation, and deadlines
    if an evaluation epoch is open: evaluate its fixed graph revision alone
    otherwise claim a reserved gap task or the next eligible fair-queue task
    if every useful task is claimed: wait; do not manufacture a duplicate
    if the frontier is exhausted: propose one bounded, semantically distinct gap
    execute through the authorized connector path
        reserve, then capture, then write chunks, then call the model
    submit typed field, prose, note, and assertion changes with evidence references
    commit the result, task completion, follow-ups, and graph events together
```

Primary-entity prose and standalone notes share authoring tools. Source chunks are written by connector capture and by restore. A model does not file its summary as original source data. The model may point at existing chunk spans as evidence. The writer creates the edges.

### 4.1 Tasks

A task records its kind, typed payload, assessment version, profile version, schema version, target IDs, priority, status, attempt count, owner, lease expiry, claim token, and semantic dedupe key. Where the answer would change, task identity includes the objective, the source and capability selection, and the freshness window. Rephrasing a search is another attempt at the same research goal, not an unlimited supply of new tasks. A keyword string on its own is not task identity.

Research prompts require primary sources when they exist, a URL or a private-source locator for a claim, and an explicit negative verdict when the search fails. Original excerpts are kept with source offsets. Editorial types are used for atomic claims and mechanisms that earn their own note. Split by substance. There is no compulsory note count. A primary entity's free-text section remains available for context, synthesis, and links to those notes.

When evidence conflicts, both assertions stay, with their source chunks, and a note or a passage of entity prose explains the disagreement. Contradictions are not merged because one side has a higher confidence score. An empty connector response is not proof of absence. The query, the source scope, and the limits are recorded.

### 4.2 Fairness

Queues cover discovery, qualification, evidence and signals, contacts, and integrity or gap repair. Capacity is reserved for coverage work, and tasks that have been waiting are aged forward. A wide discovery frontier cannot starve contacts or evidence. Claim-kind clusters may be allocated inside those queues when that improves depth. A universal company-only shard is not required.

Pilot capacity weights start at discovery 20 percent, qualification 25 percent, signals and evidence 25 percent, contacts 20 percent, integrity and gaps 10 percent. Unused slots are lent to other queues. Behaviour is validated at five agents before the weights are treated as tuned. These are scheduler defaults. They are not a promise about the finished product. Newly returned source chunks and programmatic linking do not wait on a low-priority model queue. Capture happens before any model reads the material.

### 4.3 Claims, leases, and fenced commits

Selection and the conditional mutation that claims a task run inside a tested query-level transaction, or under a short process-local scheduler lock. A read may decide priority order. The claim itself atomically checks that the task is open or its lease has expired, increments the attempt count, and issues a new claim token. A healthy owner renews a five-minute lease. The scheduler lock and the writer lock are never held across a connector call or a model call.

Each result commit requires current task ownership, a matching claim token, and a valid run execution fence. A late response from an expired owner cannot change authored graph state. The source response, if it was captured on its own, stays auditable.

Graph changes, the task moving to done, emitted follow-ups, and event records are one atomic effect. On the third failed attempt the task is set to failed and the gap is exposed. Three attempts and at most 40 outbound calls per task are the initial upper bounds, and they still sit under the spend reservation. A lease cannot promise that an external call happens exactly once. The guarantee is an idempotent accepted result and a bounded number of charged retries. Providers that accept an idempotency key receive one. A non-idempotent external action is never replayed as research.

### 4.4 Consensus

You set free-text criteria and a threshold. The threshold is greater than 0 and at most 1. The default is 0.70. Explicit count, date, and contact criteria are translated into deterministic predicates at setup, and that reading is shown for review before launch. Whatever is left that cannot be computed stays with the agents as qualitative criteria. Model inference cannot weaken a condition you wrote.

Agents request an evaluation on a cadence. The initial cadence is every three completed tasks or 60 seconds, staggered across the roster. The coordinator opens an epoch when that is useful and still inside budget.

1. New research dispatch stops. In-flight work is drained or cancelled within a bound. Responses already received are captured, and accepted results are committed. Local writers quiesce.
2. Navigation and provenance content is generated. Deterministic graph and profile gates are computed. A research revision is fixed. No research mutation is accepted during the evaluation.
3. Each agent sees that same revision, the verified coverage statistics, the evidence it is allowed to read, and the criteria. It does not see other agents' votes or their reasons. A vote records the epoch, the revision, a hash of the criteria, the time, the decision, a short rationale, and a proposed gap task when the vote is no.
4. The epoch needs `ceil(threshold × configured swarm size)` yes votes from distinct roster members before the epoch deadline. The pilot deadline is 120 seconds. The denominator is never reduced to the agents who voted.
5. If the votes and the gates pass, further writes are fenced, the final generation is persisted for exactly that research revision, and the run emits completion. Vote and budget audit metadata may be attached to the manifest without changing the revision the voters judged.
6. Otherwise the epoch closes, its votes are discarded for any future completion decision, work resumes, and each distinct proposed gap is reserved for its voter. If another task already covers that gap, the voter waits for the result or receives another uncovered gap.

At 20 agents and 70 percent, completion needs 14 yes votes. At 100 agents it needs 70. A missing or failed voter stays in the configured denominator. Repeated failure to reach quorum is reported, and the run eventually ends on a budget or a deadline. It does not end as a manufactured consensus. A change to policy, schema, or source access during an epoch invalidates that epoch. Access is checked again before the result is published.

Consensus is a stop decision. It is not proof that coverage was exhaustive or that every claim is true. Deterministic validation checks field evidence, source capture, identity and link integrity, and the measurable criteria. Qualitative checks and human spot-checks test whether the evidence actually supports the claims. A dense graph does not stand in for research quality.

### 4.5 Saturation, progress, and budgets

Discovery saturation is based on completed discovery work, tracked per segment and per source. It is not based on arbitrary ticks or on contact tasks. A pilot default is 40 bounded discovery attempts with no new eligible company, after every defined segment has been covered. That is one criterion. Unmet signals, contacts, and counts stay unmet. A small universe can therefore finish as `criteria_unmet` rather than by inventing companies.

Useful progress includes a new eligible entity, stronger or contradictory evidence, a required field completed, a current contact, an identity resolved, and a research gap repaired. Adding raw chunks, repeating queries, or padding notes does not reset the no-progress watchdog. The pilot watchdog starts at five minutes without useful progress, measured on a monotonic clock, and it is suspended during a bounded evaluation or finalization interval. The watchdog is separate from saturation.

| Limit | Initial policy |
|---|---|
| Wall clock | Default 30 minutes, checked against the request deadline and the time reserved for finalization. |
| Model tokens | Pilot ceilings of 20 million input tokens and 4 million output tokens, under the explicit money cap. The ceilings are not a price. |
| Money and connector credits | A required run cap, a versioned provider price policy, and a limit per enabled connector. |
| Web-search requests | An optional initial ceiling of 50 times the swarm size, under the shared credential quota and the run cost. |
| Tool attempts | Three attempts per task, at most 40 outbound calls per task, with semantic dedupe covering rephrasing. |
| Stored bytes, pages, and chunks | Explicit caps set at admission, matched to worker memory and durable storage. A run that would exceed them fails partial. Stored source is not silently cut down. |
| No progress | A pilot five-minute useful-progress watchdog, distinct from discovery saturation. |
| Persistence health | Paid dispatch pauses when the last successful checkpoint is older than the configured limit. |

An upper bound is reserved before every call, atomically against the run quota and the shared provider quota. Model outputs are bounded. Evaluator calls, retries, extraction, and optional embeddings are included in the reserve. Actual usage is reconciled when the call returns. An in-flight charge whose size is still unknown stays reserved until it is reconciled. A hard money ceiling can only be offered for a capability whose cost has a defensible bound. Different connector instances may share a vendor account or project. The quota key has to name that shared resource. A connection pool is not a rate limit.

Capacity is kept for finalization and for the completion evaluation. Agents cannot spend that reserve on new discovery. On a stop, new dispatch is prohibited and draining and cancellation are bounded. A provider may still charge for work after cancellation. The ledger accounts for that conservatively and shows unsettled usage.

### 4.6 Trace events

A trace event contains the run, agent, and task IDs, a status, the connector operation, a sanitized query summary, a usage summary, and the node and chunk IDs it refers to. Traces describe actions and short findings. They do not contain hidden model reasoning or credentials. The trace ring may drop frames. Committed graph events and source-capture events resync. They are not dropped quietly.

Typed tools validate model outputs, evidence references, and access-control dependencies. Source text is untrusted. URL retrieval and redirects are restricted. Markdown and HTML are sanitized on export. No source passage and no model message can change the tenant, the budgets, the connector selection, or the execution fence.

## 5. Graph

### 5.1 Three categories

| Category | What is stored | Meaning |
|---|---|---|
| `primary_entity` | One generated table per tenant entity definition | Typed platform fields plus that entity's versioned free text. |
| `note` | A note table | Agent-authored atomic claims, explanations, questions, and other concepts. |
| `source_chunk` | A source-chunk table | Connector-returned content and provenance. Agents do not author these. |

A company is a primary entity. A pain, a sector, or a reading of a demand signal can be a note with an open semantic kind. The job advert behind the signal is a source chunk.

The nine editorial types for authored content are session, person, organisation, position, practice, framework, evidence, question, and meta. An evidence note is an agent's interpretation of evidence. A source chunk holds the material that was returned. A primary person or company may use the matching editorial type in its free-text metadata without creating a second node.

Runs, tasks, votes, assertions, source invocations, revisions, events, and budget records are operational tables. They are not extra graph categories. Tags are metadata. An unknown concept is a note, including one whose resolution status is unresolved.

Every graph object has an opaque stable ID, tenant and run attribution, a category, an origin (run, agent, or invocation), timestamps, access-dependency metadata, and a version. Labels and export filenames are not identity.

### 5.2 Tenant schema and primary fields

All pages of the platform entity-definition catalogue are loaded under the authenticated tenant. The snapshot is cached by tenant and schema hash in durable storage. One tenant's schema is never baked into a shared image. The run persists the original definitions, the generated storage description, the translator version, and the hash. A child inherits that snapshot. Moving a lineage onto a newer schema is a separate feature you ask for explicitly.

Generated table and field identifiers are safe, and a mapping back to platform definition IDs and original keys is kept. Operational fields and prose fields are namespaced so a tenant-defined name cannot collide with them. Values are parameterized. Identifiers are validated. A model never supplies raw storage definitions.

| Platform shape | How it is stored and checked |
|---|---|
| String, text, URL, email, phone | Typed strings, plus the shared format-specific normalization used for matching. |
| Number, boolean, date | Typed values. Date-only values stay distinct from timestamps, and precision survives serialization. |
| List of strings | Each member is validated, including allowed values. |
| String map | A flat map of strings. |
| Record list | Declared keys, percentage fields, and sum and tolerance rules are validated. |
| Money series | Fiscal period, amount, currency, and scale are preserved. Silent unit conversion is rejected. |
| Dated series | Entry types are validated and dates are unique. |
| Unique identifier and match mode | These drive resolver policy and normalized identifier indexes. A unique index on the raw field is not the whole matching policy. |
| Required field | Gates the qualified or complete state. A partial research entity may carry an explicit unknown. It does not receive a fabricated value. |

Unknown or invalid fields are rejected. A missing required field stays visible as a gap. The canonical resolver path for this product is fixed before release and tested on same-name people, conflicting identifiers, domains, and company-name variants. If the frozen tenant definition uses embedding or hybrid matching, that path is implemented and tested, or capability checks fail before the run starts. Names are not silently substituted.

Field assertions and the selected current value are both stored. Each external factual value needs supporting chunk references and spans. A nonempty citation list at company level is not enough. Competing values, their evidence, and the selection history are kept. Stronger evidence is preferred, then the applicable event or publication recency. Disagreement is not deleted.

### 5.3 Free text and standalone notes

Every primary entity has `free_text` with a current revision and append-only prior revisions. The section holds research prose beyond the tenant's typed fields. It behaves as a note for links, evidence references, confidence, provenance, and rendering, and it remains part of that primary node. Opening a company shows the typed fields and then this prose. Export writes one company file with both faces.

Standalone notes hold claims, mechanisms, findings, and questions that are worth addressing on their own. There is no compulsory set of six notes, and a valid one-note result is accepted. Split by the number of distinct claims. Do not pad to hit a density target. The primary section can summarize and link those notes and still keep entity-specific prose of its own.

Both authored surfaces carry:

- A title, display aliases, an editorial type, tags, and an optional open semantic kind.
- Confidence of high, medium, or low.
- Provenance of research, inference, brief, meta, transcript, or transcript plus research.
- A markdown body, and stable evidence references bound to text spans.
- Author and run origin, a revision ID, supersession and conflict metadata, and access dependencies.

Brief provenance, and source chunk as an export category, are part of this product. A draft is model output. The writer validates it and commits it. Concurrent edits to entity prose use an expected-revision check. A stale write is merged through an explicit reviewed patch, or it becomes a separate note. It does not overwrite another agent's prose. Contradictory claims are kept, with explicit polarity and evidence.

### 5.4 Source chunks and assertions

Source chunks are immutable snapshots of returned material. Each chunk stores content, a raw payload or blob reference where one is needed, a locator, the provider and connector, a content hash and version, publication, event, and fetch times, extraction offsets, and an access scope. A later response at the same URL can create a new version. Normalizing the URL is not deduplication.

Chunk IDs are local research identities. A chunk copied from the platform also records the platform source-chunk ID. A research storage ID is never written into a platform UUID field. A locator may be a public URL or an authenticated provider or platform record URL. No public URL is invented for private data.

An assertion is an operational record. It has an owner node and revision, a field key or a prose span, a value or claim, a scope and objective version, provenance, confidence, an effective time, and evidence references. Each reference contains a chunk ID, a quote or a record path and offset, and a polarity: supports, contradicts, or qualifies. Ownership, access, span existence, and content integrity are checked before commit. Matching a span does not prove the model understood it. Entailment still needs research and evaluation.

When a suitable source URL exists, export includes a citation in the platform field-citation shape, plus a separate research evidence record that keeps the full provenance. Unknown titles and dates stay null. Briefs, questions, and explicit inferences use their real provenance and their real dependencies. They do not receive invented source quotes.

### 5.5 Edges

Every edge has an ID, endpoints, a platform edge kind, a relation name, a derivation and version, the assertion or prose revision that owns it, a score and provenance, a run, and access dependencies. Edges are materialized by a deterministic step after source capture or after a validated authored write.

| Relation | Endpoints | Meaning |
|---|---|---|
| `mentions`, `related_to` | Primary or note to primary or note. Chunk to primary or note for a resolved source mention. | A navigational or contextual reference. |
| `retrieved_for` | Chunk to primary or note. | The query context. The result may be irrelevant. |
| `references` | Primary or note to chunk. | Background or reading provenance. |
| `evidences` | Chunk to primary or note. | The assertion ID, the spans, and the polarity say what is supported, contradicted, or qualified. |
| `works_at`, `exhibits`, `operates_in` | Typed semantic endpoints. | Materialized from a validated subject, relation, and object. |
| `holds_pain`, `best_contact_for` | Company or person to a pain note. | An assessment scoped to the objective, with evidence and a rationale. |
| `contradicts`, `qualifies` | Primary or note to primary or note. | An explicit assertion. A heading in the prose does not create this edge. |
| `co_mentioned_with`, `semantically_similar_to` | Compatible primary or note endpoints. | A replaceable inference, with the rule or model version recorded. |

**Prose links and identity.** Both primary free text and standalone notes are parsed. A markdown-aware preprocessing step keeps code samples from becoming edges. Wikilink syntax is matched, then resolved through one table of exact export names, explicit aliases, and stable IDs. Output links are normalized to unique basenames before export. Heading slugs are metadata only. A heading titled Assessment, or Why it matters here, does not imply contradiction.

A wikilink may resolve an existing primary identity through an authorized binding. It cannot create a primary entity from a bare name. An ambiguous target stays an unresolved note reference. A typed stub note is created only when it is useful, and it is marked as a stub. Qualification with strong identifiers can bind that stub to a primary entity, redirect aliases, and retarget edges in one transaction. The stub's audit history is kept. The graph does not show two current identities.

**Source relevance.** Retrieval-context links are created immediately. Identifier and mention links are added where the match is deterministic. Evidence-reference bindings create per-assertion evidence edges on commit. Association runs again when new entities, notes, or identifiers arrive. Unused chunks stay in the source ledger. They are not forced into support links to clear an orphan count. Query context, an uncertain match, and a supported claim stay separately filterable.

**Business relationships.** Research output may contain a subject, a relation, an object, a polarity, a valid time, evidence references, and a rationale. The writer checks endpoint categories, vocabulary, and evidence, then creates the semantic edge. There is no second model call to draw the edge. This is required for person-to-company employment and for company-to-signal or company-to-pain links. A note that mentions two entities does not establish the relationship. Negated and historical relationships keep those qualifiers and do not count as current employment or as qualification.

**Structural similarity.** Co-mention is a weak inference, capped at 20 pairs per authored revision. Code, raw response bulk lists, and source-ledger indexes are excluded. Past the cap, the shared authored owner remains the shared context. No extra hyperedge category is introduced.

Property similarity is an optional profile projection. Before it is used, the tenant fields, the normalization, the treatment of missing values, zero vectors, weighting, and a distance floor are defined. The first implementation is a full pass over the small relevant primary type, at most every 30 seconds. A new node can change the nearest neighbours of nodes that already exist. A version's prior edges are replaced atomically. Up to four outgoing neighbours are kept, and only when they clear the distance floor. Incoming degree may be larger. Text embeddings are off by default. Turning them on requires an explicit model and version, a budget, and an evaluation. Embeddings are not a hidden dependency of note linking.

**Revisions and deduplication.** Edge keys are deterministic over the relation, the endpoints, the assertion or prose revision, and the rule version. Running the same derivation again is idempotent. Replacing current prose, or replacing a similarity projection, retracts its obsolete active edges and emits removals. Audit versions remain. Source-capture deduplication keeps every invocation association. An entity merge updates references, index bindings, derived edges, and exported names atomically, under the write coordinator.

### 5.6 A worked path

An agent researching Acme calls an enabled web-search instance.

1. Invocation Q1 is recorded with the exact validated query. Returned result R1, a job-advert snippet, and result R2, an unrelated hit, are persisted as chunks C1 and C2. Both are kept.
2. Retrieval-context edges run from C1 and C2 to Acme. Only a resolved identifier earns a mention.
3. If the snippet is not enough, the advert is fetched through an enabled read capability. The full page is a new captured chunk with its own retrieval association. It does not rewrite C1.
4. Acme's free text says the advert describes reconciliation across two ERP systems, and it cites the exact chunk span. The chunk gains an evidence edge to Acme for that assertion.
5. A separate dated demand-signal note is written, with its interpretation and its source span. The chunk evidences the signal note. A validated `exhibits` edge links Acme to the signal note.
6. A later person record with a confirmed employer can create a primary person and a supported `works_at` relationship. A name that appeared only in the query cannot.

The result has three categories, one Acme node with its own prose, a generated interpretation, and the original source. R2 stays inspectable and does not support Acme's qualification.

### 5.7 Quality gates

Broken wikilinks, duplicate basenames, and inbound orphans are checked on the export projection. That check does not enforce six links, valid frontmatter, URL coverage, claim support, or failure on a dead URL. A project validator adds those checks where they apply. Density and note counts stay advisory unless you explicitly select them as criteria.

The full graph is validated for endpoint integrity, identity uniqueness, revision validity, field shapes, evidence spans, invocation and chunk completeness, access policies, and profile predicates. Authored prose is validated for unresolved references, missing factual evidence, and unsupported semantic assertions. A source chunk that no note cites is still valid captured output. An authored-orphan check is not satisfied by a retrieval-context edge or by a generated index.

For compatibility with the editorial vault layout, a temporary projection uses safe unique basenames, canonical links, and code examples neutralized so a legacy link scan does not treat them as edges. The legacy structural check runs on that projection and is read alongside the project checks. Stored source content is not altered to make the scan pass. Metrics for authored notes and entity prose are reported separately from source chunks and from generated navigation. Adding 500 raw results cannot raise a research-quality score.

Start Here and the provenance and source indexes are generated before final validation. Their navigation links can satisfy export navigability. They cannot hide an authored research orphan in the independent project gate. A failing partial run stays downloadable, with quality diagnostics. Padding is never generated to reach a density threshold.

## 6. Connectors and source capture

This contract applies to every connector.

### 6.1 Selection

| ID | Requirement |
|---|---|
| C-1 | List every tenant connector visible to the caller. Select by connector instance ID, including several instances of the same provider. |
| C-2 | You can enable or disable any accessible connector for the swarm. Every supported tenant connector type has a read adapter or a query path over already ingested data. A missing adapter is a visible release gap. It is never skipped in silence. |
| C-3 | The tools an agent actually receives are the intersection of tenant and caller permissions, the run selection, the connector's read capabilities, and any narrower per-agent subset. Authorization is checked again before dispatch. |
| C-4 | Every invocation has immutable provenance, a status of result, empty, or error, usage, and the chunks it returned. The complete returned source is stored before a model reads it. Shortening the model context does not shorten storage. |
| C-5 | API reads, protocol-tool reads, scraper reads, and ingestion-facade reads are captured the same way. Searches, pages, batches, and retries keep their invocation relationships. |
| C-6 | Chunks are attached to known relevant entities and notes automatically. Unresolved results are kept for a later association. Relevance does not assert that a claim is true. |
| C-7 | Credentials stay on the server. Private chunks, and the notes and entities derived from them, keep their source access restrictions through sharing, export, and continuation. |
| C-8 | Connector selection is frozen for an execution, except emergency disable and revocation, which take effect at the next dispatch and at access checks. Enabling another connector means a child run. |

Setup loads the full paginated catalogue visible to you in the tenant. Two accounts of the same provider stay separately selectable and separately attributed.

The run stores the enabled connector instance IDs, any per-agent subsets, catalogue and capability versions, data freshness, and the caller's authorized scope. Every agent inherits the run selection unless it is given a narrower subset. An agent cannot widen it. Web search is initially selected when you can use it. Every choice is visible before launch.

A per-agent subset limits which connectors that agent can call. It does not partition the graph. All agents act for the same authorized run and can read source chunks the run is still allowed to hold. An agent with no web-search tool may still reason over a chunk another agent already captured. Disabling a connector stops future calls. Excluding evidence, and revoking source access, are separate operations, defined below.

A connector toggle permits research reads. It does not permit sending email, writing CRM records, launching an ingestion job, or exposing every tool on a tool server. The model's tools are built from a reviewed read-capability registry. Arguments, selection, and current rights are validated again at dispatch. Hiding a tool from the prompt is not sufficient. An authentication failure is a different status from an empty result.

| What the connector already does | Research path |
|---|---|
| Enrichment API, tool server, or scraper | Typed search, lookup, and read through its adapter, with pooled transports and metering supplied by the runtime. |
| A live read API | A bounded query and read adapter that keeps the connector's own record and file access controls. |
| Scheduled ingestion only | Query and read the already ingested records and chunks you are allowed to see. Preserve the connector ID, the original record and chunk IDs, and the sync freshness. This path does not pretend to be a live query of the upstream system. |
| Connected, with neither route usable yet | A visible compatibility gap. Implement the read path before claiming coverage for that tenant. Do not drop the connector from the list, and do not replace it with web search. |

Before release, an explicit matrix covers every supported tenant connector type, including material you uploaded, through the ingestion path. All of them can be enabled or disabled. An unsupported capability you requested fails the preflight, with a reason.

With no live connector enabled, an authorized child may analyse source chunks it inherited and is still allowed to read. A new empty run with no usable source reports that limit before start. Web search is not switched on to fill the gap.

### 6.2 Invocation records

Each attempted operation receives an invocation ID before dispatch. The record is operational. It is not a fourth graph category. It contains:

- Tenant, run, attempt, agent, and task IDs, plus the connector instance, the provider, and the operation.
- The validated query and arguments, with secrets removed, a query hash, a pagination cursor, and the parent invocation for a follow-up page or read.
- Start and finish times, request and response identifiers, retry lineage, and the usage reservation.
- Status: pending, succeeded, empty, partial, failed, cancelled, or response unavailable.
- Returned item count, a raw response artefact and hash, chunk IDs, content and truncation diagnostics, and actual cost or credits when known.

Every returned item becomes one or more source chunks, including results an agent later judges irrelevant. Empty and failed calls have invocation records and no invented content chunks. A new page or a retry is a new invocation. Identical content may reuse an immutable chunk inside the same tenant and access scope, with a new retrieval association. Deduplication does not erase invocation history.

A chunk records category `source_chunk`, an opaque stable ID, connector, provider, and source identity, a title, a locator, the returned content, a content hash and version, MIME type and format, language, source offsets or JSON path or page, published, event, and fetched times, and an access policy. Unknown dates stay null. A search snippet is labelled as a search snippet. It is not described as a fetched full page. A structured record keeps canonical raw JSON and a readable representation with field paths. A binary response uses an immutable blob plus deterministic extracted text chunks. An unreadable item remains a graph chunk with an extraction status and a blob reference. A generated summary is not stored in its place and labelled as source text.

The complete returned payload is retained, subject to the source's access and retention rules and to credential redaction. Larger payloads live in immutable objects. Their searchable text or record chunks, and their provenance, remain graph nodes. Authentication headers, session tokens, and other transport secrets are not retained. If the provider forbids retention, the capability is reported as incompatible, and ephemeral content is not used to produce claims that look reproducible.

### 6.3 Capture before any model reads the result

1. Check selection, your rights and the tenant's rights, source permissions, capability, and budget.
2. Reserve the cost and persist the invocation intent under the execution fence.
3. Dispatch through a pooled, metered adapter with a deadline, byte and page limits, and retries.
4. Capture the response losslessly as an immutable source artefact and persist the invocation completion and chunk descriptor. Do this before any agent receives the content.
5. In one graph mutation, register every returned chunk and retrieval association, and run deterministic relevance linking. Emit the events only after that commit.
6. Return a bounded excerpt to the model, with chunk IDs and offsets. Storage stays complete when the excerpt is short.
7. When an assertion, note, or entity is written, validate the evidence references and add the support links.

A durable capture journal covers a crash between step 4 and the next graph checkpoint. Restore imports captured chunks that are missing from that checkpoint, idempotently. A call interrupted before its response was durably stored is recorded as response unavailable, with unknown cost. Bytes that were never received cannot be recovered. Dispatch pauses if capture storage fails. An agent does not build claims from data the run cannot keep.

Pages, response sizes, and total stored bytes are bounded at admission. A provider response cut by a transport limit is marked partial. The bytes and status that arrived are stored. The item is not counted as fully researched. Bounded paging or ranged retrieval is used when the provider supports it. Excess source data is not thrown away in silence, and a truncated response is not treated as complete.

### 6.4 Automatic links

Every captured chunk may link to any relevant primary entity or note, including ones created later. Linking runs when chunks arrive and again when authored objects or identifiers change.

| Trigger | Edge | Meaning |
|---|---|---|
| The call targeted known entity or note IDs | `retrieved_for` from each returned chunk to those targets, carrying the query and task | Retrieval context. The result may be irrelevant. |
| An exact permitted identifier binds a returned record or span to an entity or note | `mentions`, with the matching span and rule | A reference. It is not evidence for every field. |
| An accepted field or prose assertion cites chunk IDs and supporting spans | `evidences`, with the assertion ID and the polarity | Supports, contradicts, or qualifies that claim. |
| Authored prose cites a chunk without asserting a fact | `references` | Reading or background provenance. |

An association from an ambiguous name, or from semantic retrieval, stays a possible match with a score and a rationale until it is resolved. It never becomes a confident identity edge or a support edge. Agents name claim-to-source relevance in their normal research output. The writer materializes valid links. There is no second model call whose job is drawing edges. Explicit source-ID bindings, identifier indexes, and evidence references make later linking deterministic. After a merge or an identifier change, a re-evaluation pass repairs incoming and outgoing associations. Orphan source chunks are kept and shown in the source ledger.

A query for Acme that returns a different Acme has retrieval context and does not inherit the first Acme's identity or qualification. Two URLs that repeat one press release count as one source origin, not as two independent corroborations.

Web search is the first adapter. It uses the same capture and evidence contract as every other connector. Full response capture happens at the adapter boundary, on a pooled transport, with per-call metering, a publisher identity, and an explicit distinction between a snippet and full text. Fetching or extracting a full source happens only through an enabled read capability, and that call is charged. Dates and supporting quotes come from returned content.

### 6.5 Permission changes

Connector selection stays fixed during a run, except emergency disable and rights revocation. Those stop further calls and trigger an access-policy re-evaluation. To enable another source, or to change the normal selection, you continue with a child.

Disabling a connector for future queries is separate from losing permission to data already captured. By default, a child may reuse inherited chunks it is still authorized to read, including chunks from a connector that is now disabled. The continue dialog shows this. You can choose to exclude those sources from new reasoning. Revoked source access forbids reuse and serving of the chunk and of content derived from it, whatever the toggle says.

Version one restricts an artefact to readers entitled to every source dependency it contains. Enabling a personal or private source does not create a graph the whole tenant can read. Read, model context, detail, download, and continuation all recheck current rights. If permission narrows, the product fails closed, or it creates a filtered child when you explicitly ask for one. A retention or deletion request applies to captured blobs, chunks, and affected derived artefacts across descendants. Only non-content audit metadata is retained where that is permitted. That access and retention rule overrides content immutability. It does not rewrite what the parent concluded. Nothing is published publicly on its own.

### 6.6 Connector acceptance

Before a connector type is advertised, tests cover at least web search, one structured enrichment source, one tool-server read, and one ingestion facade, and then the same suite across every advertised capability. The suite includes several instances of one type, a disabled direct tool, group and private access controls, revocation mid-call, pagination, retries, empty and error responses, identical content fetched twice, changed content at the same URL, lossless capture against a truncated model context, byte limits, crash and replay, entities created after the capture, ambiguous names, and exports that respect source restrictions.

## 7. Runs, checkpoints, and continuation

| ID | Requirement |
|---|---|
| RUN-1 | Every accepted run has durable initial state before any paid work. Every outcome leaves the last successfully committed checkpoint. The interface reports that checkpoint's age and whether the result is partial. |
| RUN-2 | A checkpoint contains the schema, all three node categories, prose revisions, assertions and edges, invocation records, tasks, votes, counters, and version metadata. |
| RUN-3 | Completed runs and partial runs can be continued. |
| RUN-4 | A child may change the objective, the criteria, the threshold, the agents, the connectors, the budgets, and the exclusions. |
| RUN-5 | The parent is immutable. The child names the exact parent checkpoint and the lineage. |
| RUN-6 | Observations and tasks that are still valid are reused. A changed objective, a changed freshness window, or a changed input invalidates the dependent assessments and the task dedupe keys. |
| RUN-7 | An authorized run list shows outcome, progress, spend, source access restrictions, and lineage. |
| RUN-8 | Idempotent creation and a fenced execution owner stop a client retry from launching a second paid swarm. |

### 7.1 Control and execution

1. Creating a run validates identity, schema, capabilities, selection, criteria, and budgets. An idempotency key you supply is scoped to the tenant and to you. An identical repeat returns the same run. A conflicting body fails.
2. The catalogue entry and a durable initial checkpoint are created. The run is accepted only after both exist. An incomplete preparation is reconciled on retry. No paid call precedes acceptance.
3. Execution opens an authenticated streamed response through the platform gateway to a private worker. The gateway preserves disconnects, heartbeats, and the full timeout. A transactional owner claim and a fencing token prevent a second execution of the same run. A duplicate start returns status and checkpoint information and does not launch another swarm.
4. Stop writes an authorized durable stop flag through the control API. The worker polls while the execution request is active, with a target of at most two seconds. Stop does not depend on a second request landing on the same instance.
5. List, status, checkpoint, detail, and export routes authorize against the control catalogue and against current source entitlements, then read the committed generation.

The gateway does not buffer the event stream, and it does not acknowledge a successful execution before the worker has claimed ownership. Proxy and browser timeout, disconnect propagation, cross-origin rules, authentication, and repeated submission are tested. Creating a run and executing it are separate idempotent operations.

On disconnect, dispatch stops and cancellation and checkpointing proceed as a bounded best effort. Request-based CPU does not promise background processing after that request ends. Recovery uses prior checkpoints and durable captures. There is no promise that you can reattach to the same process within 60 seconds. The interface offers checkpoint inspection, then a child continuation. A stale execution lease is fenced through the control API before a crashed run is classified as failed and continuable. Paid calls are not automatically replayed under the same run ID.

### 7.2 What a checkpoint contains

```text
tenants/{tenant}/runs/{run}/
  current.json                         committed generation pointer and checksum
  generations/{generation}/
    manifest.json                      outcome, config, lineage, versions, usage
    schema                             frozen platform definitions and translator output
    state                              typed nodes, relations, and operational records
    graph and details                  topology and full authorized exploration content
    quality                            gates, gaps, capture completeness, metrics
  captures/{invocation}/               immutable completion descriptors and raw responses
  blobs/{content hash}/                immutable payloads, scoped by access and tenant
  views/{graph revision}/              optional browser layout, not research truth
```

The manifest includes source blob references, capture high-water information, a category and table inventory, codec, engine, schema, profile, prompt, and model versions, checksums, the objective, the criteria, the connector configuration, and the exact parent generation. Content-addressed sharing does not widen source permissions and does not cross tenants.

### 7.3 Commit

1. Checkpoint jobs are serialized. A coherent revision is captured under the writer barrier. Task completion, results, and events belong to that same transaction history.
2. Immutable generation objects are written and their hashes and references are verified.
3. The current pointer is published last, with preconditions that stop an older upload replacing a newer pointer. The prior committed generation is kept.
4. The control catalogue's checkpoint reference and status are updated idempotently. If the process crashes between object storage and the catalogue write, reconciliation uses the committed pointer, and only then is completion exposed.

Object writes are not one transaction across many objects. The pointer protocol is what makes a generation authoritative.

Checkpoints are attempted every five seconds and at lifecycle transitions. Recovery-point age is measured from the last successful commit, including upload time and failure. A five-second timer is not a five-second loss guarantee. New paid dispatch stops if checkpoint age exceeds the persistence-health limit. The degraded state is shown and the previous generation is used. The pilot health limit starts at 15 seconds and is calibrated before release.

Source responses follow a stricter rule. Returned data and the completion descriptor are stored before an agent sees them. Recovery replays captures missing from the latest graph checkpoint. An interrupted response that never reached durable storage is recorded as unavailable. The reservation and the attempt metadata are kept, and unknown provider cost is reconciled.

### 7.4 Restore and outcomes

Restore checks format versions and access, applies the frozen schema, decodes record IDs and temporal values, inserts nodes, then restores edges with typed endpoints. Operational records are restored, and captures after the checkpoint are registered idempotently. Traversals and evidence references are tested. A dictionary round trip is not enough.

On a graceful stop, writers quiesce and in-flight calls are drained or cancelled inside the reserved deadline before the final snapshot. Shutdown signals are handled. A hard kill may leave only an earlier state. A final upload during shutdown is never the only copy.

Outcomes are `consensus`, `stopped_by_user`, `disconnected`, `failed`, `stalled`, `budget_wall_clock`, `budget_tokens`, `budget_cost`, `budget_connector`, `budget_storage`, `persistence_unavailable`, and `criteria_unmet`. Each one exposes the last valid artefact and the diagnostics.

### 7.5 Continuation

A child reads the parent's exact committed generation and the captures it is still authorized to read, after the parent's writer has stopped or been fenced. The parent is preserved. The child gets a fresh roster, empty votes, new budgets, new execution ownership, and a new assessment version when inputs change. Origin attribution remains the original run and the original agent or invocation.

The child clears votes, roster state, leases, and watchdogs. A done task is reused only when its semantic inputs, assessment, and freshness are still valid. An old CEO lookup is not permanently done. Qualification against yesterday's pain does not satisfy today's different question.

Authorized immutable source observations, invocation provenance, and historical assertions are retained. Current pain-fit, exclusions, contact relevance, and signal windows are reassessed. Old conclusions are marked historical until they are recomputed. Failed and pending work is revalidated against the child's objective and enabled connectors. A missing connector you now need is an explicit gap. The child does not call it without authorization, and it does not silently substitute another source.

| What you change | What the child does |
|---|---|
| Objective, pain, or universe | Keeps source observations. Reassesses fit, contacts, and semantic conclusions under the new objective. Historical assessments do not count as current. |
| Criteria or threshold | Clears votes. Recomputes deterministic predicates. |
| Agent count or subsets | Builds a new roster within 5 to 100 and validates each tool subset. |
| Connector selection | Revalidates current rights. A disabled connector cannot be called. Shows whether inherited evidence you may still read remains usable. |
| Date window or freshness | Allows expired lookups to run again. Reuses captured data where it is still sufficient. |
| Exclusions | Re-evaluates inherited entities, records reasons, and omits them from qualification denominators. History is not deleted. |
| Budgets | Applies fresh limits for this run and shows spend along the ancestry path. Sibling branches are a separate lineage total. |

Primary free text is versioned in the child and can be revised without modifying parent prose. Replaceable derived projections are recomputed.

The stream acknowledges acceptance, then loads the parent topology and details for the first paint while typed restore runs. Agents start only after restore, policy checks, and pending source captures are complete. Restore latency is measured. It is not asserted from a record count.

## 8. Interface

### 8.1 Setup

The setup screen contains the profile or brief, the universe, the exclusions, the completion criteria, the swarm size, the consensus percentage, and explicit time, cost, and source limits. It displays the reading of numeric criteria and the denominator.

The connector picker lists every accessible tenant connector instance with its name, provider, whether the read is live or a query over ingested data, data freshness, account and scope, and availability. You enable or disable instances individually, including several accounts of one provider. Web search starts selected when you can use it, and you can turn it off. A missing capability, a missing permission, and missing credentials have distinct explanations. An unsupported connected type stays visible. An ingestion query is not labelled as fresh upstream data.

By default every agent uses the selected set. An advanced control can narrow an agent's access. It cannot widen it past the run selection. Provider budget caps and the access implications of private sources are shown. Configuration is fixed at launch. Emergency disable and revocation block further reads. Continuing creates a child with a revised selection.

A creation error leaves the setup editable. An idempotent retry returns the existing run. Source and schema preflight, and durable acceptance, have their own progress state before the execution stream reports that it is ready.

### 8.2 Live screen

Agent trace panels ring the viewport. The live graph sits in the centre: primary entities, notes, and source chunks. Along the bottom you have source filters, progress and gaps, votes, spend, and Stop.

The live renderer is Cosmos, using the platform graph colour functions. Category is shown by shape, icon, and label as well as by colour. Entity type and note kind may refine grouping. They do not replace the category.

Filters cover all three categories, connector and provider, date, confidence, and relation meaning. Source chunks join the live graph as soon as they are committed. A dense source set can be collapsed to an explicit count and an expandable source layer. It is not discarded. A topology summary is a view. It is not a fourth stored category.

A source-context edge and an evidence-support edge look different. Polarity and uncertainty are displayed. "Retrieved for Acme" does not look like "proves Acme has this pain." A contradiction view uses validated assertion relations.

### 8.3 Reading a node

| What you select | What the panel shows |
|---|---|
| Primary entity | Tenant typed fields and the selected values, then that entity's own free-text section, history and conflicts, and linked notes. |
| Note | Authored markdown, editorial and semantic type, confidence, provenance, revisions, and linked entities. |
| Source chunk | The passage or record that was actually returned, the connector, the invocation and query, the locator, publication, event, and fetch dates, whether it is a snippet or a full document, and the source offsets. |

Clicking a field or prose citation highlights the exact supporting span and shows the claim's polarity. You can open the captured snapshot and, where you are allowed, the original, as separate actions. An agent summary is not substituted for the source text. Private-source access is checked on detail and download. Changed or removed access is shown as restricted. Cached prose and passages are not leaked.

A source ledger lists every invocation, its status, its cost, the chunks it returned including unused ones, truncation and extraction issues, and uncertain matches. Empty and failed calls stay inspectable even though they create no content node. A returned result that no claim uses remains available here.

### 8.4 Streaming into the renderer

The browser uses an authenticated streamed execution response, parsed as server-sent events. Control and list calls use the platform API. The client renders a coherent snapshot and then sequenced application deltas. Replayed events are deduplicated. A missing sequence, or a resync requirement, fetches a new authorized snapshot and its cursor before continuing. A graph with missing edges is not accepted in silence.

Node indices and active views stay stable inside reusable buffers. Counts come from the real length of the arrays. Spare zero-filled capacity is not passed as actual points or links. Current simulation positions are kept when nodes are added. Original seeds are not re-uploaded for the existing graph. Setters go through the tested update path. Simulation pause, transition duration, and alpha are managed for the pinned renderer version. A position transition may pause the simulation.

Topology and visual updates are coalesced at most once per animation frame, including colours, widths, and sizes. Reusing a buffer does not remove GPU upload or force-layout cost. The client supports node and edge updates, deletes, entity merges, stub promotion, and replaced similarity edges. Active subarray or absent-slot behaviour is chosen from what has been tested. Compaction uses explicit ID remapping when it is required.

An edge whose endpoint has not arrived yet waits in a bounded queue, retries when the node arrives, and forces a resync if the queue expires or runs out of room. A valid edge is never dropped quietly. Source-capture bursts are a normal case. Tests include large connector responses alongside note updates, not only one-node increments.

On any terminal outcome the simulation stops after a bounded settle, and the saved revision is exposed. The browser's final coordinates may be uploaded as a separate view artefact keyed by graph revision. Research durability does not depend on that upload. A reopened view recomputes layout when no view artefact exists.

### 8.5 Camera

During a live run the view is not repeatedly fitted to the whole graph. Robust bounds of the visible points, the 2nd to the 98th percentile, are sampled on a measured cadence, initially 5 Hz, without a GPU readback and a sort on every frame. Camera position and log zoom animate with a critically damped spring on animation frames. A 2 percent deadband applies. Motion is capped at half a viewport per second and 0.8 zoom decades per second. Those tuning values are inputs to the acceptance tests. They are not a claim that they have already been measured in production.

Zero and empty spans, non-finite values, minimum and maximum zoom, and long frame gaps after a tab was suspended are guarded. The timestep is clamped and the camera resumes from its current state. Data bounds use the actual graph viewport after the ring and panel insets. Camera tests include expanding and collapsing the source layer.

Any pan or zoom you make hands control to you until you press Recenter. Focus is not taken back after a short idle. Focusing a node from search or from a trace sets the spring target without snapping. Reduced motion disables following and animated transitions. Explicit controls still move the viewport.

### 8.6 Trace ring

Panels are rounded rectangles with horizontal text. Positions are computed from the viewport and the panel dimensions. Corner collisions and the remaining graph area are validated. A 1920 by 1080 desktop may fit roughly 30 readable panels. Capacity is measured geometrically. It is not a fixed constant. On a narrow screen a drawer or a grid is used. Text is not shrunk until it cannot be read.

| Load | Presentation |
|---|---|
| Within measured capacity | One panel per agent, in a fixed place. |
| Moderate overflow | Compact two-line panels, if width and height still fit. |
| Large overflow | Visible agents rotate with a minimum four-second dwell, with pause and pin, and an explicit entry to the full grid. |

A panel shows the agent and task, the current connector operation, a sanitized query or action summary, the state, and the entity, note, or chunk it refers to. Clicking focuses that object. Secrets and hidden model reasoning are not shown. Every agent stays reachable in the grid. Recent activity does not starve an idle or failing agent.

Traces are buffered separately from committed graph deltas. One animation loop updates the visible panels, with a four-hertz repaint cap per panel and a bounded history. Losing a trace frame is acceptable. Source invocation history, the audit log, and graph topology remain authoritative and recoverable.

### 8.7 Exploration and exports

Cosmos stays the live engine. Sigma is the available exploration renderer, starting from the existing benchmark renderer. Local positions are preserved when you switch during a session. Reopening reloads a saved view artefact or computes a fresh layout. Both topology and details are required for the reading panel.

A companion site renderer may be evaluated on a time box if it becomes available. It is integrated only if it supports authenticated data, the three categories, primary free text, source inspection, the platform palette, and acceptable mount and performance. Delivery of Sigma exploration does not wait on it. A self-contained HTML export is private by default. It is never an automatic public deployment.

Explore provides search, focus, neighbourhood expansion, filters by type, category, and source, paths, regrouping by segment or capability, conflicting evidence, and weak or unresolved authored claims. A source chunk can be unused without being a research orphan. The source ledger shows it as captured material.

Exports include graph and details, a research interchange, and the vault and source artefacts. Partial output shows quality warnings. A failed gate does not make the last valid result inaccessible. Source-derived permissions, and safe markdown, HTML, and filenames, are enforced on every export.

### 8.8 Run list, stop, and continue

The list shows the objective, the connector selection, category counts, the age of the last durable checkpoint, the outcome, quality gaps, spend including unsettled reservations, and parent and child lineage. Stop writes a durable control flag and reports stopping, finalizing, and saved.

After a lost stream, the screen shows status and the latest checkpoint. It does not claim the same worker can be reattached within 60 seconds. Continue becomes available after the parent is terminal or fenced. The dialog shows the inherited objective, criteria, threshold, agents, budgets, exclusions, and connector selection, a summary of what you are changing, and whether authorized evidence from disabled connectors will be reused. Revoked evidence cannot be selected. You can preview the inherited graph before restored execution starts.

### 8.9 Accessibility

Keyboard-accessible tables cover all three categories, relations, source invocations, and votes. Progress is announced through one summary live region, not one region per agent. Status is never colour alone. Reduced motion disables camera following and ring rotation, and manual pagination is available.

Tests cover desktop and mobile, returning from a background tab, errors, zero nodes, a very narrow graph, permissions, resync, and 100 agents. Growing graphs are benchmarked at a realistic total. Two hundred companies with 6 to 12 authored objects can already exceed 1,200 to 2,400 nodes before captured sources are counted. Tests include multi-result connector bursts and explicit graph and source-layer filters. A static graph benchmark is a baseline. It does not prove continuous-update performance.

### 8.10 What you can export

**Renderer and details.** The topology projection includes every required link field: source object type, target object type, edge family, relation and kind, weight, and endpoints. Primary entities and notes use the renderer's entity node kind. Chunks use the chunk node kind. A research category travels in the versioned detail envelope so notes and primary entities stay distinct. Cross-category edges map onto the existing chunk and entity edge families.

Topology and details are separate. Details carry typed fields, primary prose, note bodies, chunks, evidence references, and source access metadata. Authorized detail APIs and exports load both. Topology alone is not a complete exploration artefact. Browser layout positions are an optional view artefact, keyed by revision, uploaded on a best effort. Missing positions trigger a client layout. They never block durable completion.

**Vault.**

- Primary people and organisations export once into their matching folders, with typed fields and their free-text section. Other primary types have a stable folder mapping.
- Standalone authored notes use the nine editorial folders. Filenames include a stable disambiguator where one is needed. Aliases stay readable.
- Source chunks export as their own folder of markdown, text, and JSON, marked as source chunks, with invocation and source identity, dates, and links. A generated summary does not replace raw content. Raw payloads and binaries stay in a source artefact directory.
- A start page, a provenance and limitations section, and a source ledger link the exported material. Provenance navigation does not turn an unused chunk into a research finding.
- Paths and HTML are sanitized. References and access restrictions are preserved. Validation runs after navigation is generated. Export is not an identity function for arbitrary payloads.

**Built-in CRM delivery.** Successful consensus and deterministic gates automatically transfer every company and person primary entity from the final committed graph revision into the application CRM. Candidates, rejected or excluded records, and people without a confirmed employer retain their research verdicts and gaps. Stable CRM identities merge only on strong identifiers; same-name entities remain separate. Durable source mappings preserve the original graph, prose, typed fields, provenance, and relationships. Transfer state (pending, ready, failed) and reconciled entity counts are separate from research completion. Database transactions make delivery independent of an open browser, and failed transfers can be retried without rerunning research. CRM workflow edits are stored separately and survive re-import. Ownership and current source access govern reads. Stopped, failed, and budget-limited runs remain inspectable partial research and are not successful CRM transfers. This built-in CRM handoff does not authorize external CRM writes, outreach, or canonical platform promotion.

**Platform interchange.** A versioned research-candidate stream, assertions, chunk and source records, and relation records are exported. A separate promotion adapter maps candidate names, field-definition IDs, chunk provenance, owner and access, and canonical resolution. Automatic writes into canonical platform entities are deferred.

**Restorable state.** The typed codec preserves record IDs, the distinction between datetime and date, and relations. Restore applies the frozen schema and the nodes, then the relations with typed endpoints, the operational records, and pending durable captures. Traversal results are verified. JSON equality alone is not enough.

## 9. Runtime, cost, and safety

| ID | Requirement |
|---|---|
| R-1 | Research compute scales to zero. There is no dedicated always-on research database. Stored artefacts, provider calls, and existing platform services still have their own costs. |
| R-2 | The target is a median under 1.5 seconds to the first acknowledged event. The 95th percentile, time to a ready graph, and time to the first useful research result are measured separately. The target stands only once it has been measured. |
| R-3 | Static prompts, translator code, bytecode, and dependency audits are prepared at build time. Tenant schema, permissions, credentials, and your prompt inputs are resolved at runtime. |
| R-4 | Each run's embedded database and tasks are closed explicitly when execution ends. A warm instance may serve a later run. |
| R-5 | Each run shows its money and credit caps and a cost-policy version. No fixed price is promised before provider-specific measurement. |

### 9.1 Where the work runs

The browser talks to the platform control API, which uses the existing platform database for the run catalogue, permissions, idempotency, the execution lease, the stop flag, and quotas. An authenticated streamed execution request reaches a research worker. That worker runs 5 to 100 asynchronous agents, the connector read tools you selected, a validated graph writer, an embedded database for that run, and a committed event log that feeds the stream.

Connector responses go to a durable capture journal and blobs, then to source chunks, then to the graph writer. Checkpoints go to private object storage as generations, with a manifest pointer. Explore and export read an authorized committed generation.

The control API is the existing platform database. It is not a new always-on research database. The research graph lives in a run-scoped embedded store and in immutable checkpoints. Control metadata is small and transactional. It owns authorization, selection, execution fencing, reservations, and catalogue queries.

All agents share the graph through typed read and write tools. Model calls and connector IO run concurrently. Short graph mutations pass through one write coordinator. No network call and no model inference holds that lock. A transaction writes graph changes, task effects, and a sequenced event record together. Events are published only after commit.

### 9.2 Worker lifecycle

Initial service settings: minimum instances 0, maximum instances 20, request concurrency 1, request timeout 55 minutes. Benchmark 4 vCPU and 4 GiB with startup CPU boost, and treat those sizes as a starting point to measure, not as a proven requirement. CPU is allocated for the request while the streamed request is active, and it is not throttled between stream frames on an open request. An idle instance may stay warm and serve a later run. Database handles, clients, tasks, and credentials are closed explicitly between runs.

The default run wall clock is 30 minutes, with a separate bounded reserve for finalization. The server rejects a limit you set that cannot leave that reserve under the service timeout. Source storage and provider costs remain when research compute scales to zero. Same-instance reconnection is not promised. Session affinity is best effort.

### 9.3 Database

The initial engine is the pinned embedded database, behind a storage interface. Before release, prove it on the Linux runtime: wheel availability, connection lifecycle, query-level atomicity, typed restore, and concurrent operation. The event stream comes from application events after commit. The product does not depend on a live query subscription inside the embedded engine. If a required capability fails that proof, a sidecar speaking over a socket sits behind the same storage interface, and its cost is measured. The product contract stays the same.

Every graph transaction receives a monotonic graph revision and an ordered event sequence. Events include node and edge create, update, and delete, identity remapping, and category and detail changes. The stream sends a revisioned snapshot and then events after the client's cursor. If a bounded queue overflows, the server emits a resync requirement and supplies a coherent new snapshot. Trace messages may be lossy. Graph changes may not be.

One process still needs concurrency control, transactional task effects, and lease fencing. A coherent database cut is frozen under the writer barrier for a checkpoint, and the upload happens outside the lock. Copy and memory cost are part of the benchmark. Temporary disk on the worker uses instance memory, so switching the engine to a file in that temporary disk does not solve running out of RAM.

### 9.4 Authorization

A validated tenant and user scope comes from platform authentication. Every start, read, stop, download, and parent continuation checks it. A run ID or an object path does not grant access. The worker uses an authenticated, bounded execution envelope. The model never controls tenant identity, credential references, run ownership, or which tools are registered.

Schema and catalogue pages are read in full. The tenant schema is resolved at runtime, cached durably by tenant and schema hash, and frozen with the run. Prompts are instantiated with the current brief, the criteria, and the enabled capabilities. Schema and capability preflight happens before paid work.

New source access can only narrow who may read a run. A conservative version-one read requires permission for every source dependency in the artefact. Revocation and retention deletion apply to chunks and to derived content across descendants.

Chunks, notes, and primary entities use the same validated writer. Render and export paths are sanitized. Query values are parameterized. Storage identifiers are validated. Source URL fetches are restricted against private and internal destinations and against unsafe redirects. Connector content is untrusted evidence. It is not authority to change the tools, the spend policy, or the schema.

### 9.5 Models and shared quotas

The model client is the provider SDK, with pooled clients. Connector transports are pooled, with metering per invocation. Client constructors may be reused. Credentials are not reused across tenants.

Shared provider and credential quotas and reservations live behind the control API, so two concurrent runs cannot each spend the same remaining allowance. Model, connector, evaluator, retry, fetch, extraction, and optional embedding calls all reserve before dispatch. Requests carry bounded outputs and deadlines. Cancellation does not assume the provider refunded the call.

### 9.6 Cold start

Prepared at build time: static prompt templates, schemas for tool outputs, schema translator code, compiled bytecode, a slim image, and an import audit. Resolved at runtime: identity, which tenant snapshot to use, your prompt inputs, clients, credentials, source permissions, and restore. Live sockets and TLS sessions cannot be baked into an image.

Measure, separately, median and 95th percentile time to the first acknowledged event, schema and cache-miss delay, time until the graph is ready, time to the first useful result, completion time, and peak memory. Admission latency and initial durability latency are reported too. No phase split and no framework-overhead claim is accepted without a reproducible benchmark on the Linux service.

### 9.7 Boundaries

Interactive version one stops when the execution stream is lost. Checkpoints let you continue. They do not provide transparent reattachment. A second viewer reads authorized committed checkpoints. Memory limits include source content, snapshot copies, and event queues. Storage and byte caps prevent unbounded capture. A later job-backed executor may outlive the browser, behind the same control and artefact contracts. That later executor still needs fencing, source access control, and budgets.

## 10. Release proofs

These proofs come before a large paid swarm. A visible unsupported connector is a gap to close.

**Interfaces.** Pin the database engine, the model endpoint, the live renderer version, and the source capability versions. Prove embedded create, read, update, and delete, generated field shapes, query-level atomic mutation, valid priority claims, and typed relation restoration, using application events. If a required capability fails, prove the sidecar fallback behind the same interface. Prove two conflicting tenant schemas can run in the same warm process without sharing state. Prove pagination, permissions, and schema snapshot persistence. Inventory every supported tenant connector type and name the missing bridges. Prove the authenticated streamed execution, disconnect, stop, timeout, idempotent start, and the execution fence. Control endpoints do not depend on worker affinity. Prove source capture before a model sees the content, and crash replay into the graph. Spike growing renderer buffers, position preservation, and update and delete.

**One agent, one brief.** Primary tables inherit tenant fields and support an explicit partial state. Each primary entity has versioned free text. Standalone notes use the editorial types. Source chunks preserve returned data, source IDs, times, offsets, and invocation associations. Retrieval context, resolved mentions, and per-assertion evidence link to primary entities and notes. Typed semantic assertions preserve negation, dates, and conflicting evidence. Strong identifiers and aliases resolve safely, and stub binding and merges do not create duplicates. You can inspect a primary entity's prose, a separate note, and the original supporting chunk, and every returned result is accounted for, including unused ones.

**A controlled swarm.** The catalogue and picker work by instance ID, with a run allowlist and optional per-agent subsets. Read routes cover the advertised connector matrix. Clients are pooled. Each call is authorized. Provider and shared-credential rate limits hold. Money and credit reservations are atomic, and unknown charges are reconciled. Queues are fair. Task dedupe is semantic. Leases renew. Commits are fenced. Gap tasks are reserved for no voters. Evaluation epochs use a fixed revision and the configured-roster denominator. Go-to-market gates are computed. Saturation, the useful-progress watchdog, budget outcomes, and manual stop are distinct. Twenty agents run a real brief within the stated caps and produce either an inspectable completion or an honest unmet-criteria result. A disabled tool cannot be invoked.

**Durable control.** The run catalogue and object-storage generations exist, with local storage kept as a test backend. Initial state is durable before acceptance and before paid dispatch. Graph snapshots are coherent. Restore is typed. The capture journal replays. The generation pointer is checksummed. The catalogue is reconciled after an interrupted commit. Freeze, cancel, drain, and finalize run under bounded deadlines. A child continues with inherited schema and provenance, revalidated access, invalidation of tasks whose objective changed, stale-source handling, and connector reselection. Source restriction, revocation, and retention hold across details, downloads, and descendants. Kill a run at each critical boundary, restore it with a later build, and continue with a new pain, time window, and connector set. The parent does not change. Revoked private evidence does not leak through generated prose or an inherited export.

**Cloud execution.** The worker scales to zero, with request concurrency 1, request-based CPU allocation, private invocation, a bounded timeout, private object storage, and service identities. Collect reproducible cold and warm measurements: admission, first event, graph ready, first result, median and 95th percentile, peak memory, capture and checkpoint overhead, and rate-limit behaviour. Measure provider, model, evaluator, and source costs at 20 agents and then at 100. Publish calibrated default caps. The 1.5 second first-event median remains a target until the measurement exists.

**Live graph.** Sequenced snapshots and deltas, bounded queues, deduplication and resync, and update, delete, and merge. Three-category styling and filtering, the source ledger, typed fields plus free text, note reading, exact span highlighting, and restricted content. Correct active buffers, preserved live positions, and the camera spring. Representative multi-connector runs render continuously without phantom nodes, lost edges, or seed-position resets. Test thousands of nodes.

**Setup, traces, and the run list.** Complete connector setup and preflight, capability and freshness labels, roster subsets, and budgets. A readable trace ring with measured capacity, a minimum dwell, pin and pause, an overflow grid, and a mobile drawer. Accessible tables, keyboard controls, and reduced motion. Stop, status, finalization, and recovery. The continue dialog includes connectors, the inherited-evidence policy, and the changed objective, criteria, threshold, and agent count. You configure sources, watch 100 agents, inspect chunks, stop a run, and continue it without typing a run ID and without crossing a permission boundary.

**Explore and export.** The alternative renderer supports search, the source and detail panel, focus, regroup, and contradiction views. The research interchange and the vault export include entity prose, notes, source chunks, raw payload artefacts, the source ledger, and final quality diagnostics. The promotion adapter has a contract and fixtures. Automatic promotion waits. Private export authorization and sanitization hold, and all three categories survive a round trip. You can inspect or download a completed or partial run without a research worker. A missing layout, or a failed optional quality metric, does not hide the saved artefact.
