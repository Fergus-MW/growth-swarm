import { describe, expect, it } from "vitest";
import { crmWorkingPatchSchema, defaultCrmWorkingState, reapplyCrmDraft } from "./crm-workflow";

describe("CRM workflow validation", () => {
  const valid = {
    recordId: "00000000-0000-4000-8000-000000000001",
    expectedVersion: 0,
    stage: "new",
    starred: false,
    notes: null,
    overrides: {},
  };
  it("rejects invalid stages, qualification edits and excess fields", () => {
    expect(crmWorkingPatchSchema.safeParse({ ...valid, stage: "qualified" }).success).toBe(false);
    expect(
      crmWorkingPatchSchema.safeParse({ ...valid, overrides: { status: "qualified" } }).success,
    ).toBe(false);
    expect(crmWorkingPatchSchema.safeParse({ ...valid, user_id: "attacker" }).success).toBe(false);
    expect(crmWorkingPatchSchema.safeParse({ ...valid, notes: "a".repeat(10001) }).success).toBe(
      false,
    );
  });
  it("keeps unrelated concurrent changes when explicitly reapplying an override removal", () => {
    const base = { ...defaultCrmWorkingState(valid.recordId), overrides: { name: "Old name" } };
    const draft = { ...base, overrides: {} };
    const latest = {
      ...base,
      version: 2,
      starred: true,
      notes: "New notes",
      overrides: { name: "Other name", phone: "555" },
    };
    expect(reapplyCrmDraft(base, draft, latest)).toEqual({
      ...latest,
      overrides: { phone: "555" },
    });
  });
});
