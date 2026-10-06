import { describe, expect, it } from "vitest";
import { createRunInput } from "./run-input";

describe("run admission", () => {
  it("resolves blank criteria from the task before returning a persistable run", () => {
    const run = createRunInput.parse({
      objective: "Compare tidal power and offshore wind for coastal communities.",
      completion_criteria: "",
    });
    expect(run.completion_criteria).toContain(
      "Compare tidal power and offshore wind for coastal communities.",
    );
    expect(run.completion_criteria).toMatch(/evidence|sources/);
    expect(run.profile).toBe("blank");
    expect(run.completion_criteria).not.toMatch(/qualified companies|founder|CEO|contact/i);
  });
  it("reports generation failure for an oversized task while accepting an explicit criteria retry unchanged", () => {
    const task = "Research ".repeat(2100);
    const generated = createRunInput.safeParse({ objective: task });
    expect(generated.success).toBe(false);
    if (!generated.success)
      expect(generated.error.message).toContain("Could not generate completion criteria");
    const explicit = "  Compare options.\nKeep unknowns visible.  ";
    const retried = createRunInput.parse({ objective: task, completion_criteria: explicit });
    expect(retried.completion_criteria).toBe(explicit);
    expect(retried.objective).toBe(task);
  });
});
