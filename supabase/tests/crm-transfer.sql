-- Run against a local Supabase database after migrations:
-- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/crm-transfer.sql
-- Fixtures and deliberately injected faults are rolled back.
begin;
create function pg_temp.assert_true(actual boolean, message text) returns void
language plpgsql as $$ begin if actual is distinct from true then raise exception 'Assertion failed: %', message; end if; end $$;

insert into public.runs(id,user_id,objective,status,graph_revision) values
 ('15000000-0000-0000-0000-000000000001','15000000-0000-0000-0000-000000000099','Completion fixture','running',42),
 ('15000000-0000-0000-0000-000000000002','15000000-0000-0000-0000-000000000099','Later research','running',7),
 ('15000000-0000-0000-0000-000000000003','15000000-0000-0000-0000-000000000099','Fault and retry','running',9),
 ('15000000-0000-0000-0000-000000000004','15000000-0000-0000-0000-000000000099','Partial research','running',3);
insert into public.nodes(id,run_id,category,entity_type,title,fields,free_text,confidence) values
 ('15100000-0000-0000-0000-000000000001','15000000-0000-0000-0000-000000000001','primary_entity','company','Same name','{"status":"qualified","registration_country":"GB","registration_number":"12345"}','Research prose','high'),
 ('15100000-0000-0000-0000-000000000002','15000000-0000-0000-0000-000000000001','primary_entity','company','Same name','{"status":"rejected","gaps":["Not in territory"]}',null,'low'),
 ('15100000-0000-0000-0000-000000000003','15000000-0000-0000-0000-000000000001','primary_entity','person','Sam','{"status":"candidate","email":" SAM@example.org "}',null,'medium'),
 ('15100000-0000-0000-0000-000000000004','15000000-0000-0000-0000-000000000001','primary_entity','person','Sam','{"status":"excluded"}',null,'low'),
 ('15100000-0000-0000-0000-000000000005','15000000-0000-0000-0000-000000000001','source_chunk',null,'Evidence','{}',null,null),
 ('15100000-0000-0000-0000-000000000006','15000000-0000-0000-0000-000000000001','note',null,'Supporting note','{}',null,null);
insert into public.edges(run_id,from_node,to_node,relation) values
 ('15000000-0000-0000-0000-000000000001','15100000-0000-0000-0000-000000000003','15100000-0000-0000-0000-000000000001','works_at');
update public.runs set status='completed',outcome='consensus' where id='15000000-0000-0000-0000-000000000001';
select pg_temp.assert_true((select status='ready' and source_count=4 and company_count=2 and person_count=2 and created_count=4 and linked_count=0 and graph_revision=42 from public.crm_transfers where run_id='15000000-0000-0000-0000-000000000001'),'all entities, counts and final revision');
select pg_temp.assert_true((select count(*)=4 from public.crm_record_sources where run_id='15000000-0000-0000-0000-000000000001'),'no note/chunk promoted');
select pg_temp.assert_true((select snapshot->'fields'->>'status'='excluded' from public.crm_record_sources where node_id='15100000-0000-0000-0000-000000000004'),'excluded person without employer retained');
select pg_temp.assert_true((select snapshot->>'free_text'='Research prose' and snapshot->>'provenance'='research' from public.crm_record_sources where node_id='15100000-0000-0000-0000-000000000001'),'immutable original prose/provenance snapshot');

-- Idempotence on repeated completion, with no new attempt or duplicate mappings.
update public.runs set status='completed' where id='15000000-0000-0000-0000-000000000001';
select pg_temp.assert_true((select attempts=1 from public.crm_transfers where run_id='15000000-0000-0000-0000-000000000001'),'duplicate completion idempotent');

-- A later run links explicit identities, retains both same-name unverified
-- people, and must not replace the first research observation.
insert into public.nodes(run_id,category,entity_type,title,fields) values
 ('15000000-0000-0000-0000-000000000002','primary_entity','company','Changed company name','{"registration_country":"gb","registration_number":"12345"}'),
 ('15000000-0000-0000-0000-000000000002','primary_entity','person','Samuel','{"email":"sam@example.org"}'),
 ('15000000-0000-0000-0000-000000000002','primary_entity','person','Sam','{}');
update public.runs set status='completed',outcome='consensus' where id='15000000-0000-0000-0000-000000000002';
select pg_temp.assert_true((select source_count=3 and linked_count=2 and created_count=1 from public.crm_transfers where run_id='15000000-0000-0000-0000-000000000002'),'strong cross-run identities and ambiguous names');
select pg_temp.assert_true((select title='Same name' and free_text='Research prose' from public.crm_records where identity_key='registration:gb:12345' and user_id='15000000-0000-0000-0000-000000000099'),'later research cannot overwrite original');

-- PostgREST's default 1000-row page size cannot truncate database delivery.
insert into public.nodes(run_id,category,entity_type,title,fields)
 select '15000000-0000-0000-0000-000000000003','primary_entity','person','Person '||i,'{}'::jsonb from generate_series(1,1205) i;
