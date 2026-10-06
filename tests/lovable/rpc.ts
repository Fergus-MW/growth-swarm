import { database, fixtureControls } from "./runtime";

export function createServerFn(options: { method?: string } = {}) {
  let validator = (value: unknown) => value;
  const builder = {
    middleware() {
      return builder;
    },
    inputValidator(fn: (value: unknown) => unknown) {
      validator = fn;
      return builder;
    },
    validator(fn: (value: unknown) => unknown) {
      validator = fn;
      return builder;
    },
    handler(fn: (options: { data: unknown; context: unknown }) => unknown) {
      return async (options?: { data?: unknown }) => {
        const data = validator(options?.data);
        if (
          fixtureControls.startFailures &&
          options.method === "POST" &&
          data &&
          typeof data === "object" &&
          "id" in data &&
          database.tables.runs.some((row) => row["id"] === data.id && row["status"] === "draft")
        ) {
          fixtureControls.startFailures--;
          throw new Error("Synthetic start transport failure");
        }
        await new Promise((resolve) => setTimeout(resolve, 35));
        return fn({ data, context: { supabase: database, userId: "fixture-user" } });
      };
    },
  };
  return builder;
}
export const useServerFn = <T>(fn: T): T => fn;
