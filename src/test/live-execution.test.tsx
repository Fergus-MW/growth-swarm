import { act, cleanup, render, screen, within, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Route as liveRoute } from "@/routes/_authenticated/runs/$runId";

const boundary = vi.hoisted(() => ({
  snapshot: vi.fn(),
  events: vi.fn(),
  archive: vi.fn(),
  transfer: vi.fn(),
  changed: new Map<string, (event: { new: object }) => void>(),
}));
vi.mock("@/lib/crm-transfer.functions", () => ({
  getCrmTransfer: boundary.transfer,
  retryCrmTransfer: vi.fn(),
}));
vi.mock("@/lib/runs.functions", () => ({
  getRun: boundary.snapshot,
  stopRun: vi.fn(),
  executeWindow: vi.fn(),
  continueRun: vi.fn(),
  exportRun: vi.fn(),
}));
vi.mock("@/lib/leads.functions", () => ({
  getRunEvents: boundary.events,
  getAgentHistory: boundary.archive,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: () => {
      const channel = {
        on(_kind: string, filter: { table: string }, callback: (event: { new: object }) => void) {
          boundary.changed.set(filter.table, callback);
          return channel;
        },
        subscribe() {
          return channel;
        },
      };
      return channel;
    },
    removeChannel: vi.fn(),
    from: () => {
      const query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        order() {
          return query;
        },
        limit() {
          return query;
        },
        then(resolve: (data: { data: object[] }) => unknown) {
          return Promise.resolve({ data: [] }).then(resolve);
        },
      };
      return query;
    },
  },
}));

