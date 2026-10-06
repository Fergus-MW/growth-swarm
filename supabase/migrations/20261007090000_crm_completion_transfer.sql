-- Completed research is delivered to the application's CRM inside the same
-- database transaction that records completion. No browser worker is required.
create schema if not exists private;
revoke all on schema private from public;

create table public.crm_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  entity_type text not null check (entity_type in ('company', 'person')),
  identity_key text not null,
  origin_run_id uuid not null references public.runs(id) on delete cascade,
  title text not null,
  fields jsonb not null default '{}',
  free_text text,
  confidence text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, entity_type, identity_key)
);
create table public.crm_record_sources (
  id uuid primary key default gen_random_uuid(),
  crm_record_id uuid not null references public.crm_records(id) on delete cascade,
  user_id uuid not null,
  run_id uuid not null references public.runs(id) on delete cascade,
  node_id uuid not null references public.nodes(id) on delete cascade,
  graph_revision bigint not null,
  node_revision integer not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique (run_id, node_id)
);
create index crm_sources_record on public.crm_record_sources(crm_record_id);
create index crm_sources_run on public.crm_record_sources(run_id);
create table public.crm_transfers (
  run_id uuid primary key references public.runs(id) on delete cascade,
  user_id uuid not null,
  graph_revision bigint not null,
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  source_count integer not null default 0,
  company_count integer not null default 0,
  person_count integer not null default 0,
  created_count integer not null default 0,
  linked_count integer not null default 0,
  failed_count integer not null default 0,
  attempts integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_count >= 0 and created_count >= 0 and linked_count >= 0 and failed_count >= 0),
  check (status <> 'ready' or source_count = created_count + linked_count)
);
alter table public.crm_records enable row level security;
alter table public.crm_record_sources enable row level security;
alter table public.crm_transfers enable row level security;
grant select on public.crm_records, public.crm_record_sources, public.crm_transfers to authenticated;
grant all on public.crm_records, public.crm_record_sources, public.crm_transfers to service_role;
create policy crm_records_read on public.crm_records for select to authenticated using (
  user_id = (select auth.uid()) and exists (
    select 1 from public.runs r where r.id = origin_run_id and r.user_id = (select auth.uid())
  )
);
create policy crm_sources_read on public.crm_record_sources for select to authenticated using (
  user_id = (select auth.uid()) and exists (
    select 1 from public.runs r where r.id = run_id and r.user_id = (select auth.uid())
  ) and exists (select 1 from public.crm_records c where c.id = crm_record_id)
);
create policy crm_transfers_read on public.crm_transfers for select to authenticated using (
  user_id = (select auth.uid()) and exists (
    select 1 from public.runs r where r.id = run_id and r.user_id = (select auth.uid())
  )
);

-- Deliberately never merge by display name or website domain. Only explicit
-- registration jurisdiction+number and individual contact identifiers qualify.
create function private.crm_identity(p_node public.nodes) returns text
language plpgsql immutable set search_path = '' as $$
declare v text; country text; registration text;
begin
  if p_node.entity_type = 'company' then
    country := lower(btrim(p_node.fields->>'registration_country'));
    registration := lower(btrim(p_node.fields->>'registration_number'));
    if country ~ '^[a-z]{2}$' and registration ~ '^[a-z0-9][a-z0-9 .-]+$' then
      return 'registration:' || country || ':' || registration;
    end if;
  elsif p_node.entity_type = 'person' then
    v := lower(btrim(p_node.fields->>'email'));
    if v ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      and split_part(v, '@', 1) not in ('info', 'hello', 'contact', 'sales', 'support', 'admin', 'office', 'team', 'jobs', 'careers', 'noreply') then
      return 'email:' || v;
    end if;
    v := lower(btrim(coalesce(p_node.fields->>'linkedin_url', p_node.fields->>'linkedin')));
    if v ~ '^https://(www\.)?linkedin\.com/in/[a-z0-9_%.-]+/?([?#].*)?$' then
      return 'linkedin:' || rtrim(split_part(split_part(regexp_replace(v, '^https://(www\.)?linkedin\.com/in/', ''), '?', 1), '#', 1), '/');
    end if;
  end if;
  return 'source:' || p_node.id::text;
