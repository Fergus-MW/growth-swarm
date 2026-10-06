CREATE TABLE public.crm_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('company', 'person')),
  identity_key text NOT NULL,
  stage text NOT NULL DEFAULT 'new' CHECK (stage IN ('new', 'reviewing', 'contacted', 'meeting', 'won', 'lost')),
  notes text,
  starred boolean NOT NULL DEFAULT false,
  overrides jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, identity_key)
);

CREATE TABLE public.crm_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  record_id uuid NOT NULL REFERENCES public.crm_records(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.runs(id) ON DELETE CASCADE,
  node_id uuid NOT NULL REFERENCES public.nodes(id) ON DELETE CASCADE,
  revision int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, run_id, node_id)
);

CREATE TABLE public.crm_transfers (
  run_id uuid PRIMARY KEY REFERENCES public.runs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'ready', 'failed')),
  error text,
  graph_revision bigint NOT NULL DEFAULT 0,
  source_count int NOT NULL DEFAULT 0,
  created_count int NOT NULL DEFAULT 0,
  reused_count int NOT NULL DEFAULT 0,
  failed_count int NOT NULL DEFAULT 0,
  company_count int NOT NULL DEFAULT 0,
  person_count int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_crm_records_user ON public.crm_records(user_id, kind);
CREATE INDEX idx_crm_mappings_record ON public.crm_mappings(record_id);
CREATE INDEX idx_crm_mappings_run ON public.crm_mappings(run_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_records TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_mappings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_transfers TO authenticated;
GRANT ALL ON public.crm_records TO service_role;
GRANT ALL ON public.crm_mappings TO service_role;
GRANT ALL ON public.crm_transfers TO service_role;

ALTER TABLE public.crm_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own CRM records" ON public.crm_records
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users manage their own CRM mappings" ON public.crm_mappings
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users manage their own CRM transfers" ON public.crm_transfers
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