create function pg_temp.fail_transfer() returns trigger language plpgsql as $$
begin if new.run_id='15000000-0000-0000-0000-000000000003' then raise exception 'Injected failure'; end if; return new; end $$;
create trigger inject_transfer_failure before insert on public.crm_record_sources for each row execute function pg_temp.fail_transfer();
update public.runs set status='completed',outcome='consensus' where id='15000000-0000-0000-0000-000000000003';
select pg_temp.assert_true((select status='failed' and source_count=1205 and failed_count=1205 from public.crm_transfers where run_id='15000000-0000-0000-0000-000000000003'),'failed transfer reconciles every source');
select pg_temp.assert_true(not exists(select 1 from public.crm_records where origin_run_id='15000000-0000-0000-0000-000000000003'),'failed transfer rolls back all records');
select pg_temp.assert_true((select status='completed' from public.runs where id='15000000-0000-0000-0000-000000000003'),'research completion survives transfer failure');
drop trigger inject_transfer_failure on public.crm_record_sources;

set local role authenticated;
set local request.jwt.claim.sub = '15000000-0000-0000-0000-000000000099';
select public.retry_crm_transfer('15000000-0000-0000-0000-000000000003');
select pg_temp.assert_true((select status='ready' and source_count=1205 and created_count=1205 and attempts=2 from public.crm_transfers where run_id='15000000-0000-0000-0000-000000000003'),'retry delivers more than one API page');
select public.retry_crm_transfer('15000000-0000-0000-0000-000000000003');
select pg_temp.assert_true((select attempts=2 from public.crm_transfers where run_id='15000000-0000-0000-0000-000000000003'),'retry ready is idempotent');

do $$ begin
  begin update public.nodes set title='Overwrite' where id='15100000-0000-0000-0000-000000000001'; raise exception 'MUTATION SUCCEEDED';
  exception when others then if sqlerrm <> 'Completed research is immutable' then raise; end if; end;
  begin update public.runs set status='running' where id='15000000-0000-0000-0000-000000000001'; raise exception 'REOPEN SUCCEEDED';
  exception when others then if sqlerrm <> 'Completed research cannot be reopened; create a continuation' then raise; end if; end;
end $$;

-- Isolation holds for both table reads and the definer retry RPC.
set local request.jwt.claim.sub = '15000000-0000-0000-0000-000000000098';
select pg_temp.assert_true(not exists(select 1 from public.crm_records where user_id='15000000-0000-0000-0000-000000000099'),'cross-user record isolation');
select pg_temp.assert_true(not exists(select 1 from public.crm_record_sources where user_id='15000000-0000-0000-0000-000000000099'),'cross-user source isolation');
select pg_temp.assert_true(not exists(select 1 from public.crm_transfers where user_id='15000000-0000-0000-0000-000000000099'),'cross-user transfer isolation');
do $$ begin
  begin perform public.retry_crm_transfer('15000000-0000-0000-0000-000000000003'); raise exception 'FOREIGN RETRY SUCCEEDED';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- If a connection/transaction aborts around completion, no partial transfer
-- or completed status survives. Replaying the same completion delivers once.
savepoint interrupted_completion;
update public.runs set status='completed',outcome='consensus' where id='15000000-0000-0000-0000-000000000004';
select pg_temp.assert_true((select status='ready' and source_count=0 from public.crm_transfers where run_id='15000000-0000-0000-0000-000000000004'),'empty completed graph is a valid empty delivery');
rollback to savepoint interrupted_completion;
select pg_temp.assert_true((select status='running' from public.runs where id='15000000-0000-0000-0000-000000000004'),'interrupted completion rolled back research status');
select pg_temp.assert_true(not exists(select 1 from public.crm_transfers where run_id='15000000-0000-0000-0000-000000000004'),'interrupted completion leaves no partial transfer');

-- A budget stop is never a successful delivery.
update public.runs set status='ended',outcome='budget_cost' where id='15000000-0000-0000-0000-000000000004';
select pg_temp.assert_true(not exists(select 1 from public.crm_transfers where run_id='15000000-0000-0000-0000-000000000004'),'partial result not transferred');

-- Even a record linked by a second source cannot expose its cached original
-- observation after the original run is no longer accessible.
update public.runs set user_id='15000000-0000-0000-0000-000000000098' where id='15000000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claim.sub = '15000000-0000-0000-0000-000000000099';
select pg_temp.assert_true(not exists(select 1 from public.crm_records where identity_key='registration:gb:12345'),'source revocation hides cached original');
select pg_temp.assert_true(not exists(select 1 from public.crm_record_sources where node_id='15100000-0000-0000-0000-000000000001'),'revoked snapshot hidden');
reset role;

-- Deletion cascades without retaining inaccessible cached research.
delete from public.runs where id='15000000-0000-0000-0000-000000000001';
select pg_temp.assert_true(not exists(select 1 from public.crm_records where origin_run_id='15000000-0000-0000-0000-000000000001'),'source deletion removes cached records');
rollback;
