import { z } from "zod";

export const createRunInput = z
  .object({
    profile: z.enum(["gtm", "blank"]).default("blank"),
    objective: z
      .string()
      .min(3)
      .max(20000)
      .refine(
        (text) => text.trim().length >= 3,
        "Enter a task description of at least three characters.",
      ),
    pain: z.string().optional(),
    universe: z.string().optional(),
    exclusions: z.string().optional(),
    completion_criteria: z.string().max(20000).default(""),
    swarm_size: z.number().int().min(5).max(100).default(20),
    threshold: z.number().gt(0).lte(1).default(0.7),
    time_limit_sec: z.number().int().min(60).max(3600).default(1800),
    cost_cap: z.number().positive().max(100).default(5),
    connectors: z.array(z.string()).default(["web_search"]),
  })
  .superRefine((data, context) => {
    if (!data.completion_criteria.trim() && data.objective.trim().length > 18000) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completion_criteria"],
        message:
          "Could not generate completion criteria. Shorten the task description or enter completion criteria yourself.",
      });
    }
  })
  .transform((data) => ({
    ...data,
    completion_criteria: data.completion_criteria.trim()
      ? data.completion_criteria
      : `Complete the following task: ${data.objective.trim()}\nSupport findings with inspectable source evidence. Address each requested part of the task, report conflicting evidence and unresolved gaps, and do not consider the task complete while a requested part remains unanswered.`,
  }));
