import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { readCrmRecord } from "./crm-detail.server";

function database(failLaterPage = false) {
  const nodeOffsets: number[] = [];
  const source = { id: "mapping", crm_record_id: "record", run_id: "run", node_id: "node-600" };
  const allNodes = Array.from({ length: 601 }, (_, index) => ({
    id: `node-${index}`,
    run_id: "run",
    category: "primary_entity",
    entity_type: "company",
    title: `Company ${index}`,
  }));
  const tables: Record<string, unknown[]> = {
    crm_record_sources: [source],
    nodes: allNodes,
    edges: [],
    assertions: [],
  };
  const db = {
    from(table: string) {
      const query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        order() {
          return query;
        },
        in() {
          return query;
        },
        maybeSingle() {
          return Promise.resolve({
            data:
              table === "crm_records"
                ? { id: "record", user_id: "user" }
                : { id: "run", user_id: "user" },
            error: null,
          });
        },
        range(from: number) {
          if (table === "nodes") nodeOffsets.push(from);
          if (table === "nodes" && from > 0 && failLaterPage)
            return Promise.resolve({
              data: null,
              error: { message: "Access revoked while reading graph" },
            });
          return Promise.resolve({
            data: (tables[table] ?? []).slice(from, from + 100),
            error: null,
          });
        },
      };
      return query;
    },
  } as unknown as SupabaseClient<Database>;
  return { db, nodeOffsets };
}

describe("CRM detail bounded reads", () => {
  it("retrieves a source node beyond server-capped pages instead of truncating details", async () => {
    const { db, nodeOffsets } = database();
    const detail = await readCrmRecord(db, "user", "record");
    expect(detail?.nodes.map((node) => node.id)).toEqual(["node-600"]);
    expect(nodeOffsets).toEqual([0, 100, 200, 300, 400, 500, 600, 601]);
  });
  it("rejects the whole detail response if a later page loses access", async () => {
    const { db } = database(true);
    await expect(readCrmRecord(db, "user", "record")).rejects.toThrow(
      "Access revoked while reading graph",
    );
  });
});
