import { Link } from "@tanstack/react-router";
import { Radar, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const NAV = [
  { to: "/leads", label: "CRM" },
  { to: "/runs", label: "Searches" },
] as const;

export function AppHeader() {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
      <div className="flex flex-wrap items-center gap-3 sm:gap-8">
        <Link to="/" className="flex items-center gap-2">
          <Radar className="h-5 w-5 text-primary" />
          <span className="text-sm font-semibold tracking-wide">AUTO RESEARCH</span>
        </Link>
        <nav className="flex items-center gap-1">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className="rounded-md px-3 py-1.5 font-data text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
              activeProps={{ className: "bg-secondary text-primary" }}
            >
              {n.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-3">
        <Link
          to="/setup"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> Find clients
        </Link>
        <button
          onClick={() => supabase.auth.signOut()}
          className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:border-primary hover:text-primary"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
