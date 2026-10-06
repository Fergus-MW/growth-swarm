-- Preserve existing user work when replacing mutable lead keys with stable IDs.
-- This runs once for existing leads. Future transfers never rerun name/domain matching.
CREATE TABLE public.crm_legacy_workflow_imports (
  legacy_id uuid PRIMARY KEY REFERENCES public.leads(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('imported','ambiguous','unmatched','existing_edits','invalid')),
  candidate_count integer NOT NULL,
  imported_record_id uuid REFERENCES public.crm_records(id) ON DELETE SET NULL,
  legacy_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_legacy_workflow_imports ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.crm_legacy_workflow_imports TO authenticated;
GRANT ALL ON public.crm_legacy_workflow_imports TO service_role;
CREATE POLICY "Read own legacy CRM import" ON public.crm_legacy_workflow_imports
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Exact counterpart of the previous leadKeyFor implementation. This is only
-- migration matching, never a new canonical identity rule.
CREATE FUNCTION private.crm_legacy_key(p_title text, p_fields jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE website text; host text;
BEGIN
  IF jsonb_typeof(p_fields->'website') = 'string' THEN website := p_fields->>'website'; END IF;
  IF coalesce(website,'') <> '' THEN
    host := lower(split_part(split_part(split_part(regexp_replace(regexp_replace(website, '^https?://', '', 'i'), '^www\.', '', 'i'), '/', 1), '?', 1), '#', 1));
    IF host <> '' THEN RETURN host; END IF;
  END IF;
  -- JavaScript \b is ASCII-based, including its unusual boundary after ü.
  RETURN trim(both '-' FROM regexp_replace(regexp_replace(lower(p_title), '(?<![a-z0-9_])(inc|ltd|llc|gmbh|as|ab|plc|corp)(?![a-z0-9_])\.?|(?<![a-z0-9_])oü(?=[a-z0-9_])\.?', '', 'g'), '[^a-z0-9]+', '-', 'g'));
END;
$$;
REVOKE ALL ON FUNCTION private.crm_legacy_key(text,jsonb) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.import_existing_legacy_crm_workflow() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  legacy public.leads; candidates uuid[]; target uuid; outcome text;
  prior public.crm_record_working_state; saved public.crm_record_working_state;
BEGIN
  FOR legacy IN SELECT * FROM public.leads l
    WHERE NOT EXISTS (SELECT 1 FROM public.crm_legacy_workflow_imports i WHERE i.legacy_id=l.id)
    ORDER BY l.id FOR UPDATE LOOP
    SELECT array_agg(DISTINCT r.id ORDER BY r.id) INTO candidates
    FROM public.crm_records r
    WHERE r.user_id=legacy.user_id
      AND r.entity_type='company'
      AND EXISTS (SELECT 1 FROM public.runs origin WHERE origin.id=r.origin_run_id AND origin.user_id=legacy.user_id)
      AND (
        private.crm_legacy_key(r.title,r.fields)=legacy.lead_key
        OR EXISTS (
          SELECT 1 FROM public.crm_record_sources s JOIN public.runs run ON run.id=s.run_id
          WHERE s.crm_record_id=r.id AND s.user_id=legacy.user_id AND run.user_id=legacy.user_id
            AND private.crm_legacy_key(s.snapshot->>'title',s.snapshot->'fields')=legacy.lead_key
        )
      );
    target := NULL;
    outcome := CASE coalesce(cardinality(candidates),0) WHEN 0 THEN 'unmatched' WHEN 1 THEN 'imported' ELSE 'ambiguous' END;
    IF outcome='imported' THEN
      target := candidates[1];
      PERFORM 1 FROM public.crm_records WHERE id=target FOR UPDATE;
      SELECT * INTO prior FROM public.crm_record_working_state WHERE record_id=target FOR UPDATE;
      IF prior.record_id IS NOT NULL AND (prior.version<>0 OR prior.stage<>'new' OR prior.starred OR prior.notes IS NOT NULL OR prior.overrides<>'{}') THEN
        outcome := 'existing_edits';
      ELSIF legacy.stage NOT IN ('new','reviewing','contacted','meeting','won','lost') OR length(legacy.notes)>10000 THEN
        outcome := 'invalid';
      ELSE
        INSERT INTO public.crm_record_working_state(record_id,user_id) VALUES(target,legacy.user_id) ON CONFLICT DO NOTHING;
        SELECT * INTO prior FROM public.crm_record_working_state WHERE record_id=target;
        UPDATE public.crm_record_working_state SET stage=legacy.stage,starred=legacy.starred,notes=legacy.notes,
          version=1,updated_at=legacy.updated_at WHERE record_id=target RETURNING * INTO saved;
        INSERT INTO public.crm_record_working_history(record_id,user_id,actor_id,version,before_state,after_state,created_at)
          VALUES(target,legacy.user_id,legacy.user_id,1,to_jsonb(prior),to_jsonb(saved),legacy.updated_at);
      END IF;
    END IF;
    INSERT INTO public.crm_legacy_workflow_imports(legacy_id,user_id,status,candidate_count,imported_record_id,legacy_snapshot)
      VALUES(legacy.id,legacy.user_id,outcome,coalesce(cardinality(candidates),0),CASE WHEN outcome='imported' THEN target ELSE NULL END,to_jsonb(legacy));
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION private.import_existing_legacy_crm_workflow() FROM PUBLIC, anon, authenticated;
SELECT private.import_existing_legacy_crm_workflow();
