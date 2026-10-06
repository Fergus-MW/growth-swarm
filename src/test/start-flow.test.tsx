import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Route } from "@/routes/_authenticated/setup";

const calls = vi.hoisted(() => ({ create: vi.fn(), start: vi.fn(), navigate: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: object) => ({ options }),
  useNavigate: () => calls.navigate,
}));
vi.mock("@/lib/runs.functions", () => ({ createRun: calls.create, startRun: calls.start }));
vi.mock("@/lib/meta.functions", () => ({ webSearchStatus: async () => ({ available: true }) }));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  calls.start.mockResolvedValue({ ok: true, status: "running" });
});

it("admits one run for two immediate submissions, then enters execution", async () => {
  let admit!: (run: { id: string }) => void;
  calls.create.mockReturnValue(
    new Promise((resolve) => {
      admit = resolve;
    }),
  );
  const Page = Route.options.component!;
  render(<Page />);
  fireEvent.change(screen.getByLabelText("Task description"), {
    target: { value: "Compare volcanic eruptions" },
  });
  const form = screen.getByLabelText("Task description").closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(calls.create).toHaveBeenCalledTimes(1);
  admit({ id: "synthetic-run" });
  await waitFor(() =>
    expect(calls.navigate).toHaveBeenCalledWith({
      to: "/runs/$runId",
      params: { runId: "synthetic-run" },
    }),
  );
  expect(calls.start).toHaveBeenCalledTimes(1);
});
