import { fixtureControls, scenario } from "./runtime";
export class ModelError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function callModelJson(options: { schemaName: string; input: string }) {
  fixtureControls.modelCalls++;
  if (scenario === "model-error" || (scenario === "voter-error" && options.schemaName === "vote"))
    throw new ModelError(403, "Synthetic model refusal");
  if (scenario === "slow") await new Promise((resolve) => setTimeout(resolve, 1500));
  if (options.schemaName === "generic_research")
    return {
      findings: [
        {
          title: "Fictional volcano hazards",
          body: "FICTIONAL: Ash and lava are volcanic hazards in this synthetic source.",
          chunk_index: 0,
          quote: "Ash and lava are volcanic hazards",
        },
      ],
      queries: [],
      gap: null,
    };
  if (options.schemaName === "vote")
    return {
      decision: options.input.includes("https://fixture.invalid/volcano") ? "yes" : "no",
      rationale: "Fixture evaluator agrees with the synthetic captured evidence",
      gap_task: null,
    };
  if (options.schemaName === "decompose")
    return {
      pain_summary: "Fictional volcano hazards",
      symptoms: [],
      segments: [{ name: "fictional volcano", rationale: "Synthetic source coverage" }],
      discovery_queries: ["fictional volcano hazards"],
      assumptions: [],
    };
  if (options.schemaName === "discovery")
    return {
      companies: [],
      more_queries: [],
      negative_finding: "Generic fictional volcano research has no companies",
    };
  throw new Error(`Unsupported fixture model schema: ${options.schemaName}`);
}
