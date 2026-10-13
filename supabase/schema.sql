-- ==========================================================================
-- LE GOIA — Base de données des réservations (Supabase)
-- --------------------------------------------------------------------------
-- À exécuter UNE FOIS dans Supabase : menu « SQL Editor » → « New query »
-- → collez tout ce fichier → « Run ».
-- Le script peut être relancé sans risque (il ne supprime aucune donnée).
-- ==========================================================================

-- ---------- Table des réservations ----------
create table if not exists public.reservations (
  id          uuid primary key default gen_random_uuid(),
  nom         text not null check (char_length(nom) between 2 and 80),
  telephone   text not null check (char_length(telephone) between 6 and 25),
  email       text not null check (char_length(email) between 5 and 120),
  date        date not null,
  heure       time not null,
  personnes   int  not null check (personnes between 1 and 50),
  message     text check (char_length(message) <= 500),
  statut      text not null default 'en_attente'
              check (statut in ('en_attente', 'confirmee', 'refusee')),
  langue      text not null default 'fr' check (langue in ('fr', 'de')),
  cree_le     timestamptz not null default now(),
  traite_le   timestamptz            -- date de confirmation / refus
);

create index if not exists reservations_date_heure_idx on public.reservations (date, heure);

comment on table public.reservations is 'Réservations du site Le Goia. Statut : en_attente / confirmee / refusee.';

-- ---------- Journal anti-spam (limitation du nombre d'envois) ----------
-- Ne contient qu'une empreinte chiffrée de l'adresse IP, jamais l'IP elle-même.
create table if not exists public.rate_events (
  id         bigint generated always as identity primary key,
  bucket     text not null,
  key_hash   text not null,
  created_at timestamptz not null default now()
);
create index if not exists rate_events_lookup_idx on public.rate_events (bucket, key_hash, created_at);

-- ---------- Sécurité ----------
-- RLS activé SANS aucune règle : personne ne peut lire ou écrire ces tables
-- avec la clé publique. Seules les fonctions serveur (clé secrète) y ont accès.
alter table public.reservations enable row level security;
alter table public.rate_events  enable row level security;
revoke all on public.reservations, public.rate_events from anon, authenticated;
grant all on public.reservations, public.rate_events to service_role;

-- ---------- Création atomique d'une réservation avec contrôle de capacité ----------
-- Le verrou empêche deux demandes simultanées de dépasser la capacité du créneau.
create or replace function public.create_reservation(
  p_nom text, p_telephone text, p_email text, p_date date, p_heure time,
  p_personnes int, p_message text, p_langue text, p_capacite int
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  deja int;
  r public.reservations;
begin
  perform pg_advisory_xact_lock(hashtext('goia-slot:' || p_date::text || ' ' || p_heure::text));

  select coalesce(sum(personnes), 0) into deja
  from public.reservations
  where date = p_date and heure = p_heure and statut <> 'refusee';

  if deja + p_personnes > p_capacite then
    return json_build_object('ok', false, 'reason', 'full', 'restant', greatest(p_capacite - deja, 0));
  end if;

  insert into public.reservations (nom, telephone, email, date, heure, personnes, message, langue)
  values (p_nom, p_telephone, p_email, p_date, p_heure, p_personnes, nullif(p_message, ''), p_langue)
  returning * into r;

  return json_build_object('ok', true, 'reservation', row_to_json(r));
end;
$$;

-- ---------- Limitation du nombre d'envois ----------
-- Enregistre une tentative et renvoie true si la limite n'est pas dépassée.
create or replace function public.check_rate_limit(
  p_bucket text, p_key text, p_max int, p_window_seconds int
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  perform pg_advisory_xact_lock(hashtext('goia-rate:' || p_bucket || p_key));
  select count(*) into n from public.rate_events
  where bucket = p_bucket and key_hash = p_key
    and created_at > now() - make_interval(secs => p_window_seconds);
  if n >= p_max then
    return false;
  end if;
  insert into public.rate_events (bucket, key_hash) values (p_bucket, p_key);
  return true;
end;
$$;

-- Les fonctions ne sont appelables que par le serveur (clé secrète).
revoke execute on function public.create_reservation(text, text, text, date, time, int, text, text, int) from public, anon, authenticated;
revoke execute on function public.check_rate_limit(text, text, int, int) from public, anon, authenticated;
grant  execute on function public.create_reservation(text, text, text, date, time, int, text, text, int) to service_role;
grant  execute on function public.check_rate_limit(text, text, int, int) to service_role;
