-- CRM edits live outside immutable research and are never written by transfer.
CREATE TABLE public.crm_record_working_state (
  record_id uuid PRIMARY KEY REFERENCES public.crm_records(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  stage text NOT NULL DEFAULT 'new' CHECK (stage IN ('new','reviewing','contacted','meeting','won','lost')),
  starred boolean NOT NULL DEFAULT false,
  notes text CHECK (length(notes) <= 10000),
  overrides jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(overrides) = 'object'),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.crm_record_working_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id uuid NOT NULL REFERENCES public.crm_records(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  version integer NOT NULL,
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (record_id, version)
);

ALTER TABLE public.crm_record_working_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_record_working_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read own accessible CRM working state" ON public.crm_record_working_state
FOR SELECT TO authenticated USING (user_id = auth.uid() AND EXISTS (
  SELECT 1 FROM public.crm_records r WHERE r.id = record_id AND r.user_id = auth.uid()
));
CREATE POLICY "Read own accessible CRM working history" ON public.crm_record_working_history
FOR SELECT TO authenticated USING (user_id = auth.uid() AND EXISTS (
  SELECT 1 FROM public.crm_records r WHERE r.id = record_id AND r.user_id = auth.uid()
));
-- Writes must pass through the version check and append-only audit transaction.
GRANT SELECT ON public.crm_record_working_state, public.crm_record_working_history TO authenticated;
GRANT ALL ON public.crm_record_working_state, public.crm_record_working_history TO service_role;

CREATE FUNCTION public.save_crm_working_state(
  p_record_id uuid, p_expected_version integer, p_stage text,
  p_starred boolean, p_notes text, p_overrides jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid := auth.uid();
  v_type text;
  v_before public.crm_record_working_state;
  v_after public.crm_record_working_state;
  v_key text;
  v_value jsonb;
  v_allowed text[];
BEGIN
  -- Lock the stable identity, also serializing first writes before a state row exists.
  SELECT r.entity_type INTO v_type FROM public.crm_records r
  WHERE r.id = p_record_id AND r.user_id = v_user
    AND EXISTS (SELECT 1 FROM public.runs origin WHERE origin.id = r.origin_run_id AND origin.user_id = v_user)
    AND EXISTS (SELECT 1 FROM public.crm_record_sources s JOIN public.runs run ON run.id = s.run_id
      WHERE s.crm_record_id = r.id AND s.user_id = v_user AND run.user_id = v_user)
  FOR UPDATE;
  IF v_type IS NULL THEN RAISE EXCEPTION 'CRM record not found or not accessible' USING ERRCODE = '42501'; END IF;
  IF p_expected_version IS NULL OR p_expected_version < 0 OR p_stage IS NULL OR
    p_stage NOT IN ('new','reviewing','contacted','meeting','won','lost') OR p_starred IS NULL OR length(p_notes) > 10000 THEN
    RAISE EXCEPTION 'Invalid CRM workflow fields' USING ERRCODE = '22023';
  END IF;
  IF p_overrides IS NULL OR jsonb_typeof(p_overrides) <> 'object' THEN
    RAISE EXCEPTION 'Overrides must be an object' USING ERRCODE = '22023';
  END IF;
  v_allowed := CASE v_type WHEN 'company' THEN ARRAY['name','website','location','size','industry','phone']
    ELSE ARRAY['name','email','phone','role','linkedin','location'] END;
  FOR v_key, v_value IN SELECT * FROM jsonb_each(p_overrides) LOOP
    IF NOT (v_key = ANY(v_allowed)) OR jsonb_typeof(v_value) <> 'string' OR length(v_value #>> '{}') > 2000 THEN
      RAISE EXCEPTION 'Invalid editable field: %', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;
  INSERT INTO public.crm_record_working_state(record_id, user_id) VALUES (p_record_id, v_user)
    ON CONFLICT (record_id) DO NOTHING;
  SELECT * INTO v_before FROM public.crm_record_working_state WHERE record_id = p_record_id FOR UPDATE;
  IF v_before.version <> p_expected_version THEN
    RETURN jsonb_build_object('ok',false,'conflict',true,'state',to_jsonb(v_before));
  END IF;
  UPDATE public.crm_record_working_state SET stage = p_stage, starred = p_starred,
    notes = p_notes, overrides = p_overrides, version = version + 1, updated_at = now()
    WHERE record_id = p_record_id RETURNING * INTO v_after;
  INSERT INTO public.crm_record_working_history(record_id,user_id,actor_id,version,before_state,after_state)
    VALUES (p_record_id,v_user,v_user,v_after.version,to_jsonb(v_before),to_jsonb(v_after));
  RETURN jsonb_build_object('ok',true,'conflict',false,'state',to_jsonb(v_after));
END;
$$;
REVOKE ALL ON FUNCTION public.save_crm_working_state(uuid,integer,text,boolean,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_crm_working_state(uuid,integer,text,boolean,text,jsonb) TO authenticated;
