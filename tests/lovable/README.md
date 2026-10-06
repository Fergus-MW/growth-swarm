This harness renders the current generated route tree and CSS. It invokes the real run validators, admission/start handlers, execution engine, event/history handlers and graph UI. Only external boundaries are replaced: RPC transport/auth context, Supabase auth/database, model and web search. The root shell/head is omitted to avoid external fonts and document nesting in a client-only test.

All users, runs, sources, model responses and errors are synthetic. No cloud authentication, Supabase/RLS, paid model/search calls or deployments are verified. Browser tests abort non-localhost requests. The aliases apply only to this separate test configuration; the production configuration is unchanged.

Run browser checks:

```sh
npx playwright test --config playwright.lovable.config.ts
```

Run the fixture itself's contract checks:

```sh
npx tsx --test tests/lovable/fixture-db.test.ts
```

For manual fixture inspection, run `npx vite --config tests/lovable/vite.config.ts` and open `http://127.0.0.1:4186/setup`. Query `?fixture=slow` delays the synthetic model for Stop checks; `?fixture=voter-error` fails synthetic evaluators. `/runs/fixture-archive?fixture=archive` seeds 125 saved events for Agent 100. These scenarios live only in memory in this test page.
