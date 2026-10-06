import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Network, Radar, FileSearch, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Auto Research — configurable research swarm" },
      {
        name: "description",
        content:
          "Give a brief and completion criteria; 5 to 100 agents research it through your connectors and build one shared, evidence-linked graph you watch live.",
      },
      { property: "og:title", content: "Auto Research — configurable research swarm" },
      {
        property: "og:description",
        content: "A swarm of research agents builds one shared, evidence-linked graph from your brief. Watch it live, then explore, export, or continue.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Landing,
});

function Landing() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setSignedIn(Boolean(data.user)));
  }, []);

  return (
    <div className="surface-grid flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-2">
          <Radar className="h-5 w-5 text-primary" />
          <span className="text-sm font-semibold tracking-wide">AUTO RESEARCH</span>
        </div>
        <Link
          to={signedIn ? "/runs" : "/auth"}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary"
        >
          {signedIn ? "Your runs" : "Sign in"}
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <p className="font-data text-xs tracking-[0.3em] text-primary">CONFIGURABLE RESEARCH SWARM</p>
        <h1 className="mt-6 text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
          One brief. A swarm of agents.{" "}
          <span className="text-primary text-glow">One shared graph.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          State a pain and a universe. Five to one hundred agents research it through the connectors you
          select, capture every source before any model reads it, and link every claim to the exact passage
          that supports it. Watch the graph grow live — then explore, export, or continue the result.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link
            to={signedIn ? "/setup" : "/auth"}
            className="glow-primary inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-transform hover:scale-[1.02]"
          >
            Start a research run <ArrowRight className="h-4 w-4" />
          </Link>
          {signedIn && (
            <Link
              to="/runs"
              className="rounded-md border border-border px-6 py-3 text-sm font-medium text-foreground transition-colors hover:border-primary"
            >
              Open run list
            </Link>
          )}
        </div>

        <div className="mt-16 grid w-full gap-4 sm:grid-cols-3">
          {[
            {
              icon: Network,
              title: "Three node categories",
              body: "Companies and people, agent-authored notes, and immutable captured source chunks — each with its own shape on the graph.",
            },
            {
              icon: FileSearch,
              title: "Evidence, not vibes",
              body: "Every claim cites an exact span in a stored source. Retrieval context and proof never look the same.",
            },
            {
              icon: Radar,
              title: "Consensus to stop",
              body: "The run ends when your chosen share of the whole roster votes yes on the same graph revision — or when a budget says so.",
            },
          ].map((f) => (
            <div key={f.title} className="rounded-lg border border-border bg-card p-5 text-left">
              <f.icon className="h-5 w-5 text-primary" />
              <h3 className="mt-3 text-sm font-semibold">{f.title}</h3>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="border-t border-border px-6 py-4 text-center font-data text-xs text-muted-foreground">
        Unknowns and negative results stay visible. A stopped run is not proof of exhaustion.
      </footer>
    </div>
  );
}
