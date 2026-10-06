CREATE TABLE public.runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  parent_run_id UUID REFERENCES public.runs(id) ON DELETE SET NULL,
  profile TEXT NOT NULL DEFAULT 'gtm',
  objective TEXT NOT NULL,
  pain TEXT,
  universe TEXT,
  exclusions TEXT,
  completion_criteria TEXT NOT NULL DEFAULT '',
  swarm_size INT NOT NULL DEFAULT 20,
  threshold DOUBLE PRECISION NOT NULL DEFAULT 0.7,
  time_limit_sec INT NOT NULL DEFAULT 1800,
  cost_cap NUMERIC NOT NULL DEFAULT 5,
  connectors JSONB NOT NULL DEFAULT '["web_search"]',
  status TEXT NOT NULL DEFAULT 'draft',
  outcome TEXT,
  stop_requested BOOLEAN NOT NULL DEFAULT false,
  execution_fence INT NOT NULL DEFAULT 0,
  graph_revision BIGINT NOT NULL DEFAULT 0,
  assessment_version INT NOT NULL DEFAULT 1,
  epoch INT NOT NULL DEFAULT 0,
  spend NUMERIC NOT NULL DEFAULT 0,
  stats JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.runs TO authenticated;
GRANT ALL ON public.runs TO service_role;
ALTER TABLE public.runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own runs" ON public.runs FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES public.runs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open',
  priority INT NOT NULL DEFAULT 100,
  attempts INT NOT NULL DEFAULT 0,
  outbound_calls INT NOT NULL DEFAULT 0,
  owner_agent INT,
  lease_expires_at TIMESTAMPTZ,
  claim_token TEXT,
  dedupe_key TEXT,
  reserved_for_agent INT,
  result_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX idx_tasks_run_status ON public.tasks(run_id, status, kind, priority);
CREATE UNIQUE INDEX idx_tasks_dedupe ON public.tasks(run_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
GRANT ALL ON public.tasks TO service_role;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage tasks of their runs" ON public.tasks FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.runs r WHERE r.id = run_id AND r.user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM public.runs r WHERE r.id = run_id AND r.user_id = auth.uid()));

CREATE TABLE public.nodes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES public.runs(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  entity_type TEXT,
  editorial_type TEXT,
  semantic_kind TEXT,
  title TEXT NOT NULL,
  aliases JSONB NOT NULL DEFAULT '[]',
  fields JSONB NOT NULL DEFAULT '{}',
  free_text TEXT,
  confidence TEXT,
  provenance TEXT NOT NULL DEFAULT 'research',
  content TEXT,
  locator TEXT,
  provider TEXT,
  connector TEXT,
  content_hash TEXT,
  is_snippet BOOLEAN,
  published_at TIMESTAMPTZ,
  event_at TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ,
  invocation_id UUID,
  created_by_agent INT,
  revision INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_nodes_run ON public.nodes(run_id, category);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nodes TO authenticated;
GRANT ALL ON public.nodes TO service_role;
ALTER TABLE public.nodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage nodes of their runs" ON public.nodes FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.runs r WHERE r.id = run_id AND r.user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM public.runs r WHERE r.id = run_id AND r.user_id = auth.uid()));

CREATE TABLE public.edges (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES public.runs(id) ON DELETE CASCADE,
  relation TEXT NOT NULL,
  from_node UUID NOT NULL REFERENCES public.nodes(id) ON DELETE CASCADE,
  to_node UUID NOT NULL REFERENCES public.nodes(id) ON DELETE CASCADE,
  assertion_id UUID,
  polarity TEXT,
  score DOUBLE PRECISION,
  rationale TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_edges_run ON public.edges(run_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.edges TO authenticated;
GRANT ALL ON public.edges TO service_role;
ALTER TABLE public.edges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage edges of their runs" ON public.edges FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.runs r WHERE r.id = run_id AND r.user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM public.runs r WHERE r.id = run_id AND r.user_id = auth.uid()));

CREATE TABLE public.assertions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES public.runs(id) ON DELETE CASCADE,
  owner_node_id UUID NOT NULL REFERENCES public.nodes(id) ON DELETE CASCADE,
  field_key TEXT,
  claim TEXT NOT NULL,
  confidence TEXT NOT NULL DEFAULT 'medium',
  assessment_version INT NOT NULL DEFAULT 1,
  evidence JSONB NOT NULL DEFAULT '[]',
  created_by_agent INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_assertions_run ON public.assertions(run_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assertions TO authenticated;
GRANT ALL ON public.assertions TO service_role;
ALTER TABLE public.assertions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage assertions of their runs" ON public.assertions FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.runs r WHERE r.id = run_id AND r.user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM public.runs r WHERE r.id = run_id AND r.user_id = auth.uid()));

CREATE TABLE public.invocations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES public.runs(id) ON DELETE CASCADE,
  task_id UUID,
  agent_index INT,
  connector TEXT NOT NULL,
  provider TEXT NOT NULL,
  operation TEXT NOT NULL,
  query TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  item_count INT NOT NULL DEFAULT 0,
  cost NUMERIC NOT NULL DEFAULT 0,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX idx_invocations_run ON public.invocations(run_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invocations TO authenticated;
GRANT ALL ON public.invocations TO service_role;
ALTER TABLE public.invocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage invocations of their runs" ON public.invocations FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.runs r WHERE r.id = run_id AND r.user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM public.runs r WHERE r.id = run_id AND r.user_id = auth.uid()));

CREATE TABLE public.votes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES public.runs(id) ON DELETE CASCADE,
  epoch INT NOT NULL,
  agent_index INT NOT NULL,
  revision BIGINT NOT NULL,
  decision TEXT NOT NULL,
  rationale TEXT,
  gap_task TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_votes_run ON public.votes(run_id, epoch);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.votes TO authenticated;
GRANT ALL ON public.votes TO service_role;
ALTER TABLE public.votes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage votes of their runs" ON public.votes FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.runs r WHERE r.id = run_id AND r.user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM public.runs r WHERE r.id = run_id AND r.user_id = auth.uid()));

CREATE TABLE public.events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES public.runs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  agent_index INT,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_events_run ON public.events(run_id, id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.events TO authenticated;
GRANT ALL ON public.events TO service_role;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage events of their runs" ON public.events FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.runs r WHERE r.id = run_id AND r.user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM public.runs r WHERE r.id = run_id AND r.user_id = auth.uid()));

CREATE TABLE public.checkpoints (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES public.runs(id) ON DELETE CASCADE,
  generation INT NOT NULL,
  manifest JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.checkpoints TO authenticated;
GRANT ALL ON public.checkpoints TO service_role;
ALTER TABLE public.checkpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage checkpoints of their runs" ON public.checkpoints FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.runs r WHERE r.id = run_id AND r.user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM public.runs r WHERE r.id = run_id AND r.user_id = auth.uid()));

ALTER PUBLICATION supabase_realtime ADD TABLE public.nodes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.edges;
ALTER PUBLICATION supabase_realtime ADD TABLE public.events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.runs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;