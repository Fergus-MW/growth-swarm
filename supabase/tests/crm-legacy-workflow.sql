-- Disposable database, migrations applied, run as migration owner; rolls back.
BEGIN;
INSERT INTO public.runs(id,user_id,objective) VALUES
 ('18100000-0000-4000-8000-000000000001','18100000-0000-4000-8000-000000000010','Legacy migration fixture');
INSERT INTO public.crm_records(id,user_id,origin_run_id,entity_type,identity_key,title,fields)
SELECT ('18100000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
 '18100000-0000-4000-8000-000000000010','18100000-0000-4000-8000-000000000001','company','legacy-test-' || n,title,jsonb_build_object('website',website)
FROM (VALUES (20,'Unique company','https://www.unique.example/path'),(21,'Ambiguous one','same.example'),(22,'Ambiguous two','same.example'),(23,'Already edited','edited.example'),(24,'Invalid legacy stage','invalid.example')) AS examples(n,title,website);
INSERT INTO public.crm_record_working_state(record_id,user_id,stage,notes,version)
VALUES('18100000-0000-4000-8000-000000000023','18100000-0000-4000-8000-000000000010','meeting','New stable note',1);
INSERT INTO public.leads(user_id,lead_key,stage,notes,starred)
SELECT '18100000-0000-4000-8000-000000000010',key,stage,note,true
FROM (VALUES ('unique.example','contacted','Old user note'),('same.example','reviewing','Ambiguous user note'),('edited.example','new','Conflicting old note'),('invalid.example','arbitrary-stage','Invalid stage note'),('missing.example','won','Unmatched user note')) AS examples(key,stage,note);
SELECT private.import_existing_legacy_crm_workflow();
DO $$ BEGIN
  ASSERT (SELECT stage='contacted' AND starred AND notes='Old user note' AND version=1 FROM public.crm_record_working_state WHERE record_id='18100000-0000-4000-8000-000000000020'), 'Unambiguous legacy work must import';
  ASSERT (SELECT after_state->>'notes' FROM public.crm_record_working_history WHERE record_id='18100000-0000-4000-8000-000000000020')='Old user note', 'Imported edits must have attributed history';
  ASSERT (SELECT count(*) FROM public.crm_record_working_state WHERE record_id IN ('18100000-0000-4000-8000-000000000021','18100000-0000-4000-8000-000000000022'))=0, 'Ambiguous name/domain must never choose a company';
  ASSERT (SELECT notes FROM public.crm_record_working_state WHERE record_id='18100000-0000-4000-8000-000000000023')='New stable note', 'Existing stable edits must win without deleting old edits';
  ASSERT (SELECT count(*) FROM public.crm_legacy_workflow_imports WHERE user_id='18100000-0000-4000-8000-000000000010' AND status IN ('ambiguous','existing_edits','invalid','unmatched'))=4, 'Every unresolved legacy entry must be retained for review';
  ASSERT (SELECT count(*) FROM public.leads WHERE user_id='18100000-0000-4000-8000-000000000010')=5, 'All original legacy rows must survive';
  ASSERT private.crm_legacy_key('Acme, Ltd.', '{}')='acme', 'Legacy name normalization must match';
  ASSERT private.crm_legacy_key('Acme','{"website":"HTTPS://WWW.EXAMPLE.COM/a?q=1"}')='example.com', 'Legacy domain normalization must match';
END $$;
-- Later observations and re-running the helper never reassign reviewed entries.
INSERT INTO public.crm_records(id,user_id,origin_run_id,entity_type,identity_key,title,fields)
VALUES ('18100000-0000-4000-8000-000000000025','18100000-0000-4000-8000-000000000010','18100000-0000-4000-8000-000000000001','company','legacy-test-later','Later company','{"website":"missing.example"}');
UPDATE public.leads SET notes='Late edit in old browser' WHERE user_id='18100000-0000-4000-8000-000000000010' AND lead_key='unique.example';
SELECT private.import_existing_legacy_crm_workflow();
DO $$ BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.crm_record_working_state WHERE record_id='18100000-0000-4000-8000-000000000025'), 'A later match must not silently acquire orphaned edits';
  ASSERT (SELECT notes FROM public.crm_record_working_state WHERE record_id='18100000-0000-4000-8000-000000000020')='Old user note', 'Old browser edits must not overwrite stable workflow';
  ASSERT (SELECT count(*) FROM public.crm_record_working_history WHERE record_id='18100000-0000-4000-8000-000000000020')=1, 'Import retry must be idempotent';
  ASSERT (SELECT legacy_snapshot->>'notes' FROM public.crm_legacy_workflow_imports WHERE imported_record_id='18100000-0000-4000-8000-000000000020')='Old user note', 'Import snapshot must remain immutable';
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','18100000-0000-4000-8000-000000000011',true);
DO $$ BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.leads WHERE user_id='18100000-0000-4000-8000-000000000010'), 'Legacy notes must not leak across users';
  ASSERT NOT EXISTS (SELECT 1 FROM public.crm_legacy_workflow_imports WHERE user_id='18100000-0000-4000-8000-000000000010'), 'Legacy import snapshots must not leak across users';
END $$;
RESET ROLE;
ROLLBACK;