end;
$$;
revoke all on function private.crm_identity(public.nodes) from public, anon, authenticated;

create function private.transfer_completed_run(p_run_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.runs; n public.nodes; transfer public.crm_transfers;
  record_id uuid; identity text; source_total integer; created_total integer := 0; linked_total integer := 0;
begin
  select * into strict r from public.runs where id = p_run_id for update;
  if r.status <> 'completed' or r.outcome is distinct from 'consensus' then
    raise exception 'Only successfully completed research can be transferred';
  end if;
  -- Serialize identity matching between different runs for the same owner.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(r.user_id::text, 0));
  select * into transfer from public.crm_transfers where run_id = r.id;
  select count(*) into source_total from public.nodes
    where run_id = r.id and category = 'primary_entity' and entity_type in ('company', 'person');
  if transfer.status = 'ready' and source_total = (
    select count(*) from public.crm_record_sources s
    join public.crm_records c on c.id = s.crm_record_id
    join public.runs origin on origin.id = c.origin_run_id and origin.user_id = r.user_id
    where s.run_id = r.id and s.user_id = r.user_id and c.user_id = r.user_id
  ) then return; end if;
  insert into public.crm_transfers(run_id, user_id, graph_revision, source_count, attempts)
    values (r.id, r.user_id, r.graph_revision, source_total, 1)
    on conflict (run_id) do update set status = 'pending', attempts = public.crm_transfers.attempts + 1,
      error = null, updated_at = now();
  update public.crm_transfers set
    company_count = (select count(*) from public.nodes where run_id = r.id and category = 'primary_entity' and entity_type = 'company'),
    person_count = (select count(*) from public.nodes where run_id = r.id and category = 'primary_entity' and entity_type = 'person')
    where run_id = r.id;
  -- A subtransaction rolls back ALL records/mappings if any entity fails.
  -- The enclosing transaction still commits research completion + failure state.
  begin
    -- Access can be revoked or an originating run erased after first delivery.
    -- Remove only invalid mappings; surviving records and workflow stay intact.
    delete from public.crm_record_sources s where s.run_id = r.id and not exists (
      select 1 from public.crm_records c join public.runs origin on origin.id = c.origin_run_id
      where c.id = s.crm_record_id and c.user_id = r.user_id and origin.user_id = r.user_id
    );
    select count(distinct c.id) filter (where c.origin_run_id = r.id), count(*)
      into created_total, linked_total
      from public.crm_record_sources s join public.crm_records c on c.id = s.crm_record_id
      where s.run_id = r.id;
    linked_total := linked_total - created_total;
    for n in select * from public.nodes candidate where candidate.run_id = r.id and candidate.category = 'primary_entity'
      and candidate.entity_type in ('company', 'person') and not exists (
        select 1 from public.crm_record_sources s where s.run_id = r.id and s.node_id = candidate.id
      ) order by candidate.id
    loop
      identity := private.crm_identity(n);
      select id into record_id from public.crm_records
        where user_id = r.user_id and entity_type = n.entity_type and identity_key = identity
        and exists (select 1 from public.runs origin where origin.id = origin_run_id and origin.user_id = r.user_id);
      if record_id is null then
        -- A previously matched record may have lost source access. Never read
        -- it or let its identity block the newly authorized observation.
        if exists (select 1 from public.crm_records where user_id = r.user_id
          and entity_type = n.entity_type and identity_key = identity) then
          identity := 'source:' || n.id::text;
        end if;
        insert into public.crm_records(user_id, entity_type, identity_key, origin_run_id, title, fields, free_text, confidence)
          values (r.user_id, n.entity_type, identity, r.id, n.title, n.fields, n.free_text, n.confidence)
          returning id into record_id;
        created_total := created_total + 1;
      else
        linked_total := linked_total + 1;
      end if;
      insert into public.crm_record_sources(crm_record_id, user_id, run_id, node_id, graph_revision, node_revision, snapshot)
        values(record_id, r.user_id, r.id, n.id, r.graph_revision, n.revision, to_jsonb(n));
    end loop;
    if source_total <> created_total + linked_total or source_total <>
      (select count(*) from public.crm_record_sources where run_id = r.id) then
      raise exception 'CRM source reconciliation failed';
    end if;
    update public.crm_transfers set status = 'ready', source_count = source_total,
      created_count = created_total, linked_count = linked_total, failed_count = 0, updated_at = now() where run_id = r.id;
  exception when others then
    update public.crm_transfers set status = 'failed', source_count = source_total,
      created_count = (select count(distinct s.crm_record_id) from public.crm_record_sources s
        join public.crm_records c on c.id=s.crm_record_id where s.run_id=r.id and c.origin_run_id=r.id),
      linked_count = (select count(*) - count(distinct c.id) filter (where c.origin_run_id=r.id)
        from public.crm_record_sources s join public.crm_records c on c.id=s.crm_record_id where s.run_id=r.id),
      failed_count = source_total - (select count(*) from public.crm_record_sources where run_id=r.id),
      error = 'CRM transfer failed; retry the transfer. Research is preserved.', updated_at = now() where run_id = r.id;
    raise warning 'CRM transfer for run % failed [%]: %', r.id, sqlstate, sqlerrm;
  end;
