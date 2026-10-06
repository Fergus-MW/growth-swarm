-- Run against a disposable database after all migrations, as its migration owner.
-- auth.uid() must respect request.jwt.claim.sub (standard Supabase test setup).
BEGIN;
INSERT INTO public.runs(id,user_id,objective) VALUES
 ('18000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000010','CRM workflow fixture');
INSERT INTO public.nodes(id,run_id,category,entity_type,title,fields) VALUES
 ('18000000-0000-4000-8000-000000000002','18000000-0000-4000-8000-000000000001','primary_entity','company','Original company','{"registration_country":"gb","registration_number":"WORKFLOW-18","status":"qualified","location":"London"}'),
 ('18000000-0000-4000-8000-000000000003','18000000-0000-4000-8000-000000000001','primary_entity','person','Original person','{"email":"workflow-18@example.org","status":"candidate"}');
UPDATE public.runs SET status='completed',outcome='consensus' WHERE id='18000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','18000000-0000-4000-8000-000000000010',true);
DO $$
DECLARE rec record; result jsonb;
BEGIN
  FOR rec IN SELECT * FROM public.crm_records WHERE origin_run_id='18000000-0000-4000-8000-000000000001' LOOP
    result := public.save_crm_working_state(rec.id,0,'contacted',true,'Keep my note','{"name":"Corrected name"}');
    ASSERT result->>'ok'='true', 'Company and person saves must succeed';
    ASSERT (SELECT fields->>'status' FROM public.crm_records WHERE id=rec.id) IN ('qualified','candidate'), 'Sales stage must not change qualification';
    result := public.save_crm_working_state(rec.id,0,'won',false,'Stale overwrite','{}');
    ASSERT result->>'conflict'='true', 'Stale writes must conflict';
    ASSERT result->'state'->>'notes'='Keep my note', 'Stale save must retain notes';
    ASSERT (SELECT count(*) FROM public.crm_record_working_history WHERE record_id=rec.id)=1, 'Conflicts must not append a successful edit';
    BEGIN
      PERFORM public.save_crm_working_state(rec.id,1,'qualified',true,NULL,'{}');
      RAISE EXCEPTION 'Invalid stage was accepted';
    EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
    BEGIN
      PERFORM public.save_crm_working_state(rec.id,1,'new',true,NULL,'{"status":"qualified"}');
      RAISE EXCEPTION 'Research override was accepted';
    EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
    BEGIN
      UPDATE public.crm_record_working_state SET notes='Bypass' WHERE record_id=rec.id;
      RAISE EXCEPTION 'Direct write bypassed version/audit';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    result := public.save_crm_working_state(rec.id,1,'meeting',true,'Keep my note; reviewed update','{"name":"Corrected name"}');
    ASSERT result->>'ok'='true', 'Reviewed update must succeed';
    ASSERT (SELECT before_state->>'notes' FROM public.crm_record_working_history WHERE record_id=rec.id AND version=2)='Keep my note', 'History must retain original notes';
  END LOOP;
END $$;
RESET ROLE;
-- Another run matches the company/person but changes research; retry is idempotent.
INSERT INTO public.runs(id,user_id,parent_run_id,objective) VALUES
 ('18000000-0000-4000-8000-000000000004','18000000-0000-4000-8000-000000000010','18000000-0000-4000-8000-000000000001','Follow-up');
INSERT INTO public.nodes(run_id,category,entity_type,title,fields)
SELECT '18000000-0000-4000-8000-000000000004',category,entity_type,'Changed research name',fields || '{"location":"Paris"}'::jsonb
FROM public.nodes WHERE run_id='18000000-0000-4000-8000-000000000001';
UPDATE public.runs SET status='completed',outcome='consensus' WHERE id='18000000-0000-4000-8000-000000000004';
SELECT private.transfer_completed_run('18000000-0000-4000-8000-000000000004');
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.crm_records WHERE user_id='18000000-0000-4000-8000-000000000010')=2, 'Matching child results must retain stable identity';
  ASSERT (SELECT count(*) FROM public.crm_record_working_state WHERE user_id='18000000-0000-4000-8000-000000000010' AND stage='meeting' AND starred AND version=2 AND overrides->>'name'='Corrected name')=2, 'Retry and child transfer must preserve all edits';
  ASSERT (SELECT count(*) FROM public.crm_record_sources WHERE user_id='18000000-0000-4000-8000-000000000010')=4, 'Both research versions must survive';
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','18000000-0000-4000-8000-000000000011',true);
DO $$ BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.crm_record_working_state WHERE user_id='18000000-0000-4000-8000-000000000010'), 'Cross-user state reads must be denied';
  ASSERT NOT EXISTS (SELECT 1 FROM public.crm_record_working_history WHERE user_id='18000000-0000-4000-8000-000000000010'), 'Cross-user history reads must be denied';
END $$;
RESET ROLE;
-- Capture known victim id then attempt cross-user write using it.
SELECT set_config('test.workflow_record',(SELECT id::text FROM public.crm_records WHERE origin_run_id='18000000-0000-4000-8000-000000000001' LIMIT 1),true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.save_crm_working_state(current_setting('test.workflow_record')::uuid,2,'won',false,'Attack','{}');
    RAISE EXCEPTION 'Cross-user write succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
-- Even an owned child source cannot restore access after original research is revoked.
UPDATE public.runs SET user_id='18000000-0000-4000-8000-000000000011' WHERE id='18000000-0000-4000-8000-000000000001';
SELECT set_config('request.jwt.claim.sub','18000000-0000-4000-8000-000000000010',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.crm_record_working_state WHERE user_id='18000000-0000-4000-8000-000000000010'), 'Revoked original source hides edits';
  BEGIN
    PERFORM public.save_crm_working_state(current_setting('test.workflow_record')::uuid,2,'won',false,'Attack','{}');
    RAISE EXCEPTION 'Revoked original source allowed write';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
