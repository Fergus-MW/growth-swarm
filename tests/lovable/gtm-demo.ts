// Fictional go-to-market corpus for the README demo (`?fixture=gtm-demo`).
// Every company, person, and source is invented; nothing leaves localhost.
type Company = {
  name: string;
  domain: string;
  sector: string;
  country: string;
  headcount: number;
  ceo: string;
  contact: string;
  role: string;
  pain: boolean;
  signal: string | null;
  date: string | null;
};

const companies: Company[] = [
  {
    name: "Northstar Components",
    domain: "northstar-components.example",
    sector: "specialist manufacturing",
    country: "United Kingdom",
    headcount: 640,
    ceo: "Alex Morgan",
    contact: "Priya Shah",
    role: "Group Financial Controller",
    pain: true,
    signal: "announced an ERP consolidation programme",
    date: "2026-05-12",
  },
  {
    name: "Meridian Industrial",
    domain: "meridian-industrial.example",
    sector: "industrials",
    country: "Ireland",
    headcount: 820,
    ceo: "Niamh Byrne",
    contact: "Daniel Reed",
    role: "Finance Transformation Director",
    pain: true,
    signal: "opened a finance transformation vacancy",
    date: "2026-03-24",
  },
  {
    name: "Alder Distribution",
    domain: "alder-distribution.example",
    sector: "distribution",
    country: "United Kingdom",
    headcount: 420,
    ceo: "Sam Patel",
    contact: "Emma Clarke",
    role: "Head of Accounts Payable",
    pain: true,
    signal: "completed its second acquisition in a year",
    date: "2026-06-03",
  },
  {
    name: "Strata Precision",
    domain: "strata-precision.example",
    sector: "specialist manufacturing",
    country: "Ireland",
    headcount: 310,
    ceo: "Orla Kelly",
    contact: "Conor Walsh",
    role: "Finance Director",
    pain: true,
    signal: "appointed a new CFO to lead post-merger integration",
    date: "2026-01-18",
  },
  {
    name: "Harbour Supply Group",
    domain: "harbour-supply.example",
    sector: "distribution",
    country: "United Kingdom",
    headcount: 1100,
    ceo: "Tom Wilson",
    contact: "Leah Evans",
    role: "Group Finance Director",
    pain: true,
    signal: "issued an RFP for accounts payable automation",
    date: "2026-04-07",
  },
  {
    name: "Kestrel Fabrication",
    domain: "kestrel-fabrication.example",
    sector: "industrials",
    country: "United Kingdom",
    headcount: 530,
    ceo: "Hannah Price",
    contact: "Marcus Lee",
    role: "Shared Services Manager",
    pain: true,
    signal: "was acquired by a private equity buy-and-build platform",
    date: "2026-02-27",
  },
  {
    name: "Lumen Hydraulics",
    domain: "lumen-hydraulics.example",
    sector: "specialist manufacturing",
    country: "Ireland",
    headcount: 380,
    ceo: "Ciara Doyle",
    contact: "Owen Murphy",
    role: "Financial Controller",
    pain: true,
    signal: "posted three accounts payable roles",
    date: "2026-05-29",
  },
  {
    name: "Cobalt Works",
    domain: "cobalt-works.example",
    sector: "industrials",
    country: "United Kingdom",
    headcount: 260,
    ceo: "Grace Chen",
    contact: "Ben Thomas",
    role: "Financial Controller",
    pain: false,
    signal: null,
    date: null,
  },
];

const painLine = "the finance team reconciles supplier invoices by hand across three ERP systems";
const noPainLine = "supplier invoice reconciliation is fully automated on a single ERP system";

const profile = (c: Company) => ({
  title: `FICTIONAL ${c.name} — company profile`,
  url: `https://${c.domain}/about`,
  content: `FICTIONAL: ${c.name} is a private-equity-backed ${c.sector} company in ${c.country} with ${c.headcount} employees. After acquisitions, ${c.pain ? painLine : noPainLine}.`,
  publishedDate: "2026-01-01",
});
const trade = (c: Company) => ({
  title: `FICTIONAL Trade journal interview — ${c.name}`,
  url: `https://trade-journal.example/${c.domain}`,
  content: `FICTIONAL: In an interview, ${c.contact}, ${c.role} at ${c.name}, said ${c.pain ? painLine : noPainLine}.`,
  publishedDate: "2026-02-01",
});
const news = (c: Company) => ({
  title: `FICTIONAL ${c.name} news`,
  url: `https://news.example/${c.domain}`,
  content: c.signal
    ? `FICTIONAL: On ${c.date}, ${c.name} ${c.signal}.`
    : `FICTIONAL: No recent announcements from ${c.name}.`,
  publishedDate: c.date ?? undefined,
});
const leadership = (c: Company) => ({
  title: `FICTIONAL ${c.name} leadership team`,
  url: `https://${c.domain}/leadership`,
  content: `FICTIONAL: ${c.ceo} is the current CEO of ${c.name}. ${c.contact} is the current ${c.role}.`,
  publishedDate: "2026-01-01",
});

const discoveryQueries = [
  "UK industrials manual supplier invoice reconciliation multiple ERP",
  "Ireland manufacturers post-acquisition finance integration ERP",
  "private equity buy-and-build distribution accounts payable",
  "specialist manufacturing finance team invoice matching spreadsheets",
];

const named = (text: string) => companies.find((c) => text.includes(c.name));
const delay = () => new Promise((resolve) => setTimeout(resolve, 350 + Math.random() * 650));