end;
$$;
revoke all on function private.transfer_completed_run(uuid) from public, anon, authenticated;

create function private.on_run_completed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'completed' and new.outcome = 'consensus' then
    perform private.transfer_completed_run(new.id);
  end if;
  return new;
end;
$$;
revoke all on function private.on_run_completed() from public, anon, authenticated;
create trigger transfer_run_to_crm after update of status, outcome on public.runs
  for each row when (new.status = 'completed' and new.outcome = 'consensus')
  execute function private.on_run_completed();

-- A narrow owner-checked RPC validates access before calling the private worker.
-- Definer is needed for the worker, but it is not exposed as a public RPC.
create function public.retry_crm_transfer(p_run_id uuid) returns public.crm_transfers
language plpgsql security definer set search_path = '' as $$
declare result public.crm_transfers; owner_id uuid;
begin
  select user_id into owner_id from public.runs where id = p_run_id for update;
  if auth.uid() is null or owner_id is distinct from auth.uid() then raise exception 'Run not found' using errcode = '42501'; end if;
  perform private.transfer_completed_run(p_run_id);
  select * into strict result from public.crm_transfers where run_id = p_run_id;
  return result;
end;
$$;
revoke all on function public.retry_crm_transfer(uuid) from public, anon;
grant execute on function public.retry_crm_transfer(uuid) to authenticated;

-- Keep source snapshots and their supporting graph immutable after completion.
-- Taking the parent lock also prevents graph writers racing the final transfer.
create function private.protect_completed_graph() returns trigger
language plpgsql security definer set search_path = '' as $$
declare parent_id uuid; parent_status text;
begin
  if tg_op <> 'INSERT' then
    parent_id := old.run_id;
    select status into parent_status from public.runs where id = parent_id for update;
    if parent_status = 'completed' then raise exception 'Completed research is immutable'; end if;
    update public.runs set graph_revision=graph_revision+1 where id=parent_id;
  end if;
  if tg_op <> 'DELETE' then
    parent_id := new.run_id;
    select status into parent_status from public.runs where id = parent_id for update;
    if parent_status = 'completed' then raise exception 'Completed research is immutable'; end if;
    if tg_op = 'INSERT' or new.run_id is distinct from old.run_id then
      update public.runs set graph_revision=graph_revision+1 where id=parent_id;
    end if;
    return new;
  end if;
  return old;
end;
$$;
revoke all on function private.protect_completed_graph() from public, anon, authenticated;
create trigger freeze_completed_nodes before insert or update or delete on public.nodes
  for each row execute function private.protect_completed_graph();
create trigger freeze_completed_edges before insert or update or delete on public.edges
  for each row execute function private.protect_completed_graph();
create trigger freeze_completed_assertions before insert or update or delete on public.assertions
  for each row execute function private.protect_completed_graph();

create function private.protect_completed_run() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status = 'completed' and (new.status <> old.status or new.outcome is distinct from old.outcome
      or new.graph_revision <> old.graph_revision) then
    raise exception 'Completed research cannot be reopened; create a continuation';
  end if;
  return new;
