import { createServerFn } from "@tanstack/react-start";

export const webSearchStatus = createServerFn({ method: "GET" }).handler(async () => {
  return { available: Boolean(process.env["TAVILY_API_KEY"]) };
});
