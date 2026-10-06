import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { Tables } from "@/integrations/supabase/types";
import type { readCrmRecord } from "@/lib/crm-detail.server";

const mocks = vi.hoisted(() => ({ query: vi.fn(), refetch: vi.fn(), readRecord: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQuery: mocks.query }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/crm-detail.functions", () => ({ getCrmRecord: mocks.readRecord }));
vi.mock("@/components/AppHeader", () => ({ AppHeader: () => <header>App header</header> }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({
    options,
    useParams: () => ({ key: "crm-person" }),
    useRouteContext: () => ({ user: { id: "owner" } }),
  }),
  Link: ({
    children,
    to,
    params,
    ...props
  }: {
    children: ReactNode;
    to: string;
    params?: Record<string, string>;
  }) => (
    <a
      href={params ? to.replace(/\$([^/]+)/g, (_, key: string) => params[key] ?? "") : to}
      {...props}
    >
      {children}
    </a>
  ),
}));
import { Route } from "@/routes/_authenticated/leads.$key";
const Page = Route.options.component!;
type Detail = NonNullable<Awaited<ReturnType<typeof readCrmRecord>>>;
const timestamp = "2026-10-06T10:00:00Z";
function detail(): Detail {
  return {
    record: {
      id: "crm-person",
      user_id: "owner",
      entity_type: "person",
      identity_key: "source:person",
      origin_run_id: "run",
      title: "Alex Example",
      fields: { role: null, email: null },
      free_text: null,
      confidence: null,
      created_at: timestamp,
      updated_at: timestamp,
    },
    sources: [],
    runs: [],
    links: [],
    assertions: [],
    nodes: [],
    crmIds: {},
    evidenceCount: 0,
    contactCount: 0,
  };
}
function node(patch: Partial<Tables<"nodes">>): Tables<"nodes"> {
  return {
    id: "chunk",
    run_id: "run",
    category: "source_chunk",
    title: "Captured company page",
    fields: {},
    content: "Before exact evidence after.",
    confidence: null,
    connector: "web_search",
    provider: "Search",
    locator: "https://example.org/source",
    is_snippet: true,
    provenance: "research",
    revision: 1,
    aliases: [],
    content_hash: null,
    created_at: timestamp,
    created_by_agent: null,
    editorial_type: null,
    entity_type: null,
    event_at: null,
    fetched_at: timestamp,
    free_text: null,
    invocation_id: null,
    published_at: null,
    semantic_kind: null,
    ...patch,
  };
}
function assertion(evidence: Tables<"assertions">["evidence"]): Tables<"assertions"> {
  return {
    id: "assertion",
    run_id: "run",
    owner_node_id: "person",
    claim: "An evidenced claim",
    evidence,
    field_key: "role",
    confidence: "medium",
    assessment_version: 1,
    created_at: timestamp,
    created_by_agent: null,
  };
}
function show(data: Detail | null) {
  mocks.query.mockReturnValue({ data, isPending: false, isError: false, refetch: mocks.refetch });
  return render(<Page />);
}
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("CRM record detail page", () => {
  it("shows a person without a confirmed employer or invented contact fields", () => {
    show(detail());
    expect(screen.getByRole("heading", { name: "Alex Example" })).toBeVisible();
    expect(screen.getByText(/No confirmed relationship recorded/)).toBeVisible();
    expect(screen.getAllByText("Unknown")).toHaveLength(2);
    expect(screen.getByText("No write-up recorded.")).toBeVisible();
    expect(screen.getByText(/No claims recorded/)).toBeVisible();
    expect(mocks.query).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["crm", "record", "owner", "crm-person"], retry: false }),
    );
  });
  it("links related company records by durable id while keeping employment timing qualified", () => {
    const data = detail();
    const company = node({
      id: "company-node",
      category: "primary_entity",
      entity_type: "company",
      title: "Acme",
      content: null,
    });
    data.links = [
      {
        node: company,
        edge: {
          id: "employment",
          run_id: "run",
          from_node: "person",
          to_node: company.id,
          relation: "works_at",
          polarity: null,
          rationale: "Observed role evidence",
          score: null,
          assertion_id: null,
          created_at: timestamp,
        },
      },
    ];
    data.crmIds = { "company-node": "stable-company" };
    show(data);
    expect(screen.getByRole("link", { name: "Acme" })).toHaveAttribute(
      "href",
      "/leads/stable-company",
    );
    expect(screen.getByText(/Employment timing is not verified/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Inspect relationship and evidence" })).toHaveAttribute(
      "href",
      "/runs/run",
    );
  });
  it("hides previously loaded record content after a denied refresh and offers retry", () => {
    mocks.query.mockReturnValue({
      data: detail(),
      isPending: false,
      isError: true,
      error: new Error("Source access restricted"),
      refetch: mocks.refetch,
    });
    render(<Page />);
    expect(screen.getByRole("alert")).toHaveTextContent("Source access restricted");
    expect(screen.queryByRole("heading", { name: "Alex Example" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });
  it("distinguishes unavailable records from loading", () => {
    mocks.query.mockReturnValue({ isPending: true });
    const view = render(<Page />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading record");
    mocks.query.mockReturnValue({ data: null, isPending: false, isError: false });
    view.rerender(<Page />);
    expect(screen.getByText(/This record is unavailable or you do not have access/)).toBeVisible();
  });
  it("does not render a missing evidence quote as a captured passage", () => {
    const data = detail();
    data.assertions = [
      assertion([
        { chunk_id: "restricted", quote: "Private unverified quote", polarity: "supports" },
      ]),
    ];
    const view = show(data);
    expect(screen.getByText("Supporting source unavailable or restricted.")).toBeVisible();
    expect(screen.queryByText("Private unverified quote")).not.toBeInTheDocument();
    expect(view.container.querySelector("mark")).toBeNull();
  });
  it("shows the real source without a false highlight when citation offsets are out of range", () => {
    const data = detail();
    data.nodes = [node({})];
    data.assertions = [
      assertion([
        { chunk_id: "chunk", quote: "exact evidence", start: 200, end: 214, polarity: "supports" },
      ]),
    ];
    const view = show(data);
    const disclosure = view.container.querySelector("details");
    disclosure?.setAttribute("open", "");
    expect(screen.getByText(/Citation offsets could not be verified/)).toBeVisible();
    expect(screen.getByText("Before exact evidence after.")).toBeVisible();
    expect(view.container.querySelector("mark")).toBeNull();
    expect(screen.getByRole("link", { name: "Open original source" })).toHaveAttribute(
      "href",
      "https://example.org/source",
    );
  });
  it("highlights only a verified exact captured span and keeps its evidence polarity", () => {
    const data = detail();
    data.nodes = [node({})];
    data.assertions = [
      assertion([
        { chunk_id: "chunk", quote: "exact evidence", start: 7, end: 21, polarity: "contradicts" },
      ]),
    ];
    const view = show(data);
    view.container.querySelector("details")?.setAttribute("open", "");
    expect(view.container.querySelector("mark")).toHaveTextContent("exact evidence");
    expect(screen.getByText("contradicts: Captured company page")).toBeVisible();
    expect(screen.getByText(/Captured search snippet/)).toBeVisible();
  });
});
