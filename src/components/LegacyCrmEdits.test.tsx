import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQuery: query }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/crm-legacy.functions", () => ({ getLegacyCrmEdits: vi.fn() }));
import { LegacyCrmEdits } from "./LegacyCrmEdits";
afterEach(cleanup);

describe("legacy CRM review", () => {
  it("keeps ambiguous and newer legacy notes visible without silently copying them", () => {
    query.mockReturnValue({
      data: [
        {
          id: "old-1",
          key: "same.example",
          stage: "meeting",
          starred: true,
          notes: "Retained ambiguous note",
          status: "ambiguous",
          changedSinceImport: false,
        },
        {
          id: "old-2",
          key: "unique.example",
          stage: "won",
          starred: false,
          notes: "Later old-browser note",
          status: "imported",
          changedSinceImport: true,
        },
      ],
    });
    render(<LegacyCrmEdits userId="owner" />);
    expect(screen.getByText(/Earlier CRM edits/)).toHaveTextContent("2 need review");
    expect(screen.getByText("Retained ambiguous note")).toBeInTheDocument();
    expect(screen.getByText("Later old-browser note")).toBeInTheDocument();
    expect(screen.getByText(/Several companies match/)).toBeInTheDocument();
    expect(screen.getByText(/newer edits below have not overwritten/)).toBeInTheDocument();
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["crm", "legacy", "owner"] }),
    );
  });
  it("shows a retryable error when retained notes could not be read", () => {
    query.mockReturnValue({ error: new Error("Denied"), refetch: vi.fn() });
    render(<LegacyCrmEdits userId="owner" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load earlier CRM edits");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
