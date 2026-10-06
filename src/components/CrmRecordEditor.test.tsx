import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultCrmWorkingState } from "@/lib/crm-workflow";

const { load, save } = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/crm-workflow.functions", () => ({
  getCrmWorkingState: load,
  saveCrmWorkingState: save,
}));
import { CrmRecordEditor } from "./CrmRecordEditor";

const id = "00000000-0000-4000-8000-000000000001";
const initial = defaultCrmWorkingState(id, "owner");
beforeEach(() => {
  vi.clearAllMocks();
  load.mockResolvedValue({ state: initial, history: [] });
});
afterEach(cleanup);

describe("CRM editor", () => {
  it.each(["company", "person"] as const)(
    "saves and reloads %s workflow against the stable UUID",
    async (entityType) => {
      const persisted = {
        ...initial,
        stage: "contacted",
        starred: true,
        notes: "Call Monday",
        version: 1,
      };
      save.mockResolvedValue({ ok: true, conflict: false, state: persisted });
      const view = render(
        <CrmRecordEditor
          recordId={id}
          entityType={entityType}
          researchFields={{ status: "qualified" }}
        />,
      );
      fireEvent.change(await screen.findByLabelText("Sales stage"), {
        target: { value: "contacted" },
      });
      fireEvent.click(screen.getByLabelText("Starred"));
      fireEvent.change(screen.getByLabelText("Your notes"), { target: { value: "Call Monday" } });
      fireEvent.click(screen.getByRole("button", { name: "Save CRM changes" }));
      await screen.findByText("Saved");
      expect(save).toHaveBeenCalledWith({
        data: {
          recordId: id,
          expectedVersion: 0,
          stage: "contacted",
          starred: true,
          notes: "Call Monday",
          overrides: {},
        },
      });
      view.unmount();
      load.mockResolvedValue({ state: persisted, history: [] });
      render(
        <CrmRecordEditor
          recordId={id}
          entityType={entityType}
          researchFields={{ status: "qualified" }}
        />,
      );
      expect(await screen.findByLabelText("Your notes")).toHaveValue("Call Monday");
      expect(screen.getByLabelText("Sales stage")).toHaveValue("contacted");
    },
  );

  it("keeps failed drafts visible without publishing unsaved values", async () => {
    save.mockRejectedValue(new Error("Network unavailable"));
    const onSaved = vi.fn();
    render(
      <CrmRecordEditor recordId={id} entityType="person" researchFields={{}} onSaved={onSaved} />,
    );
    fireEvent.change(await screen.findByLabelText("Your notes"), {
      target: { value: "Unsaved note" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save CRM changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Network unavailable");
    expect(screen.getByLabelText("Your notes")).toHaveValue("Unsaved note");
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByText("Unsaved draft")).toBeInTheDocument();
  });

  it("requires reviewing concurrent notes and preserves unrelated saved edits", async () => {
    const concurrent = { ...initial, version: 1, notes: "Other session note", starred: true };
    save.mockResolvedValueOnce({ ok: false, conflict: true, state: concurrent });
    render(<CrmRecordEditor recordId={id} entityType="company" researchFields={{}} />);
    fireEvent.change(await screen.findByLabelText("Your notes"), { target: { value: "My note" } });
    fireEvent.click(screen.getByRole("button", { name: "Save CRM changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Other session note");
    expect(screen.getByLabelText("Your notes")).toHaveValue("My note");
    expect(screen.getByRole("button", { name: "Save CRM changes" })).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "I reviewed the latest version; keep my changes" }),
    );
    expect(screen.getByLabelText("Starred")).toBeChecked();
    fireEvent.change(screen.getByLabelText("Your notes"), {
      target: { value: "Other session note\nMy note" },
    });
    save.mockResolvedValue({
      ok: true,
      conflict: false,
      state: { ...concurrent, version: 2, notes: "Other session note\nMy note" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save CRM changes" }));
    await waitFor(() =>
      expect(save).toHaveBeenLastCalledWith({
        data: expect.objectContaining({
          expectedVersion: 1,
          notes: "Other session note\nMy note",
          starred: true,
        }),
      }),
    );
  });
});
