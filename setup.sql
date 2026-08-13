-- ═══════════════════════════════════════════════════════════
--  로그 도서관 — 설치용 SQL
--  Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 Run
--
--  고칠 곳 없습니다. 그대로 붙여넣으세요.
--
--  · 주인은 이 프로젝트에서 가장 먼저 만들어진 계정이 자동으로 됩니다
--    (SQL을 먼저 돌리든 계정을 먼저 만들든 상관없습니다)
--  · 플러그인용 수집 시크릿도 자동으로 만들어집니다
--    (설정 → 리수 플러그인 에서 확인)
--  · 다시 돌려도 안전합니다. 데이터도 시크릿도 그대로 유지됩니다
-- ═══════════════════════════════════════════════════════════

create extension if not exists pg_trgm;

-- ── 주인 기록 ───────────────────────────────────────────────
-- 정책을 하나도 안 걸어서 REST로는 읽지도 쓰지도 못합니다.
-- 아래 함수들만 security definer 로 들여다봅니다.
create table if not exists app_owner (
  id      int primary key default 1,
  user_id uuid not null,
  constraint app_owner_singleton check (id = 1)
);
alter table app_owner enable row level security;

-- 이미 만들어둔 계정이 있으면 가장 먼저 만든 계정을 주인으로 잡습니다.
insert into app_owner (id, user_id)
select 1, id from auth.users order by created_at limit 1
on conflict (id) do nothing;

-- 아직 계정이 없다면, 앞으로 처음 만들어지는 계정이 주인이 됩니다.
create or replace function claim_owner_on_signup()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into app_owner (id, user_id) values (1, new.id)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists claim_owner on auth.users;
create trigger claim_owner
  after insert on auth.users
  for each row execute function claim_owner_on_signup();

-- ── 소유자 판별 ─────────────────────────────────────────────
-- app_owner 에 정책이 없으므로 반드시 security definer 여야 합니다.
create or replace function is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_owner where user_id = auth.uid())
$$;

-- ── 프로필 (1행) ────────────────────────────────────────────
create table if not exists profile (
  id            int primary key default 1,
  display_name  text,
  bio           text,
  avatar_url    text,
  mood          text,
  bgm_url       text,
  theme         text default 'default',
  updated_at    timestamptz default now(),
  constraint profile_singleton check (id = 1)
);

-- ── 캐릭터 ─────────────────────────────────────────────────
create table if not exists characters (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  avatar_url  text,
  summary     text,
  persona     text,
  tags        text[] default '{}',
  created_at  timestamptz default now()
);

-- ── 폴더 (중첩 가능) ───────────────────────────────────────
create table if not exists folders (
  id           uuid primary key default gen_random_uuid(),
  parent_id    uuid references folders(id) on delete cascade,
  character_id uuid references characters(id) on delete cascade,
  name         text not null,
  sort         int  default 0,
  created_at   timestamptz default now()
);

alter table characters add column if not exists folder_id uuid references folders(id) on delete set null;

-- ── 로그 ───────────────────────────────────────────────────
create table if not exists logs (
  id             uuid primary key default gen_random_uuid(),
  title          text,
  kind           text not null default 'origin',
  source_id      text unique,
  source_file    text,
  note           text,
  hypa           jsonb default '[]',
  local_lore     jsonb default '[]',
  binded_persona text,
  binded_preset  text,
  message_count  int default 0,
  started_at     timestamptz,
  scene_from     timestamptz,
  scene_to       timestamptz,
  starred        bool default false,
  folder_id      uuid references folders(id) on delete set null,
  deleted_at     timestamptz,
  created_at     timestamptz default now()
);

-- ── 로그 ↔ 캐릭터 (다대다) ─────────────────────────────────
create table if not exists log_cast (
  log_id       uuid references logs(id) on delete cascade,
  character_id uuid references characters(id) on delete cascade,
  primary key (log_id, character_id)
);

-- ── 메시지 ─────────────────────────────────────────────────
create table if not exists messages (
  id            uuid primary key default gen_random_uuid(),
  log_id        uuid not null references logs(id) on delete cascade,
  seq           int  not null,
  role          text not null,
  body_raw      text not null,
  body_text     text,
  meta          jsonb,
  meta_format   text,
  sent_at       timestamptz,
  scene_at      timestamptz,
  location      text,
  volume        int,
  chapter_no    int,
  chapter_title text,
  source_msg_id text,
  unique (log_id, seq)
);

-- ── 캐릭터별 수치 ──────────────────────────────────────────
create table if not exists message_stats (
  id         uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  char_name  text not null,
  affection  int,
  tension    int,
  notes      jsonb
);

-- ── 노트 ───────────────────────────────────────────────────
create table if not exists notes (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null default 'tip',
  title        text,
  body         text,
  url          text,
  character_id uuid references characters(id) on delete set null,
  folder_id    uuid references folders(id) on delete set null,
  tags         text[] default '{}',
  starred      bool default false,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- ── 읽던 위치 · 북마크 ─────────────────────────────────────
create table if not exists read_state (
  log_id     uuid primary key references logs(id) on delete cascade,
  seq        int not null default 0,
  updated_at timestamptz default now()
);

create table if not exists bookmarks (
  id         uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  memo       text,
  created_at timestamptz default now()
);

-- ── 태그 목록 ──────────────────────────────────────────────
create table if not exists kinds (
  value text primary key,
  label text not null,
  sort  int  default 0
);

insert into kinds (value, label, sort) values
  ('origin', '원본 채팅방', 1),
  ('good',   '느좋 로그',   2),
  ('ooc',    'OOC',         3)
on conflict (value) do nothing;

-- ── 상태창 해석 규칙 ───────────────────────────────────────
create table if not exists parsers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  sort        int  default 0,
  enabled     boolean default true,
  mode        text default 'fields',
  block_open  text,
  block_close text,
  item_sep    text default '\n',
  kv_sep      text default ':',
  block_regex text,
  item_regex  text,
  created_at  timestamptz default now()
);

