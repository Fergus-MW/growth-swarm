import { CrmRecordEditor } from "@/components/CrmRecordEditor";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppHeader } from "@/components/AppHeader";
import { getCrmRecord } from "@/lib/crm-detail.functions";
import {
  evidenceReferences,
  objectFields,
  resolveEvidenceSpan,
  safeResearchUrl,
} from "@/lib/crm-detail";
import type { ResearchNode } from "@/lib/crm-detail";
import type { ReactNode } from "react";

export const Route = createFileRoute("/_authenticated/leads/$key")({
  head: () => ({ meta: [{ title: "CRM record — Auto Research" }] }),
  component: CrmRecordPage,
});

function valueText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Unknown";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function CrmRecordPage() {
  const { key } = Route.useParams();
  const { user } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const readRecord = useServerFn(getCrmRecord);
  const query = useQuery({
    queryKey: ["crm", "record", user.id, key],
    queryFn: () => readRecord({ data: { id: key } }),
    retry: false,
  });
  const detail = query.data;
  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <Link to="/leads" className="text-sm text-primary underline">
          Back to CRM
        </Link>
        {query.isPending ? (
          <p role="status" className="mt-6">
            Loading record…
          </p>
        ) : query.isError ? (
          <div role="alert" className="mt-6 rounded border border-destructive p-4">
            <p>{query.error.message}</p>
            <button className="mt-2 underline" onClick={() => void query.refetch()}>
              Try again
            </button>
          </div>
        ) : !detail ? (
          <p className="mt-6">This record is unavailable or you do not have access.</p>
        ) : (
          <>
            <header className="my-6">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {detail.record.entity_type}
              </p>
              <h1 className="text-3xl font-bold">{detail.record.title}</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {detail.evidenceCount} referenced evidence sources · {detail.contactCount} distinct
                related contacts · {detail.runs.length} research runs
              </p>
            </header>
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="space-y-6 lg:col-span-2">
                <Section title="Research fields">
                  <Fields fields={objectFields(detail.record.fields)} />
                </Section>
                <Section title="Research write-up">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">
                    {detail.record.free_text || "No write-up recorded."}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Confidence: {detail.record.confidence ?? "Unknown"}. Research values retain
                    their original evidence below.
                  </p>
                </Section>
                <Section title="Assessments and field history">
                  <p className="mb-3 text-sm text-muted-foreground">
                    Each search has its own objective and verdict. Conflicting values are kept
                    separately.
                  </p>
                  {detail.sources.map((source) => {
                    const snapshot = objectFields(source.snapshot);
                    const run = detail.runs.find((item) => item.id === source.run_id);
                    return (
                      <article key={source.id} className="mb-3 rounded border border-border p-3">
                        <Link
                          className="font-semibold text-primary underline"
                          to="/runs/$runId"
                          params={{ runId: source.run_id }}
                        >
                          {run?.objective ?? "Source run"}
                        </Link>
                        <p className="my-2 text-xs text-muted-foreground">
                          Graph revision {source.graph_revision} · Entity revision{" "}
                          {source.node_revision} · {source.created_at}
                        </p>
                        <Fields fields={objectFields(snapshot["fields"])} />
                        <p className="mt-3 whitespace-pre-wrap text-sm">
                          {valueText(snapshot["free_text"])}
                        </p>
                        <p className="mt-2 text-xs text-muted-foreground">
                          Provenance: {valueText(snapshot["provenance"])} · Confidence:{" "}
                          {valueText(snapshot["confidence"])}
                        </p>
                      </article>
                    );
                  })}
                </Section>
                <Section title="Claims and exact supporting passages">
                  {!detail.assertions.length && (
                    <p className="text-sm text-muted-foreground">
                      No claims recorded. Missing evidence remains a research gap.
                    </p>
                  )}
                  {detail.assertions.map((assertion) => (
                    <article key={assertion.id} className="mb-4 rounded border border-border p-3">
                      <p className="font-medium">{assertion.claim}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {assertion.field_key ? `Field: ${assertion.field_key} · ` : ""}
                        {assertion.confidence} confidence · assessment{" "}
                        {assertion.assessment_version}
                      </p>
                      <Link
                        className="text-xs text-primary underline"
                        to="/runs/$runId"
                        params={{ runId: assertion.run_id }}
                      >
                        Open source run
                      </Link>
                      {evidenceReferences(assertion.evidence).map((ref, index) => (
                        <Evidence
                          key={`${ref.chunkId}-${index}`}
                          reference={ref}
                          node={detail.nodes.find((node) => node.id === ref.chunkId)}
                        />
                      ))}
                    </article>
                  ))}
                </Section>
              </div>
              <aside className="space-y-6">
                {(detail.record.entity_type === "company" ||
                  detail.record.entity_type === "person") && (
                  <CrmRecordEditor
                    recordId={detail.record.id}
                    entityType={detail.record.entity_type}
                    researchFields={{
                      ...objectFields(detail.record.fields),
                      name: detail.record.title,
                    }}
                    onSaved={() => {
                      void queryClient.invalidateQueries({ queryKey: ["crm"] });
                    }}
                  />
                )}
                <Section title="Related companies and people">
                  {!detail.links.some(({ node }) => node?.category === "primary_entity") && (
                    <p className="text-sm text-muted-foreground">
                      No confirmed relationship recorded. Employer or contact information may be
                      unknown.
                    </p>
                  )}
                  {detail.links
                    .filter(({ node }) => node?.category === "primary_entity")
                    .map(
                      ({ edge, node }) =>
                        node && (
                          <article key={edge.id} className="mb-3 rounded border border-border p-3">
                            {detail.crmIds[node.id] ? (
                              <Link
                                to="/leads/$key"
                                params={{ key: detail.crmIds[node.id]! }}
                                className="font-semibold text-primary underline"
                              >
                                {node.title}
                              </Link>
                            ) : (
                              <span className="font-semibold">{node.title}</span>
                            )}
                            <p className="mt-1 text-xs">
                              {node.entity_type} · {valueText(objectFields(node.fields)["role"])}
                            </p>
                            <p className="mt-1 text-xs">
                              {edge.relation} · {edge.polarity ?? "Unspecified polarity"}
                            </p>
                            {edge.relation === "works_at" && (
                              <p className="mt-1 text-xs text-muted-foreground">
                                Employment timing is not verified by this relationship alone.
                              </p>
                            )}
                            {edge.relation === "best_contact_for" && (
                              <p className="mt-1 text-xs text-muted-foreground">
                                Contact recommendation for the linked pain assessment.
                              </p>
                            )}
                            {edge.rationale && <p className="mt-2 text-sm">{edge.rationale}</p>}
                            <Link
                              to="/runs/$runId"
                              params={{ runId: edge.run_id }}
                              className="mt-2 inline-block text-xs text-primary underline"
                            >
                              Inspect relationship and evidence
                            </Link>
                          </article>
                        ),
                    )}
                </Section>
                <Section title="Signals and other findings">
                  {detail.links
                    .filter(({ node }) => node?.category === "note")
                    .map(
                      ({ edge, node }) =>
                        node && (
                          <article key={edge.id} className="mb-3 rounded border border-border p-3">
                            <h3 className="font-medium">{node.title}</h3>
                            <p className="text-xs text-muted-foreground">
                              {node.semantic_kind ?? node.editorial_type} · {edge.relation} ·{" "}
                              {edge.polarity ?? "Unknown polarity"}
                            </p>
                            <p className="mt-2 whitespace-pre-wrap text-sm">
                              {node.content || node.free_text || "No detail recorded."}
                            </p>
                          </article>
                        ),
                    )}
                </Section>
                <Section title="Source context">
                  <p className="mb-3 text-xs text-muted-foreground">
                    Retrieval context is not proof of a claim. Claim citations above identify the
                    actual supporting passages.
                  </p>
                  {detail.links
                    .filter(({ node }) => node?.category === "source_chunk")
                    .map(
                      ({ edge, node }) =>
                        node && (
                          <article key={edge.id} className="mb-3 rounded border border-border p-3">
                            <Source node={node} />
                            <p className="text-xs">
                              {edge.relation} · {edge.polarity ?? "Unknown polarity"}
                            </p>
                          </article>
                        ),
                    )}
                </Section>
                <Section title="Source runs and graph">
                  {detail.runs.map((run) => (
                    <div key={run.id} className="mb-3">
                      <Link
                        to="/runs/$runId"
                        params={{ runId: run.id }}
                        className="text-primary underline"
                      >
                        {run.objective}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {run.outcome ?? run.status} · {run.ended_at ?? run.created_at}
                      </p>
                      <Link
                        to="/swarm/$runId"
                        params={{ runId: run.id }}
                        className="text-xs text-primary underline"
                      >
                        Open research graph
                      </Link>
                    </div>
                  ))}
                </Section>
              </aside>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Fields({ fields }: { fields: Record<string, unknown> }) {
  if (!Object.keys(fields).length)
    return <p className="text-sm text-muted-foreground">No fields recorded.</p>;
  return (
    <dl className="grid gap-2 text-sm">
      {Object.entries(fields).map(([name, value]) => (
        <div key={name} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3">
          <dt className="break-words text-muted-foreground">{name.replaceAll("_", " ")}</dt>
          <dd className="break-words">{valueText(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Source({ node }: { node: ResearchNode }) {
  const url = safeResearchUrl(node.locator);
  return (
    <>
      <h4 className="font-medium">{node.title}</h4>
      <p className="text-xs text-muted-foreground">
        {node.is_snippet ? "Captured search snippet" : "Captured source"} ·{" "}
        {node.provider ?? "Unknown provider"} · {node.connector ?? "Unknown connector"}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Published: {node.published_at ?? "Unknown"}
        <br />
        Event: {node.event_at ?? "Unknown"}
        <br />
        Fetched: {node.fetched_at ?? "Unknown"}
      </p>
      {url && (
        <a href={url} target="_blank" rel="noreferrer" className="text-xs text-primary underline">
          Open original source
        </a>
      )}
    </>
  );
}

function Evidence({
  reference,
  node,
}: {
  reference: ReturnType<typeof evidenceReferences>[number];
  node: ResearchNode | undefined;
}) {
  if (!node || node.category !== "source_chunk")
    return (
      <p className="mt-2 text-sm text-muted-foreground">
        Supporting source unavailable or restricted.
      </p>
    );
  const content = node.content ?? "";
  const span = resolveEvidenceSpan(content, reference);
  return (
    <details className="mt-3 rounded border border-border p-3">
      <summary className="cursor-pointer text-sm">
        {reference.polarity}: {node.title}
      </summary>
      <div className="mt-2">
        <Source node={node} />
        {span ? (
          <blockquote className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap text-sm">
            {content.slice(0, span.start)}
            <mark>{content.slice(span.start, span.end)}</mark>
            {content.slice(span.end)}
          </blockquote>
        ) : (
          <>
            <p className="mt-2 text-xs text-muted-foreground">
              Citation offsets could not be verified; no passage is highlighted.
            </p>
            <blockquote className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap text-sm">
              {content || "No retained passage available."}
            </blockquote>
          </>
        )}
      </div>
    </details>
  );
}