end;
$$;
revoke all on function private.protect_completed_run() from public, anon, authenticated;
create trigger freeze_completed_run before update on public.runs
  for each row execute function private.protect_completed_run();

-- Cascading retention deletes must never leave surviving runs falsely ready.
create function private.crm_record_removed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare affected record; remaining integer; original integer;
begin
  for affected in select distinct s.run_id from public.crm_record_sources s
    join public.runs r on r.id=s.run_id
    where s.crm_record_id=old.id and s.run_id<>old.origin_run_id
  loop
    select count(*), count(distinct c.id) filter (where c.origin_run_id=affected.run_id)
      into remaining, original from public.crm_record_sources s
      join public.crm_records c on c.id=s.crm_record_id
      where s.run_id=affected.run_id and s.crm_record_id<>old.id;
    update public.crm_transfers set status='failed', created_count=original,
      linked_count=remaining-original, failed_count=source_count-remaining,
      error='An originating source was removed. Retry to rebuild missing CRM records from this run.',
      updated_at=now() where run_id=affected.run_id;
  end loop;
  return old;
end;
$$;
revoke all on function private.crm_record_removed() from public, anon, authenticated;
create trigger flag_crm_source_removal before delete on public.crm_records
  for each row execute function private.crm_record_removed();

-- Revocation can also happen without deleting the source. Flag delivery as
-- incomplete; retry drops inaccessible mappings before rebuilding from the
-- remaining run's own immutable graph (never from the revoked snapshot).
create function private.crm_origin_access_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare affected record; remaining integer; original integer;
begin
  for affected in select distinct s.run_id, s.user_id from public.crm_record_sources s
    join public.crm_records c on c.id=s.crm_record_id
    where c.origin_run_id=new.id and c.user_id<>new.user_id and s.run_id<>new.id
  loop
    select count(*), count(distinct c.id) filter (where c.origin_run_id=affected.run_id)
      into remaining, original from public.crm_record_sources s
      join public.crm_records c on c.id=s.crm_record_id
      join public.runs origin on origin.id=c.origin_run_id and origin.user_id=affected.user_id
      where s.run_id=affected.run_id;
    update public.crm_transfers set status='failed', created_count=original,
      linked_count=remaining-original, failed_count=source_count-remaining,
      error='An originating source is no longer accessible. Retry to rebuild from this run.',
      updated_at=now() where run_id=affected.run_id;
  end loop;
  return new;
end;
$$;
revoke all on function private.crm_origin_access_changed() from public, anon, authenticated;
create trigger flag_crm_access_change after update of user_id on public.runs
  for each row when (old.user_id is distinct from new.user_id)
  execute function private.crm_origin_access_changed();

-- Retention is deliberately run-scoped: deleting a single chunk cannot safely
-- erase all derived claims, cached prose and entity snapshots. This service-only
-- path audits erasure without granting clients a completed-graph write bypass.
create table private.research_retention_audit (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  user_id uuid not null,
  reason text not null,
  deleted_at timestamptz not null default now()
);
revoke all on private.research_retention_audit from public, anon, authenticated;
grant usage on schema private to service_role;
grant select on private.research_retention_audit to service_role;
create function public.delete_research_run_for_retention(p_run_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare owner_id uuid;
begin
  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception 'A retention reason of at least 10 characters is required';
  end if;
  select user_id into owner_id from public.runs where id=p_run_id for update;
  if not found then raise exception 'Run not found'; end if;
  insert into private.research_retention_audit(run_id,user_id,reason) values(p_run_id,owner_id,btrim(p_reason));
  delete from public.runs where id=p_run_id;
end;
$$;
revoke all on function public.delete_research_run_for_retention(uuid,text) from public, anon, authenticated;
grant execute on function public.delete_research_run_for_retention(uuid,text) to service_role;

alter publication supabase_realtime add table public.crm_transfers;

-- Backfill existing successful results, without treating partial runs as exports.
do $$ declare completed record;
begin
  for completed in select id from public.runs where status = 'completed' and outcome = 'consensus' order by created_at, id loop
    perform private.transfer_completed_run(completed.id);
  end loop;
end $$;