insert into parsers (name, sort, mode, block_open, block_close, item_sep, kv_sep)
select * from (values
  ('Info_Board', 1, 'fields', '<Info_Board>', '</Info_Board>', E'\n', ':'),
  ('상태창 (파이프)', 2, 'fields', '[상태창', ']', '|', ':')
) as v
where not exists (select 1 from parsers);

-- ── 사용자 테마 · 글꼴 ─────────────────────────────────────
create table if not exists styles (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null,
  name       text not null,
  sort       int  default 0,
  vars       jsonb,
  css_url    text,
  family     text,
  weights    text,
  created_at timestamptz default now()
);

-- ── 인덱스 ─────────────────────────────────────────────────
create index if not exists idx_msg_log_seq  on messages (log_id, seq);
create index if not exists idx_msg_scene    on messages (scene_at);
create index if not exists idx_msg_text     on messages using gin (body_text gin_trgm_ops);
create index if not exists idx_msg_meta     on messages using gin (meta);
create index if not exists idx_stats_msg    on message_stats (message_id);
create index if not exists idx_logs_created on logs (created_at desc);
create index if not exists idx_logs_deleted on logs (deleted_at);
create index if not exists idx_logs_folder  on logs (folder_id);
create index if not exists idx_notes_body   on notes using gin (body gin_trgm_ops);
create index if not exists idx_notes_folder on notes (folder_id);
create index if not exists idx_chars_tags   on characters using gin (tags);
create index if not exists idx_fold_parent  on folders (parent_id);
create index if not exists idx_fold_char    on folders (character_id);

-- ── 행 수준 보안 ───────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'profile','characters','logs','log_cast','messages','message_stats',
    'notes','read_state','bookmarks','folders','kinds','parsers','styles'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    begin
      execute format(
        'create policy owner_all on %I for all
         using (is_owner()) with check (is_owner())', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- 플러그인이 태그 목록만 읽을 수 있게 (로그인 없이)
grant select on kinds to anon;

-- ═══════════════════════════════════════════════════════════
--  아래는 리수 플러그인(Log Sender)을 쓸 때만 필요합니다.
--  안 쓸 거면 여기부터는 건너뛰어도 됩니다.
-- ═══════════════════════════════════════════════════════════

-- 시크릿 보관함 (RLS만 켜고 정책 없음 = REST로 절대 못 읽음)
create table if not exists app_secrets (
  name  text primary key,
  value text not null
);
alter table app_secrets enable row level security;

-- 시크릿을 자동으로 만듭니다. 이미 있으면 건드리지 않습니다
-- (다시 돌려도 플러그인 설정이 깨지지 않게).
insert into app_secrets (name, value)
values ('ingest', replace(gen_random_uuid()::text, '-', '')
              || replace(gen_random_uuid()::text, '-', ''))
  on conflict (name) do nothing;

-- 주인만 자기 시크릿을 꺼내볼 수 있는 통로 (설정 화면에서 씁니다).
create or replace function get_ingest_secret()
returns text language sql stable security definer set search_path = public as $$
  select case when is_owner()
              then (select value from app_secrets where name = 'ingest')
         end
$$;
revoke all on function get_ingest_secret() from public;
grant execute on function get_ingest_secret() to authenticated;

-- 플러그인이 로그를 밀어넣는 통로
create or replace function ingest_chat(p_secret text, p_chat jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok    boolean;
  v_log   uuid;
  v_max   int;
  v_added int := 0;
  m       jsonb;
begin
  select exists(select 1 from app_secrets where name = 'ingest' and value = p_secret)
    into v_ok;
  if not v_ok then
    raise exception 'unauthorized';
  end if;

  select id into v_log from logs where source_id = p_chat->>'source_id';

  if v_log is null then
    insert into logs (title, kind, source_id, source_file, note, hypa, local_lore,
                      binded_persona, binded_preset, message_count)
    values (p_chat->>'title',
            coalesce(p_chat->>'kind', 'origin'),
            p_chat->>'source_id',
            'plugin',
            p_chat->>'note',
            coalesce(p_chat->'hypa', '[]'::jsonb),
            coalesce(p_chat->'local_lore', '[]'::jsonb),
            p_chat->>'binded_persona',
            p_chat->>'binded_preset',
            0)
    returning id into v_log;
    v_max := -1;
  else
    select coalesce(max(seq), -1) into v_max from messages where log_id = v_log;
    update logs
       set hypa = coalesce(p_chat->'hypa', hypa),
           note = coalesce(p_chat->>'note', note)
     where id = v_log;
  end if;

  for m in select * from jsonb_array_elements(p_chat->'messages') loop
    if (m->>'seq')::int > v_max then
      insert into messages (log_id, seq, role, body_raw, sent_at, source_msg_id)
      values (v_log,
              (m->>'seq')::int,
              coalesce(m->>'role', 'char'),
              coalesce(m->>'body_raw', ''),
              nullif(m->>'sent_at', '')::timestamptz,
              m->>'source_msg_id')
      on conflict (log_id, seq) do nothing;
      v_added := v_added + 1;
    end if;
  end loop;

  update logs
     set message_count = (select count(*) from messages where log_id = v_log)
   where id = v_log;

  return jsonb_build_object(
    'log_id', v_log,
    'added',  v_added,
    'total',  (select count(*) from messages where log_id = v_log)
  );
end $$;

revoke all on function ingest_chat(text, jsonb) from public;
grant execute on function ingest_chat(text, jsonb) to anon, authenticated;
