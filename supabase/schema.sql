-- Supabase DDL for Garani Publication billing toolkit
-- Run inside the Supabase SQL editor (or via psql) before enabling row level security.

create extension if not exists "pgcrypto";

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  uid text not null,
  sku text,
  title text,
  author text,
  publisher text,
  mrp numeric(14,4) default 0,
  default_discount_pct numeric(7,3) default 0,
  default_tax_pct numeric(7,3) default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists books_workspace_uid_idx on public.books (workspace_id, uid);

create trigger books_touch_updated_at
before update on public.books
for each row
execute procedure public.touch_updated_at();

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  uid text not null,
  invoice_no text,
  customer_name text,
  billing_address text,
  shipping_address text,
  gstin text,
  pan text,
  place_of_supply text,
  email text,
  phone text,
  invoice_date text,
  due_date text,
  notes text,
  meta jsonb default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists customers_workspace_uid_idx on public.customers (workspace_id, uid);

create trigger customers_touch_updated_at
before update on public.customers
for each row
execute procedure public.touch_updated_at();

create table if not exists public.draft_invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  uid text not null,
  label text,
  meta jsonb default '{}'::jsonb,
  lines jsonb default '[]'::jsonb,
  pdf_column_prefs jsonb default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists draft_invoices_workspace_uid_idx on public.draft_invoices (workspace_id, uid);

create trigger draft_invoices_touch_updated_at
before update on public.draft_invoices
for each row
execute procedure public.touch_updated_at();

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  invoice_no text,
  customer_name text,
  meta jsonb default '{}'::jsonb,
  items jsonb default '[]'::jsonb,
  totals jsonb default '{}'::jsonb,
  pdf_column_prefs jsonb default '{}'::jsonb,
  source text default 'manual',
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists invoices_workspace_idx on public.invoices (workspace_id, invoice_no);

-- Optional: enable Row Level Security once policies are in place
-- alter table public.books enable row level security;
-- alter table public.customers enable row level security;
-- alter table public.draft_invoices enable row level security;
-- alter table public.invoices enable row level security;
