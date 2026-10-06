import { z } from "zod";
import { STAGES } from "./lead-stages";

export const CRM_EDITABLE_FIELDS = {
  company: ["name", "website", "location", "size", "industry", "phone"],
  person: ["name", "email", "phone", "role", "linkedin", "location"],
} as const;

export type CrmWorkingState = {
  record_id: string;
  user_id: string;
  stage: (typeof STAGES)[number];
  starred: boolean;
  notes: string | null;
  overrides: Record<string, string>;
  version: number;
  updated_at: string | null;
};

export type CrmWorkingHistory = {
  id: string;
  record_id: string;
  actor_id: string;
  version: number;
  before_state: CrmWorkingState;
  after_state: CrmWorkingState;
  created_at: string;
};

export function defaultCrmWorkingState(recordId: string, userId = ""): CrmWorkingState {
  return {
    record_id: recordId,
    user_id: userId,
    stage: "new",
    starred: false,
    notes: null,
    overrides: {},
    version: 0,
    updated_at: null,
  };
}

export const crmWorkingPatchSchema = z
  .object({
    recordId: z.string().uuid(),
    expectedVersion: z.number().int().nonnegative(),
    stage: z.enum(STAGES),
    starred: z.boolean(),
    notes: z.string().max(10000).nullable(),
    overrides: z
      .record(z.string().max(2000))
      .refine(
        (fields) =>
          Object.keys(fields).every((key) =>
            [...CRM_EDITABLE_FIELDS.company, ...CRM_EDITABLE_FIELDS.person].some(
              (field) => field === key,
            ),
          ),
        "Only business and contact fields can be edited",
      ),
  })
  .strict();

export type CrmWorkingPatch = z.infer<typeof crmWorkingPatchSchema>;
export type CrmSaveResult = { ok: boolean; conflict: boolean; state: CrmWorkingState };

/** Explicitly apply only changed keys after the user has reviewed a stale write. */
export function reapplyCrmDraft(
  base: CrmWorkingState,
  draft: CrmWorkingState,
  latest: CrmWorkingState,
): CrmWorkingState {
  const overrides = { ...latest.overrides };
  for (const key of new Set([...Object.keys(base.overrides), ...Object.keys(draft.overrides)])) {
    if (base.overrides[key] === draft.overrides[key]) continue;
    if (draft.overrides[key] === undefined) delete overrides[key];
    else overrides[key] = draft.overrides[key];
  }
  return {
    ...latest,
    stage: base.stage === draft.stage ? latest.stage : draft.stage,
    starred: base.starred === draft.starred ? latest.starred : draft.starred,
    notes: base.notes === draft.notes ? latest.notes : draft.notes,
    overrides,
  };
}