beforeEach(() => {
  boundary.changed.clear();
  boundary.transfer.mockResolvedValue({
    status: "ready",
    company_count: 0,
    person_count: 0,
    source_count: 0,
    created_count: 0,
    linked_count: 0,
    updated_at: "2026-10-06T12:00:00Z",
  });
  boundary.snapshot.mockReset();
  boundary.events.mockReset();
  boundary.archive.mockReset();
  boundary.archive.mockResolvedValue([]);
  boundary.events.mockResolvedValue([]);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function openRun(swarmSize = 100, nodes: object[] = []) {
  boundary.snapshot.mockResolvedValue({
    run: {
      id: "fixture",
      objective: "Synthetic live research",
      swarm_size: swarmSize,
      threshold: 0.7,
      status: "completed",
      outcome: "consensus",
      spend: 0,
      cost_cap: 5,
      stats: {},
    },
    nodes,
    edges: [],
    votes: [],
    invocations: [],
    lastCheckpoint: null,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <Outlet />
      </QueryClientProvider>
    ),
  });
  const auth = createRoute({
    getParentRoute: () => root,
    id: "_authenticated",
    beforeLoad: () => ({ user: { id: "fixture-user" } }),
    component: Outlet,
  });
  const route = createRoute({
    getParentRoute: () => auth,
    path: "/runs/$runId",
    component: liveRoute.options.component!,
  });
  const router = createRouter({
    routeTree: root.addChildren([auth.addChildren([route])]),
    history: createMemoryHistory({ initialEntries: ["/runs/fixture"] }),
  });
  render(<RouterProvider router={router} />);
  await act(() => router.load());
  return queryClient;
}

it("keeps a distinct inspectable panel for every configured agent on the live route", async () => {
  await openRun();
  const last = await screen.findByRole("article", { name: "Agent 100" });
  expect(screen.getAllByRole("article", { name: /^Agent / })).toHaveLength(100);
  const history = within(last).getByText(/Trace history/);
  history.click();
  expect(within(last).getByText("No activity recorded yet.")).toBeVisible();
});

function event(id: number, agent_index: number, kind: string, payload: object) {
  return { id, agent_index, kind, payload, created_at: "2026-10-06T12:00:00Z" };
}

it("loads beyond one durable page without losing quiet agents or duplicating realtime delivery", async () => {
  const quiet = event(1, 99, "task_done", { summary: "Quiet agent result" });
  const busy = Array.from({ length: 999 }, (_, index) =>
    event(index + 2, 0, "task_done", { summary: `Busy result ${index}` }),
  );
  boundary.events.mockImplementation(async ({ data }: { data: { after: number } }) =>
    data.after === 0
      ? [quiet, ...busy]
      : [
          event(1001, 99, "agent_voted", {
            epoch: 1,
            revision: 4,
            decision: "yes",
            rationale: "Evidence satisfies the brief",
          }),
        ],
  );
  await openRun();
  await waitFor(() =>
    expect(boundary.events).toHaveBeenCalledWith({ data: { id: "fixture", after: 1000 } }),
  );
  const last = await screen.findByRole("article", { name: "Agent 100" });
  await waitFor(() => expect(within(last).getByText("Trace history (2)")).toBeInTheDocument());
  act(() => boundary.changed.get("events")?.({ new: quiet }));
  expect(within(last).getByText("Trace history (2)")).toBeInTheDocument();
  act(() => within(last).getByText("Trace history (2)").click());
  expect(within(last).getByText("Quiet agent result")).toBeVisible();
  expect(within(last).getAllByText("Evidence satisfies the brief").length).toBeGreaterThan(0);
  expect(
    within(screen.getByRole("article", { name: "Agent 01" })).getByText("Trace history (100)"),
  ).toBeInTheDocument();
});

it("streams activity and keeps source actions connected to the existing inspector", async () => {
  await openRun(5, [
    {
      id: "source-1",
      category: "source_chunk",
      title: "Synthetic captured source",
      content: "Synthetic captured passage",
      locator: "https://example.invalid/evidence",
      aliases: [],
      fields: {},
      confidence: "high",
      provenance: "fixture",
    },
  ]);
  const panel = await screen.findByRole("article", { name: "Agent 01" });
  act(() =>
    boundary.changed.get("events")?.({
      new: event(1, 0, "search", {
        query: "Synthetic evidence query",
        status: "succeeded",
        results: 1,
        chunkIds: ["source-1"],
      }),
    }),
  );
  act(() => within(panel).getByText("Actions & results (1)").click());
  expect(within(panel).getAllByText("Synthetic evidence query").length).toBeGreaterThan(0);
  expect(within(panel).getAllByRole("button", { name: "Inspect source" }).length).toBeGreaterThan(
    0,
  );
  act(() =>
    within(within(panel).getByText("Actions & results (1)").closest("details")!)
      .getByRole("button", { name: "Inspect source" })
      .click(),
  );
  const inspector = screen.getByRole("region", { name: "Research inspector" });
  expect(within(inspector).getByText("Synthetic captured passage")).toBeVisible();
  expect(within(inspector).getByRole("link")).toHaveAttribute(
    "href",
    "https://example.invalid/evidence",
  );
  act(() => within(inspector).getByRole("button", { name: "Close research inspector" }).click());
  expect(screen.queryByRole("region", { name: "Research inspector" })).not.toBeInTheDocument();
  expect(screen.getByText("Completed", { selector: "header span" })).toBeInTheDocument();
});

it("browses older saved source actions without growing or replacing the live buffer", async () => {
  const rows = Array.from({ length: 102 }, (_, index) =>
    event(index + 1, 0, "task_done", { summary: `Recorded action ${index + 1}` }),
  );
  rows[0] = event(1, 0, "search", {
    query: "Earliest saved source action",
    status: "succeeded",
    results: 1,
  });
  boundary.events.mockResolvedValue(rows);
  boundary.archive.mockResolvedValue(rows.slice(0, 2));
  await openRun(5);
  const panel = await screen.findByRole("article", { name: "Agent 01" });
  await waitFor(() => expect(within(panel).getByText("Trace history (100)")).toBeInTheDocument());
  act(() => within(panel).getByRole("button", { name: "Browse older saved history" }).click());
  await waitFor(() =>
    expect(boundary.archive).toHaveBeenCalledWith({ data: { id: "fixture", agent: 0, before: 3 } }),
  );
  await waitFor(() => expect(within(panel).getByText("Trace history (2)")).toBeInTheDocument());
  act(() => within(panel).getByText("Actions & results (1)").click());
  expect(
    within(within(panel).getByText("Actions & results (1)").closest("details")!).getByText(
      "Earliest saved source action",
    ),
  ).toBeVisible();
  act(() =>
    boundary.changed.get("events")?.({
      new: event(103, 0, "task_done", { summary: "New live result" }),
    }),
  );
  expect(within(panel).getByText("Trace history (2)")).toBeInTheDocument();
  act(() => within(panel).getByRole("button", { name: "Latest activity" }).click());
  expect(within(panel).getByText("Trace history (100)")).toBeInTheDocument();
  expect(within(panel).getByText("New live result", { selector: "p.line-clamp-2" })).toBeVisible();
});
