export type EntityKind = "company" | "person";
export type EmploymentStance = "current" | "historical" | "negated";

export interface TransferNode {
  id: string;
  runId: string;
  revision: number;
  entityType: string | null;
  title: string;
  fields: Record<string, unknown>;
}

export interface TransferEdge {
  relation: string;
  from: string;
  to: string;
  polarity: string | null;
}

export interface PlannedMapping {
  nodeId: string;
  runId: string;
  revision: number;
  kind: EntityKind;
  identityKey: string;
  action: "create" | "reuse";
}

export interface TransferPlan {
  mappings: PlannedMapping[];
  sourceCount: number;
  created: number;
  reused: number;
  companyCount: number;
  personCount: number;
}

const EDITABLE_FIELDS = ["name", "website", "location", "size", "role"] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

export function isEditableField(value: string): value is EditableField {
  return (EDITABLE_FIELDS as readonly string[]).includes(value);
}

/** A hostname is a strong company identity. A bare name is not. */
export function websiteHost(fields: Record<string, unknown>): string | null {
  const website = fields["website"];
  const domain = fields["domain"];
  const raw = typeof website === "string" ? website : typeof domain === "string" ? domain : "";
  const host = raw.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").split(/[/?#]/)[0]?.toLowerCase() ?? "";
  return host.includes(".") ? host : null;
}

export function normalizePersonName(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function employmentStance(polarity: string | null | undefined): EmploymentStance {
  if (polarity === "contradicts") return "negated";
  if (polarity === "qualifies") return "historical";
  return "current";
}

/**
 * Every company and person becomes one mapping. Domain matches are reused.
 * Same names without that strong key stay separate. Negated or historical
 * employment does not glue a person to an employer.
 */
export function planTransfer(nodes: readonly TransferNode[], edges: readonly TransferEdge[], existingIdentityKeys: ReadonlySet<string>): TransferPlan {
  const companies = nodes.filter((node) => node.entityType === "company");
  const people = nodes.filter((node) => node.entityType === "person");
  const companyKey = new Map<string, string>();
  for (const company of companies) {
    const host = websiteHost(company.fields);
    companyKey.set(company.id, host ? `company:domain:${host}` : `company:node:${company.id}`);
  }
  const seen = new Set(existingIdentityKeys);
  const mappings: PlannedMapping[] = [];
  const take = (node: TransferNode, kind: EntityKind, identityKey: string) => {
    const action = seen.has(identityKey) ? "reuse" : "create";
    seen.add(identityKey);
    mappings.push({ nodeId: node.id, runId: node.runId, revision: node.revision, kind, identityKey, action });
  };
  for (const company of companies) take(company, "company", companyKey.get(company.id) ?? `company:node:${company.id}`);
  for (const person of people) take(person, "person", personIdentity(person, edges, companyKey));
  return {
    mappings,
    sourceCount: mappings.length,
    created: mappings.filter((row) => row.action === "create").length,
    reused: mappings.filter((row) => row.action === "reuse").length,
    companyCount: companies.length,
    personCount: people.length,
  };
}

function personIdentity(person: TransferNode, edges: readonly TransferEdge[], companyKey: ReadonlyMap<string, string>): string {
  const hosts = edges
    .filter((edge) => edge.relation === "works_at" && employmentStance(edge.polarity) === "current" && (edge.from === person.id || edge.to === person.id))
    .map((edge) => (edge.from === person.id ? edge.to : edge.from))
    .map((companyId) => companyKey.get(companyId) ?? "")
    .filter((key) => key.startsWith("company:domain:"))
    .map((key) => key.slice("company:domain:".length))
    .sort();
  const host = hosts[0];
  const name = normalizePersonName(person.title);
  if (host && name) return `person:domain:${host}:name:${name}`;
  return `person:node:${person.id}`;
}

export function conflictingFields(snapshots: readonly { runId: string; fields: Record<string, unknown> }[]): { field: string; values: { runId: string; value: string }[] }[] {
  const grouped = new Map<string, Map<string, string>>();
  for (const snapshot of snapshots) {
    for (const [field, raw] of Object.entries(snapshot.fields)) {
      if (raw == null || raw === "") continue;
      const value = String(raw);
      const runs = grouped.get(field) ?? new Map<string, string>();
      runs.set(snapshot.runId, value);
      grouped.set(field, runs);
    }
  }
  const conflicts: { field: string; values: { runId: string; value: string }[] }[] = [];
  for (const [field, runs] of grouped) {
    const values = [...runs.entries()].map(([runId, value]) => ({ runId, value }));
    if (new Set(values.map((row) => row.value)).size > 1) conflicts.push({ field, values });
  }
  return conflicts;
}

export function evidenceEdgeCount(edges: readonly { id: string; relation: string }[]): number {
  return new Set(edges.filter((edge) => edge.relation === "evidences").map((edge) => edge.id)).size;
}
