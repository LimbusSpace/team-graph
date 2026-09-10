create extension if not exists pgcrypto;

create table if not exists public.team_members (
  id text primary key,
  name text not null,
  initials text not null,
  role text not null,
  focus text not null default '',
  user_id uuid unique references auth.users(id) on delete set null,
  git_emails text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.work_items (
  id text primary key check (id ~ '^RG-[0-9]{3,}$'),
  title text not null check (char_length(title) between 2 and 120),
  summary text not null default '',
  type text not null check (type in ('mission', 'gate', 'task', 'experiment', 'claim', 'release')),
  phase text not null,
  status text not null default 'planned' check (status in ('planned', 'ready', 'in_progress', 'review', 'done', 'blocked')),
  owner_ids text[] not null default '{}',
  acceptance_criteria text not null,
  weight numeric(5,2) not null default 1 check (weight > 0),
  lane integer not null default 0,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.dependencies (
  source_id text not null references public.work_items(id) on delete cascade,
  target_id text not null references public.work_items(id) on delete cascade,
  kind text not null default 'hard' check (kind in ('hard', 'soft')),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (source_id, target_id),
  check (source_id <> target_id)
);

create table if not exists public.evidence (
  id text primary key default ('EV-' || gen_random_uuid()::text),
  work_item_id text not null references public.work_items(id) on delete cascade,
  actor_id text not null references public.team_members(id),
  title text not null check (char_length(title) between 3 and 240),
  kind text not null check (kind in ('document', 'code', 'experiment', 'decision', 'link')),
  url text,
  accepted boolean not null default false,
  submitted_by uuid references auth.users(id) on delete set null default auth.uid(),
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.activity_events (
  id text primary key default ('AE-' || gen_random_uuid()::text),
  actor_id text not null references public.team_members(id),
  action text not null check (action in ('item.created', 'status.changed', 'evidence.added', 'evidence.accepted', 'git.commit')),
  work_item_id text references public.work_items(id) on delete set null,
  summary text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists evidence_work_item_idx on public.evidence(work_item_id, created_at desc);
create index if not exists activity_created_idx on public.activity_events(created_at desc);
create index if not exists work_items_status_idx on public.work_items(status);

create or replace function public.touch_updated_at()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists work_items_touch_updated_at on public.work_items;
create trigger work_items_touch_updated_at
before update on public.work_items
for each row execute function public.touch_updated_at();

create or replace function public.validate_done_status()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    if exists (
      select 1
      from public.dependencies dependency
      join public.work_items prerequisite on prerequisite.id = dependency.source_id
      where dependency.target_id = new.id
        and dependency.kind = 'hard'
        and prerequisite.status <> 'done'
    ) then
      raise exception 'hard dependencies must be done before completing %', new.id;
    end if;

    if not exists (
      select 1 from public.evidence entry
      where entry.work_item_id = new.id and entry.accepted = true
    ) then
      raise exception 'accepted evidence is required before completing %', new.id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists work_items_validate_done on public.work_items;
create trigger work_items_validate_done
before insert or update on public.work_items
for each row execute function public.validate_done_status();

create or replace function public.prevent_dependency_cycle()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if exists (
    with recursive reachable(id) as (
      select new.target_id
      union
      select dependency.target_id
      from public.dependencies dependency
      join reachable on dependency.source_id = reachable.id
      where dependency.kind = 'hard'
    )
    select 1 from reachable where id = new.source_id
  ) then
    raise exception 'dependency would create a cycle';
  end if;
  return new;
end;
$$;

drop trigger if exists dependencies_prevent_cycle on public.dependencies;
create trigger dependencies_prevent_cycle
before insert or update on public.dependencies
for each row when (new.kind = 'hard') execute function public.prevent_dependency_cycle();

create or replace function public.log_work_item_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor text;
begin
  actor := coalesce(new.owner_ids[1], old.owner_ids[1]);
  if tg_op = 'INSERT' then
    insert into public.activity_events(actor_id, action, work_item_id, summary)
    values (actor, 'item.created', new.id, '新建节点：' || new.title);
  elsif old.status is distinct from new.status then
    insert into public.activity_events(actor_id, action, work_item_id, summary, metadata)
    values (
      actor,
      'status.changed',
      new.id,
      new.title || '：' || old.status || ' → ' || new.status,
      jsonb_build_object('from', old.status, 'to', new.status)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists work_item_activity on public.work_items;
create trigger work_item_activity
after insert or update on public.work_items
for each row execute function public.log_work_item_change();

create or replace function public.log_evidence_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.activity_events(actor_id, action, work_item_id, summary)
    values (new.actor_id, 'evidence.added', new.work_item_id, '提交证据：' || new.title);
  elsif new.accepted = true and old.accepted = false then
    new.accepted_at := now();
    new.accepted_by := auth.uid();
    insert into public.activity_events(actor_id, action, work_item_id, summary)
    values (new.actor_id, 'evidence.accepted', new.work_item_id, '证据通过审计：' || new.title);
  end if;
  return new;
end;
$$;

drop trigger if exists evidence_activity on public.evidence;
create trigger evidence_activity
before insert or update on public.evidence
for each row execute function public.log_evidence_change();

alter table public.team_members enable row level security;
alter table public.work_items enable row level security;
alter table public.dependencies enable row level security;
alter table public.evidence enable row level security;
alter table public.activity_events enable row level security;

create or replace function public.is_team_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team_members where user_id = auth.uid());
$$;

drop policy if exists "team can read members" on public.team_members;
drop policy if exists "team can read items" on public.work_items;
drop policy if exists "team can write items" on public.work_items;
drop policy if exists "team can read dependencies" on public.dependencies;
drop policy if exists "team can write dependencies" on public.dependencies;
drop policy if exists "team can read evidence" on public.evidence;
drop policy if exists "team can submit evidence" on public.evidence;
drop policy if exists "team can audit evidence" on public.evidence;
drop policy if exists "team can read activity" on public.activity_events;

create policy "team can read members" on public.team_members for select to authenticated using (public.is_team_member());
create policy "team can read items" on public.work_items for select to authenticated using (public.is_team_member());
create policy "team can write items" on public.work_items for all to authenticated using (public.is_team_member()) with check (public.is_team_member());
create policy "team can read dependencies" on public.dependencies for select to authenticated using (public.is_team_member());
create policy "team can write dependencies" on public.dependencies for all to authenticated using (public.is_team_member()) with check (public.is_team_member());
create policy "team can read evidence" on public.evidence for select to authenticated using (public.is_team_member());
create policy "team can submit evidence" on public.evidence for insert to authenticated with check (public.is_team_member());
create policy "team can audit evidence" on public.evidence for update to authenticated using (public.is_team_member()) with check (public.is_team_member());
create policy "team can read activity" on public.activity_events for select to authenticated using (public.is_team_member());

do $$
declare
  table_name text;
begin
  foreach table_name in array array['work_items', 'dependencies', 'evidence', 'activity_events'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end;
$$;

insert into public.team_members (id, name, initials, role, focus) values
  ('fei', '费典睿', '费', '产业与用户研究', '工厂需求、试点合作、受试者与合规'),
  ('zhang', '张家乐', '张', '视觉与仿真', 'SLAM、数据管线、场景重建与反馈界面'),
  ('ma', '马铭泽', '马', '策略与实机验证', 'ALOHA、策略训练、消融与实验设计'),
  ('deng', '邓健华', '邓', '硬件与嵌入式', 'FSR、IMU、同步硬件与佩戴设备')
on conflict (id) do update set
  name = excluded.name,
  initials = excluded.initials,
  role = excluded.role,
  focus = excluded.focus;

-- 节点与依赖的完整种子数据由 scripts/seed-supabase.mjs 从 src/data/seed.ts 导入。