export async function gtmDemoSearch(query: string) {
  await delay();
  const company = named(query);
  if (company) {
    const items = /founder OR CEO/.test(query)
      ? [leadership(company)]
      : /hiring OR funding/.test(query)
        ? [news(company)]
        : [profile(company), trade(company)];
    return { ok: true as const, items };
  }
  const offset = Math.max(0, discoveryQueries.indexOf(query)) * 2;
  const items = [0, 1, 2].map((i) => profile(companies[(offset + i) % companies.length]!));
  return { ok: true as const, items };
}

// The real executors list chunks as "[i] <title>..." in the model input.
function chunks(input: string) {
  return [...input.matchAll(/^\[(\d+)\] (.+)$/gm)].map((m) => ({
    index: Number(m[1]),
    title: m[2]!,
  }));
}

export async function gtmDemoModel(schemaName: string, input: string) {
  await delay();
  if (schemaName === "decompose")
    return {
      pain_summary: "Manual supplier invoice reconciliation across several ERPs after acquisitions",
      symptoms: [
        "Invoice matching in spreadsheets",
        "Several ERP instances per group",
        "Finance transformation hiring",
      ],
      segments: [
        { name: "UK & Ireland industrials", rationale: "Acquisitive groups with fragmented ERPs" },
        {
          name: "PE-backed distribution",
          rationale: "Buy-and-build platforms add ERPs with each deal",
        },
      ],
      discovery_queries: discoveryQueries,
      assumptions: ["Acquired businesses keep their own ERP for at least a year"],
    };
  if (schemaName === "discovery")
    return {
      companies: chunks(input).flatMap(({ index, title }) => {
        const c = named(title);
        return c
          ? [
              {
                name: c.name,
                website: `https://${c.domain}`,
                location: c.country,
                size: `${c.headcount} employees`,
                why_relevant: `${c.sector} group in ${c.country} that grew by acquisition`,
                evidence_chunk_index: index,
                evidence_quote: `${c.headcount} employees`,
              },
            ]
          : [];
      }),
      more_queries: [],
      negative_finding: null,
    };
  if (schemaName === "qualify") {
    const c = named(input.match(/^Company: (.+)$/m)?.[1] ?? "")!;
    const evidence = chunks(input)
      .filter(({ title }) => title.includes(c.name))
      .map(({ index }) => ({
        chunk_index: index,
        quote: c.pain ? painLine : noPainLine,
        polarity: c.pain ? ("supports" as const) : ("contradicts" as const),
      }));
    return {
      verdict: c.pain ? ("qualified" as const) : ("unqualified" as const),
      rationale: c.pain
        ? `Two independent fictional sources say ${c.name}'s finance team reconciles invoices by hand across three ERPs.`
        : `${c.name} reports fully automated reconciliation on one ERP, so it does not hold the pain.`,
      confidence: c.pain ? ("high" as const) : ("medium" as const),
      free_text: `**${c.name}** — ${c.sector}, ${c.country}, ${c.headcount} employees. ${c.pain ? "Manual multi-ERP invoice reconciliation confirmed." : "Pain contradicted by the company's own profile."}`,
      evidence,
      claims: c.pain
        ? [
            {
              title: `${c.name} runs three ERPs after acquisitions`,
              body: `Finance reconciles supplier invoices by hand across the acquired businesses' ERPs.`,
              confidence: "high" as const,
            },
          ]
        : [],
    };
  }
  if (schemaName === "signals") {
    const c = named(input.match(/^Company: (.+)$/m)?.[1] ?? "")!;
    return {
      signals: c.signal
        ? [
            {
              title: `${c.name} ${c.signal}`,
              kind: "announcement",
              interpretation: `A dated sign that ${c.name} is acting on finance integration now.`,
              event_date: c.date,
              date_basis: "Publication date",
              evidence_chunk_index: 0,
              evidence_quote: c.signal,
            },
          ]
        : [],
      negative_finding: c.signal ? null : "No dated demand signal found",
    };
  }
  if (schemaName === "contacts") {
    const c = named(input.match(/^Company: (.+)$/m)?.[1] ?? "")!;
    return {
      people: [
        {
          name: c.ceo,
          role: "CEO",
          is_founder_or_ceo: true,
          current_role_confidence: "high" as const,
          contact_rationale: `Sponsors the post-acquisition integration at ${c.name}.`,
          evidence_chunk_index: 0,
          evidence_quote: `${c.ceo} is the current CEO`,
        },
        {
          name: c.contact,
          role: c.role,
          is_founder_or_ceo: false,
          current_role_confidence: "high" as const,
          contact_rationale: `Owns supplier invoice reconciliation at ${c.name}.`,
          evidence_chunk_index: 0,
          evidence_quote: `${c.contact} is the current ${c.role}`,
        },
      ],
      gap: null,
    };
  }
  if (schemaName === "vote") {
    const qualified = Number(input.match(/"qualified":(\d+)/)?.[1] ?? 0);
    const openTasks = Number(input.match(/"openTasks":(\d+)/)?.[1] ?? 0);
    return {
      decision: qualified >= 5 && openTasks === 0 ? ("yes" as const) : ("no" as const),
      rationale: `${qualified} qualified companies, each with cited evidence, a dated signal, and named contacts.`,
      gap_task: null,
    };
  }
  if (schemaName === "gap") return { findings: [], companies: [] };
  throw new Error(`Unsupported demo model schema: ${schemaName}`);
}
