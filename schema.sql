-- Run this in Supabase SQL editor before starting the bot

create table if not exists admins (
  telegram_id bigint primary key,
  added_by bigint,
  added_at timestamptz default now()
);

create table if not exists users (
  telegram_id bigint primary key,
  premium boolean default false,
  daily_count int default 0,
  last_reset text default '',
  joined_at timestamptz default now()
);

create table if not exists batches (
  batch_id text primary key,
  title text,
  description text,
  total_files int default 0,
  created_at timestamptz default now(),
  created_by bigint
);

create table if not exists batch_messages (
  id bigserial primary key,
  batch_id text references batches(batch_id) on delete cascade,
  message_id bigint not null,
  file_order int not null
);

create table if not exists settings (
  key text primary key,
  value text
);

create index if not exists idx_batch_messages_batch_id on batch_messages(batch_id);

-- Seed your super admin (replace with your real telegram_id) - optional,
-- the bot also auto-inserts SUPER_ADMIN_ID from .env on first boot.
-- insert into admins (telegram_id, added_by) values (123456789, 123456789)
--   on conflict (telegram_id) do nothing;
