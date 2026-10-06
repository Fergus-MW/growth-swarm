# Welcome to your Lovable project

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Local Supabase demo

The local app uses the Supabase settings in the ignored `.env.local` file. Start the database with `npx supabase start -x storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor`, then run `npm run dev:local` and open http://127.0.0.1:8080/auth.

Sign in with `demo@example.test` / `GrowthSwarm-demo-2026!`. Run `npm run seed:local` to add the fictional fixtures again; existing fixture records and passwords are preserved. The seed only accepts a loopback database URL and includes two research runs, six company leads, contacts, source snippets, claims, votes, and CRM stages. No external research calls are made.

Set `VITE_DEV_LOGIN_BYPASS=true` in `.env.local` to enter the demo account automatically, including from `/`, `/auth`, and protected links. This only works in development when both the browser and Supabase use loopback URLs. Existing sessions are preserved. Set the flag to `false` and sign out to test the normal login flow; production builds always require normal authentication.

The `.env.local` file must define `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_PUBLISHABLE_KEY` using the local values from `npx supabase status`. Both public key settings use the local anon key; the service role key must never have a `VITE_` prefix. Node.js 24 or newer is recommended.

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS

# Standalone research app

A standalone local research swarm implementing the interactive workflow in [PRD.md](PRD.md), scoped to **Tavily web search only**. React interface, Cosmos live graph, Sigma exploration, OpenAI structured research, and a local SQLite control and research store. No platform account, remote database, or cloud deployment is needed.

## Run locally

Use Node.js 24 LTS or newer (the embedded `node:sqlite` API is required).

```sh
npm install
npm run dev:legacy
```

Open **http://127.0.0.1:5173**. The API binds to loopback on port 3001. If port 5173 is occupied, run `WEB_PORT=5174 npm run dev:legacy` and open that port. The default demo mode runs a clearly labeled fictional corpus through the same scheduler, capture, writer, gates, checkpoint, and export paths, without external calls. Demo results are not real leads. The default 50-company criteria intentionally remain unmet by the small fixture; the application does not lower them to manufacture consensus.

For live research, copy `.env.example` to `.env`, set `TAVILY_API_KEY`, `OPENAI_API_KEY`, an available `OPENAI_MODEL`, and explicit conservative per-call cost ceilings. Restart the API and select **Live research**. The default model (`gpt-4.1-mini`) is checked against the OpenAI models endpoint before admission; an unavailable model is rejected, never silently substituted. No live searches or model generations are made during tests. Search-only scope means passages are Tavily snippets, not fetched full pages.

```sh
npm run build:legacy
npm run start:legacy
```

The built application is served at **http://127.0.0.1:3001**. Local state stays in `.data/` (or `DATA_DIR`) and is ignored by Git. A local browser session, loopback Host checks, and Origin checks protect the development API. This is a single-user development service; do not expose it publicly.

## Workflow

1. Review the objective, universe, exclusions, measurable criteria, roster, consensus denominator, and explicit time, money, request, and storage limits.
2. Start a demo or live run. Execution belongs to the browser's streamed request. Inspect the three node categories, agent activity, exact captured passages, source ledger, deterministic gates, and votes.
3. Stop manually or let criteria, limits, or lack of progress end the run. Closing the stream cancels dispatch. Reopen the saved run to inspect its partial result.
4. Continue a terminal run as a child with new inputs. Parent observations remain attributed, objective-dependent assessments are recomputed, and the parent checkpoint is preserved.
5. Download JSON research interchange/restorable state, a Markdown vault ZIP with source artifacts, or a private self-contained HTML report. Nothing is published or sent to prospects.

## Implementation

- `shared/types.ts`: versioned graph, schema, task, evidence, run, and stream contracts.
- `server/store.ts`: transactional SQLite state and events, idempotent admission, execution fencing, lossless capture journal, checksummed immutable checkpoint generations, recovery, and child creation.
- `server/engine.ts`: bounded fair task queues, atomic claims and leases, independent async agents, source capture before model input, validated atomic result commits, fixed-revision evaluation, and configured-roster quorum.
- `server/model.ts`: OpenAI chat completions with strict JSON schema for research and independent evaluation. Models propose authored changes; they cannot create source chunks or change run limits.
- `server/connectors.ts`: Tavily search and an isolated fictional fixture. Source URLs are not fetched by the server. Credentials never enter model prompts or exports.
- `server/validation.ts`: typed fields, exact evidence offsets and hashes, semantic endpoint integrity, identity checks, source accounting, and go-to-market criteria.
- `server/export.ts`: sanitized, stable vault filenames, provenance, source ledger, topology and details, quality diagnostics, and complete original captured text.
- `web/`: setup, run history, live and exploration graphs, responsive agent activity, accessible tables, evidence details, and export controls.

Local SQLite commits use `BEGIN IMMEDIATE`; a short synchronous transaction covers claims and accepted result state. External calls happen outside that transaction. A checkpoint writes and syncs immutable state and manifest before atomically publishing `current.json`. Source response artifacts and descriptors are synced before graph registration or model use. An interrupted execution is fenced on restart and can only continue under a new child run.

One live run may execute at a time, preventing simultaneous runs from independently spending the same local provider allowance. Money is accounted at configured conservative per-call ceilings, including evaluations; these values are **not measured provider bills**. Unknown or cancelled usage stays reserved. Exact provider invoice reconciliation and distributed shared-account quotas are outside the local backend.

## Verification and release scope

```sh
npm run test:legacy
npm run typecheck:legacy
npm run build:legacy
npm audit
```

Tests exercise evidence tampering, typed fields, same-name identity, source completeness, dated signals, contact requirements, independent-origin qualification, lease fencing, fixed-roster quorum, budget enforcement, stop/disconnect, durable recovery, idempotency, immutable continuation, and safe exports. Browser integration tests can be run with `npm run test:e2e:legacy` after installing Chromium (`npx playwright install chromium`).

This repository provides a runnable local implementation, not the PRD's cloud release certification. Real provider structured output, live research quality and prices, 20/100-agent paid runs, Linux/cloud cold-start measurements, and continuous rendering at thousands of nodes require credentials and dedicated benchmarks. The PRD's platform tenant catalogues, ACLs, arbitrary connector types, cloud storage, canonical entity promotion, and scale-to-zero deployment are excluded by the standalone Tavily-only scope. See [IMPLEMENTATION.md](IMPLEMENTATION.md) for verification status and remaining limits.
