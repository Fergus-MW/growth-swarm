import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { CrmHandoff } from "./CrmHandoff";

const api = vi.hoisted(() => ({ read: vi.fn(), retry: vi.fn() }));
vi.mock("@/lib/crm-transfer.functions", () => ({
  getCrmTransfer: api.read,
  retryCrmTransfer: api.retry,
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    search,
    children,
  }: {
    to: string;
    search: { runId: string };
    children: ReactNode;
  }) => <a href={`${to}?runId=${search.runId}`}>{children}</a>,
}));

const transfer = {
  run_id: "run",
  user_id: "user",
  status: "ready",
  updated_at: "now",
  source_count: 4,
  company_count: 2,
  person_count: 2,
  created_count: 3,
  linked_count: 1,
  failed_count: 0,
  error: null,
};
function mount(status = "completed", outcome = "consensus") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidated = vi.spyOn(client, "invalidateQueries");
  const view = render(
    <QueryClientProvider client={client}>
      <CrmHandoff runId="run" userId="user" status={status} outcome={outcome} />
    </QueryClientProvider>,
  );
  return { ...view, client, invalidated };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  api.read.mockResolvedValue(transfer);
});

describe("completed research CRM handoff", () => {
  it("links directly to the completed run's CRM and refreshes the user list", async () => {
    const { invalidated } = mount();
    expect(await screen.findByText("CRM ready · 2 companies · 2 people")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open in CRM" })).toHaveAttribute(
      "href",
      "/leads?runId=run",
    );
    expect(screen.getByText(/3 new CRM records · 1 linked/)).toBeInTheDocument();
    await waitFor(() =>
      expect(invalidated).toHaveBeenCalledWith({ queryKey: ["crm", "list", "user"] }),
    );
  });

  it("does not call transfer APIs or show success for a partial run", () => {
    const { container } = mount("ended", "budget_cost");
    expect(container).toBeEmptyDOMElement();
    expect(api.read).not.toHaveBeenCalled();
  });

  it("shows pending progress without claiming records are ready", async () => {
    api.read.mockResolvedValue({ ...transfer, status: "pending" });
    mount();
    expect(await screen.findByText("Preparing CRM records…")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open in CRM" })).not.toBeInTheDocument();
  });

  it("retries only the failed transfer and opens the completed result", async () => {
    api.read.mockResolvedValueOnce({ ...transfer, status: "failed", failed_count: 4 });
    api.retry.mockResolvedValue(transfer);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Retry CRM transfer" }));
    expect(await screen.findByRole("link", { name: "Open in CRM" })).toBeInTheDocument();
    expect(api.retry).toHaveBeenCalledExactlyOnceWith({ data: { runId: "run" } });
  });

  it("keeps a retry failure visible without discarding research", async () => {
    api.read.mockResolvedValue({ ...transfer, status: "failed", failed_count: 4 });
    api.retry.mockRejectedValue(new Error("Connection lost"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Retry CRM transfer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Connection lost");
    expect(screen.getByText(/Your completed research is still available/)).toBeInTheDocument();
  });

  it("shows an honest zero-entity result and restores ready state on another visit", async () => {
    api.read.mockResolvedValue({
      ...transfer,
      source_count: 0,
      company_count: 0,
      person_count: 0,
      created_count: 0,
      linked_count: 0,
    });
    const first = mount();
    expect(await screen.findByText(/contains no companies or people/)).toBeInTheDocument();
    first.unmount();
    mount();
    expect(await screen.findByRole("link", { name: "Open in CRM" })).toBeInTheDocument();
  });
});
