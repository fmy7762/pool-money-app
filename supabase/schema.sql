create extension if not exists pgcrypto;

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  expense_date date not null,
  expense_time time without time zone,
  amount numeric(12, 2) not null check (amount >= 0),
  category text not null default 'その他',
  description text not null default '',
  paid_by text not null default '',
  transaction_type text not null check (transaction_type in ('income', 'expense', 'advance', 'settled')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.expense_audit_logs (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  action text not null check (action in ('insert', 'update', 'delete', 'restore')),
  changed_by uuid references auth.users(id),
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_group_members_user_id on public.group_members(user_id);
create index if not exists idx_expenses_group_active_date on public.expenses(group_id, deleted_at, expense_date desc, expense_time desc, created_at desc);
create index if not exists idx_expenses_created_by on public.expenses(created_by);
create index if not exists idx_expense_audit_logs_expense_id on public.expense_audit_logs(expense_id, created_at desc);

alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_audit_logs enable row level security;

create or replace function public.is_group_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = auth.uid()
  );
$$;

create or replace function public.ensure_default_group()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;

  select id into v_group_id
  from public.groups
  where name = 'Pool Money'
  order by created_at
  limit 1;

  if v_group_id is null then
    insert into public.groups(name)
    values ('Pool Money')
    returning id into v_group_id;
  end if;

  insert into public.group_members(group_id, user_id, role)
  values (v_group_id, auth.uid(), 'member')
  on conflict (group_id, user_id) do nothing;

  return v_group_id;
end;
$$;

create or replace function public.prepare_expense_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := coalesce(new.created_at, now());
    new.updated_at := now();
  else
    new.created_by := old.created_by;
    new.group_id := old.group_id;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prepare_expense_row on public.expenses;
create trigger trg_prepare_expense_row
before insert or update on public.expenses
for each row execute function public.prepare_expense_row();

create or replace function public.write_expense_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_action := 'insert';
  elsif old.deleted_at is null and new.deleted_at is not null then
    v_action := 'delete';
  elsif old.deleted_at is not null and new.deleted_at is null then
    v_action := 'restore';
  else
    v_action := 'update';
  end if;

  insert into public.expense_audit_logs(expense_id, action, changed_by, old_data, new_data)
  values (
    coalesce(new.id, old.id),
    v_action,
    auth.uid(),
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end
  );

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_write_expense_audit_log on public.expenses;
create trigger trg_write_expense_audit_log
after insert or update on public.expenses
for each row execute function public.write_expense_audit_log();

create or replace function public.settle_expense(p_expense_id uuid)
returns public.expenses
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.expenses;
  v_new public.expenses;
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;

  select * into v_old
  from public.expenses
  where id = p_expense_id
    and transaction_type = 'advance'
    and deleted_at is null
  for update;

  if not found then
    raise exception 'advance expense not found';
  end if;

  if not public.is_group_member(v_old.group_id) then
    raise exception 'not allowed';
  end if;

  update public.expenses
  set deleted_at = now()
  where id = v_old.id;

  insert into public.expenses(
    group_id,
    expense_date,
    expense_time,
    amount,
    category,
    description,
    paid_by,
    transaction_type
  )
  values (
    v_old.group_id,
    current_date,
    localtime(0),
    v_old.amount,
    '精算済み',
    v_old.description,
    v_old.paid_by,
    'settled'
  )
  returning * into v_new;

  return v_new;
end;
$$;

create or replace function public.restore_expense(p_expense_id uuid)
returns public.expenses
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.expenses;
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;

  select * into v_row
  from public.expenses
  where id = p_expense_id
  for update;

  if not found then
    raise exception 'expense not found';
  end if;

  if not public.is_group_member(v_row.group_id) then
    raise exception 'not allowed';
  end if;

  update public.expenses
  set deleted_at = null
  where id = p_expense_id
  returning * into v_row;

  return v_row;
end;
$$;

drop policy if exists "groups_select_members" on public.groups;
create policy "groups_select_members"
on public.groups
for select
to authenticated
using (public.is_group_member(id));

drop policy if exists "group_members_select_self_or_group" on public.group_members;
create policy "group_members_select_self_or_group"
on public.group_members
for select
to authenticated
using (user_id = auth.uid() or public.is_group_member(group_id));

drop policy if exists "expenses_select_group_members" on public.expenses;
create policy "expenses_select_group_members"
on public.expenses
for select
to authenticated
using (public.is_group_member(group_id));

drop policy if exists "expenses_insert_group_members" on public.expenses;
create policy "expenses_insert_group_members"
on public.expenses
for insert
to authenticated
with check (public.is_group_member(group_id) and created_by = auth.uid());

drop policy if exists "expenses_update_group_members" on public.expenses;
create policy "expenses_update_group_members"
on public.expenses
for update
to authenticated
using (public.is_group_member(group_id))
with check (public.is_group_member(group_id));

drop policy if exists "audit_logs_select_group_members" on public.expense_audit_logs;
create policy "audit_logs_select_group_members"
on public.expense_audit_logs
for select
to authenticated
using (
  exists (
    select 1
    from public.expenses e
    where e.id = expense_audit_logs.expense_id
      and public.is_group_member(e.group_id)
  )
);

grant usage on schema public to authenticated;
grant select on public.groups to authenticated;
grant select on public.group_members to authenticated;
grant select, insert, update on public.expenses to authenticated;
grant select on public.expense_audit_logs to authenticated;

revoke all on function public.is_group_member(uuid) from public, anon;
revoke all on function public.ensure_default_group() from public, anon;
revoke all on function public.settle_expense(uuid) from public, anon;
revoke all on function public.restore_expense(uuid) from public, anon;

grant execute on function public.ensure_default_group() to authenticated;
grant execute on function public.settle_expense(uuid) to authenticated;
grant execute on function public.restore_expense(uuid) to authenticated;
