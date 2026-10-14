-- Rune Duel: player accounts, ranked ratings, match history, leaderboard.
--
-- Trust model. Clients sign in with Supabase Auth (Apple, Google) and may READ
-- the leaderboard and match history, and rename THEMSELVES. They can never
-- write a rating, a win or a match: those come only from the match server,
-- which runs the duel authoritatively and calls record_match() with the
-- service role key. A modified client therefore cannot award itself rank.
--
-- Guests have no row here at all. Their stats stay on their own device.

-- ── profiles ────────────────────────────────────────────────────────────────
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text not null check (char_length(display_name) between 1 and 16),
  rating        integer not null default 1000,
  peak_rating   integer not null default 1000,
  wins          integer not null default 0,
  losses        integer not null default 0,
  draws         integer not null default 0,
  games         integer generated always as (wins + losses + draws) stored,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index profiles_rating_idx on public.profiles (rating desc);

alter table public.profiles enable row level security;

create policy "profiles are public"
  on public.profiles for select
  using (true);

-- A player may change their own display name and nothing else. Ratings and
-- records are excluded by the column grant below, not by trusting the client.
create policy "players rename themselves"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

revoke update on public.profiles from anon, authenticated;
grant update (display_name, updated_at) on public.profiles to authenticated;

-- Every new account gets a profile, named from the provider when possible.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  base text := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    'Wizard'
  );
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(regexp_replace(base, '[^[:alnum:] _-]', '', 'g'), 16));
  return new;
exception when check_violation then
  insert into public.profiles (id, display_name) values (new.id, 'Wizard');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── matches ─────────────────────────────────────────────────────────────────
create table public.matches (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  mode            text not null check (mode in ('quick', 'room')),
  ranked          boolean not null,
  player_a        uuid references public.profiles (id) on delete set null,
  player_b        uuid references public.profiles (id) on delete set null,
  name_a          text not null,
  name_b          text not null,
  result          text not null check (result in ('a', 'b', 'draw')),
  reason          text not null check (reason in ('ko', 'forfeit')),
  duration_ms     integer not null check (duration_ms >= 0),
  hp_a            integer not null,
  hp_b            integer not null,
  rating_delta_a  integer,
  rating_delta_b  integer
);

create index matches_player_a_idx on public.matches (player_a, created_at desc);
create index matches_player_b_idx on public.matches (player_b, created_at desc);

alter table public.matches enable row level security;

create policy "match history is public"
  on public.matches for select
  using (true);
-- No insert/update/delete policies: only the service role (the match server)
-- can write, and it bypasses RLS.

-- ── recording a result ─────────────────────────────────────────────────────
-- Called by the match server. Applies Elo for ranked games (both players
-- signed in, quick match) inside one transaction, so a rating can never move
-- without its match row, or twice for the same match.
create function public.record_match(
  p_mode text,
  p_player_a uuid, p_player_b uuid,
  p_name_a text, p_name_b text,
  p_result text, p_reason text,
  p_duration_ms integer, p_hp_a integer, p_hp_b integer
)
returns public.matches
language plpgsql
security definer set search_path = public
as $$
declare
  ranked boolean := p_mode = 'quick' and p_player_a is not null and p_player_b is not null
                    and p_player_a <> p_player_b;
  ra integer; rb integer;
  ea double precision; sa double precision;
  k constant integer := 32;
  da integer; db integer;
  rec public.matches;
begin
  if ranked then
    -- lock both rows in a fixed order so concurrent matches cannot deadlock
    perform 1 from public.profiles where id in (p_player_a, p_player_b) order by id for update;
    select rating into ra from public.profiles where id = p_player_a;
    select rating into rb from public.profiles where id = p_player_b;
    ea := 1 / (1 + power(10, (rb - ra) / 400.0));
    sa := case p_result when 'a' then 1 when 'b' then 0 else 0.5 end;
    da := round(k * (sa - ea));
    db := -da;

    update public.profiles set
      rating = rating + da,
      peak_rating = greatest(peak_rating, rating + da),
      wins = wins + (p_result = 'a')::int,
      losses = losses + (p_result = 'b')::int,
      draws = draws + (p_result = 'draw')::int,
      updated_at = now()
    where id = p_player_a;

    update public.profiles set
      rating = rating + db,
      peak_rating = greatest(peak_rating, rating + db),
      wins = wins + (p_result = 'b')::int,
      losses = losses + (p_result = 'a')::int,
      draws = draws + (p_result = 'draw')::int,
      updated_at = now()
    where id = p_player_b;
  end if;

  insert into public.matches (
    mode, ranked, player_a, player_b, name_a, name_b, result, reason,
    duration_ms, hp_a, hp_b, rating_delta_a, rating_delta_b
  ) values (
    p_mode, ranked, p_player_a, p_player_b, left(p_name_a, 16), left(p_name_b, 16),
    p_result, p_reason, p_duration_ms, p_hp_a, p_hp_b,
    case when ranked then da end, case when ranked then db end
  )
  returning * into rec;

  return rec;
end;
$$;

revoke all on function public.record_match from public, anon, authenticated;

-- ── leaderboard ─────────────────────────────────────────────────────────────
-- Top rated players with at least five games, so one lucky win is not rank one.
create view public.leaderboard
with (security_invoker = true) as
select
  rank() over (order by rating desc) as position,
  id, display_name, rating, peak_rating, wins, losses, draws, games
from public.profiles
where games >= 5
order by rating desc
limit 100;

grant select on public.leaderboard to anon, authenticated;
