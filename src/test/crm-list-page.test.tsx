import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CrmListRecord } from "@/lib/crm-list";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  navigate: vi.fn(),
  search: {} as { kind?: "company" | "person"; runId?: string },
  refetch: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: mocks.query }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/crm-list.functions", () => ({ listCrmRecords: vi.fn() }));
vi.mock("@/components/AppHeader", () => ({ AppHeader: () => <header>App header</header> }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => () => ({
    useRouteContext: () => ({ user: { id: "user-a" } }),
    useSearch: () => mocks.search,
    useNavigate: () => mocks.navigate,
  }),
  Link: ({
    children,
    to,
    params,
    ...props
  }: {
    children: React.ReactNode;
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
import { LeadsPage } from "@/routes/_authenticated/leads.index";

const record: CrmListRecord = {
  id: "stable-id",
  entityType: "company",
  name: "Acme",
  website: null,
  location: null,
  size: null,
  role: null,
  email: null,
  phone: null,
  profile: null,
  gaps: [],
  verdicts: [{ runId: "run", value: "excluded" }],
  related: [],
  runs: [{ id: "run", objective: "Test research" }],
  stage: "new",
  starred: false,
  createdAt: "2026-01-01",
};
beforeEach(() => {
  mocks.search = {};
  mocks.query.mockReturnValue({
    data: [record],
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: mocks.refetch,
  });
});
afterEach(cleanup);

describe("CRM page", () => {
  it("scopes its cache to the signed-in user and links to the stable CRM record id", () => {
    render(<LeadsPage />);
    expect(mocks.query).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["crm", "list", "user-a"] }),
    );
    expect(screen.getByRole("link", { name: "Acme" })).toHaveAttribute("href", "/leads/stable-id");
    expect(screen.getByRole("table")).toHaveAccessibleName(/Companies from completed research/);
    expect(screen.getByRole("region")).toHaveAttribute("tabindex", "0");
    expect(screen.getByText("Website unknown")).toBeVisible();
  });
  it("keeps unknown-employer people visible with missing contacts explicit", () => {
    mocks.search = { kind: "person" };
    mocks.query.mockReturnValue({ data: [{ ...record, entityType: "person", name: "Sam" }] });
    render(<LeadsPage />);
    expect(screen.getByRole("link", { name: "Sam" })).toBeVisible();
    expect(screen.getByText("Employer unknown")).toBeVisible();
    expect(screen.getByText("Email unknown")).toBeVisible();
    expect(screen.getByText("Role unknown")).toBeVisible();
  });
  it("distinguishes no filter matches from no records and can reset filters", () => {
    render(<LeadsPage />);
    fireEvent.change(screen.getByRole("textbox", { name: "Search CRM records" }), {
      target: { value: "missing" },
    });
    expect(screen.getByText(/No records match these filters/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("link", { name: "Acme" })).toBeVisible();
  });
  it("shows loading, empty and read error states separately with retry", () => {
    mocks.query.mockReturnValue({ isPending: true });
    const view = render(<LeadsPage />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading CRM records");
    mocks.query.mockReturnValue({ data: [], isPending: false });
    view.rerender(<LeadsPage />);
    expect(screen.getByText(/No companies from completed research/)).toBeVisible();
    mocks.query.mockReturnValue({ isError: true, isPending: false, refetch: mocks.refetch });
    view.rerender(<LeadsPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load CRM records");
    expect(screen.queryByText(/No companies from completed research/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.refetch).toHaveBeenCalled();
  });
  it("paginates keyboard-accessible links while totals cover every fetched record", () => {
    mocks.query.mockReturnValue({
      data: Array.from({ length: 105 }, (_, index) => ({
        ...record,
        id: `record-${index}`,
        name: `Company ${String(index).padStart(3, "0")}`,
      })),
    });
    render(<LeadsPage />);
    expect(screen.getByText("1–50 of 105 matching records (105 total)")).toBeVisible();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("51–100 of 105 matching records (105 total)")).toBeVisible();
    expect(screen.getByRole("link", { name: "Company 050" })).toHaveAttribute(
      "href",
      "/leads/record-50",
    );
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("101–105 of 105 matching records (105 total)")).toBeVisible();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });
});
