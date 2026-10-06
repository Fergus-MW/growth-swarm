import { createOpenAI } from "@ai-sdk/openai";
import { Output, streamText } from "ai";
import type { z } from "zod";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1";
const MODEL = "openai/gpt-6-astra";

export class ModelError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * One structured model call through the Lovable AI Gateway (Responses API).
 * Streams internally (long calls must not buffer) and resolves the final
 * typed object. Created fresh per call — never share providers across requests.
 */
export async function callModelJson<S extends z.ZodType>(opts: {
  instructions: string;
  input: string;
  schema: S;
  schemaName: string;
  effort?: "low" | "medium";
}): Promise<z.infer<S>> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new ModelError(401, "AI gateway key is not configured");

  const provider = createOpenAI({
    baseURL: GATEWAY_URL,
    apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
  });

  try {
    const result = streamText({
      model: provider.responses(MODEL),
      instructions: opts.instructions,
      messages: [{ role: "user", content: opts.input }],
      output: Output.object({ name: opts.schemaName, schema: opts.schema }),
      providerOptions: {
        openai: {
          store: false,
          forceReasoning: true,
          reasoningEffort: opts.effort ?? "low",
        },
      },
    });
    // Consume the stream, then read the structured output.
    for await (const _ of result.textStream) {
      void _;
    }
    return await result.output;
  } catch (error) {
    const status =
      error && typeof error === "object" && "statusCode" in error
        ? Number((error as { statusCode: unknown }).statusCode)
        : 500;
    const message = error instanceof Error ? error.message : String(error);
    throw new ModelError(Number.isFinite(status) ? status : 500, message);
  }
}
