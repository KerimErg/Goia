-- ==========================================================================
-- LE GOIA — Base de données des réservations (Supabase)
-- --------------------------------------------------------------------------
-- À exécuter dans Supabase : menu « SQL Editor » → « New query »
-- → collez TOUT ce fichier → « Run ».
-- Le script peut être relancé sans risque : il crée ce qui manque et met à
-- jour une base créée avec une version précédente, sans supprimer de données.
-- ==========================================================================

-- ---------- Table des réservations ----------
create table if not exists public.reservations (
  id          uuid primary key default gen_random_uuid(),
  nom         text not null,
  telephone   text not null,
  email       text,
  date        date not null,
  heure       time not null,
  personnes   int  not null,
  message     text,
  statut      text not null default 'confirmee',
  langue      text not null default 'fr',
  cree_le     timestamptz not null default now(),
  traite_le   timestamptz
);

-- Colonnes ajoutées au fil des versions (sans effet si elles existent déjà)
alter table public.reservations add column if not exists reference    text;          -- ex. GO-7KQ2MX, communiquée au client
alter table public.reservations add column if not exists token_hash   text;          -- empreinte du lien « Gérer ma réservation »
alter table public.reservations add column if not exists espace       text;          -- (ancienne version) préférence d'espace
alter table public.reservations add column if not exists precommande  jsonb not null default '[]'::jsonb; -- (ancienne version)
alter table public.reservations add column if not exists total_estime numeric(8,2) not null default 0;   -- (ancienne version)
alter table public.reservations add column if not exists annule_par   text;          -- 'client' ou 'bar'
alter table public.reservations add column if not exists duree_min    int not null default 120; -- durée d'occupation de la table
alter table public.reservations add column if not exists source       text not null default 'site'; -- 'site' ou 'telephone' (ajoutée dans l'admin)

-- L'email devient facultatif (réservations prises par téléphone)
alter table public.reservations alter column email drop not null;

-- Contraintes (recréées pour pouvoir relancer le script)
alter table public.reservations drop constraint if exists reservations_statut_check;

-- Anciennes réservations : référence générée, « refusée » devient « annulée »
update public.reservations set reference = 'GO-' || upper(substr(replace(id::text, '-', ''), 1, 6)) where reference is null;
update public.reservations set statut = 'annulee', annule_par = 'bar' where statut = 'refusee';
alter table public.reservations alter column reference set not null;
alter table public.reservations alter column statut set default 'confirmee';

alter table public.reservations add  constraint reservations_statut_check
  check (statut in ('en_attente', 'confirmee', 'en_cours', 'terminee', 'annulee'));
alter table public.reservations drop constraint if exists reservations_langue_check;
alter table public.reservations add  constraint reservations_langue_check check (langue in ('fr', 'de'));
alter table public.reservations drop constraint if exists reservations_source_check;
alter table public.reservations add  constraint reservations_source_check check (source in ('site', 'telephone'));
alter table public.reservations drop constraint if exists reservations_email_check;
alter table public.reservations drop constraint if exists reservations_champs_check;
alter table public.reservations add  constraint reservations_champs_check check (
  char_length(nom) between 2 and 80 and char_length(telephone) between 6 and 25
  and (email is null or char_length(email) between 5 and 120) and personnes between 1 and 50
  and (message is null or char_length(message) <= 500) and duree_min between 30 and 480);

create unique index if not exists reservations_reference_key on public.reservations (reference);
create index if not exists reservations_date_heure_idx on public.reservations (date, heure);

comment on table public.reservations is
  'Réservations Le Goia. Statut : en_attente / confirmee / en_cours (clients sur place) / terminee / annulee.';

-- ---------- Blocages : soirée privée, fermeture exceptionnelle ----------
-- heure_debut / heure_fin vides = journée entière bloquée.
-- Sinon : aucune réservation ne peut commencer entre heure_debut (incluse) et heure_fin (exclue).
create table if not exists public.blocages (
  id          uuid primary key default gen_random_uuid(),
  date        date not null,
  heure_debut time,
  heure_fin   time,
  motif       text,
  cree_le     timestamptz not null default now(),
  constraint blocages_plage_check check ((heure_debut is null) = (heure_fin is null)),
  constraint blocages_motif_check check (motif is null or char_length(motif) <= 120)
);
create index if not exists blocages_date_idx on public.blocages (date);

-- ---------- Réglages modifiables depuis l'admin (ex. capacité par créneau) ----------
create table if not exists public.reglages (
  cle        text primary key,
  valeur     jsonb not null,
  modifie_le timestamptz not null default now()
);

-- ---------- Journal anti-spam (limitation du nombre d'envois) ----------
-- Ne contient qu'une empreinte chiffrée de l'adresse IP ou de l'email, jamais la valeur elle-même.
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
alter table public.blocages     enable row level security;
alter table public.reglages     enable row level security;
revoke all on public.reservations, public.rate_events, public.blocages, public.reglages from anon, authenticated;
grant all on public.reservations, public.rate_events, public.blocages, public.reglages to service_role;

-- ---------- Heure → minutes de la soirée (00:30 = 1470, après 23:30) ----------
create or replace function public.goia_minutes(t time) returns int
language sql immutable as $$
  select case when extract(hour from t) < 12
    then (extract(hour from t) * 60 + extract(minute from t))::int + 1440
    else (extract(hour from t) * 60 + extract(minute from t))::int end;
$$;

-- ---------- Création atomique d'une réservation ----------
-- Une réservation occupe sa place pendant p_duree minutes : elle compte sur
-- tous les créneaux qu'elle chevauche. Le verrou (un par soirée) garantit que
-- deux clients ne peuvent jamais prendre la dernière place en même temps.
-- p_force = true (admin uniquement) : ignore la capacité et les blocages.
drop function if exists public.create_reservation(text, text, text, date, time, int, text, text, int);
drop function if exists public.create_reservation(text, text, text, text, text, date, time, int, text, text, text, jsonb, numeric, int);

create or replace function public.create_reservation(
  p_reference text, p_token_hash text,
  p_nom text, p_telephone text, p_email text, p_date date, p_heure time,
  p_personnes int, p_message text, p_langue text,
  p_capacite int, p_duree int, p_pas int, p_source text, p_force boolean
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  debut int := public.goia_minutes(p_heure);
  m int;
  occupe int;
  r public.reservations;
begin
  perform pg_advisory_xact_lock(hashtext('goia-soiree:' || p_date::text));

  if not p_force then
    -- Journée ou plage bloquée par l'admin
    if exists (
      select 1 from public.blocages b
      where b.date = p_date and (b.heure_debut is null
        or (debut >= public.goia_minutes(b.heure_debut) and debut < public.goia_minutes(b.heure_fin)))
    ) then
      return json_build_object('ok', false, 'reason', 'blocked');
    end if;

    -- Capacité vérifiée sur chaque créneau couvert par la réservation
    m := debut;
    while m < debut + p_duree loop
      select coalesce(sum(x.personnes), 0) into occupe
      from public.reservations x
      where x.date = p_date and x.statut in ('en_attente', 'confirmee', 'en_cours')
        and public.goia_minutes(x.heure) <= m and m < public.goia_minutes(x.heure) + x.duree_min;
      if occupe + p_personnes > p_capacite then
        return json_build_object('ok', false, 'reason', 'full');
      end if;
      m := m + p_pas;
    end loop;
  end if;

  insert into public.reservations
    (reference, token_hash, nom, telephone, email, date, heure, personnes, message, langue,
     duree_min, source, statut)
  values
    (p_reference, p_token_hash, p_nom, p_telephone, nullif(p_email, ''), p_date, p_heure, p_personnes,
     nullif(p_message, ''), p_langue, p_duree, p_source, 'confirmee')
  returning * into r;

  return json_build_object('ok', true, 'reservation', row_to_json(r));
exception
  when unique_violation then
    -- Référence déjà prise (très rare) : le serveur en génère une autre et réessaie
    return json_build_object('ok', false, 'reason', 'duplicate_reference');
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
revoke execute on function public.create_reservation(text, text, text, text, text, date, time, int, text, text, int, int, int, text, boolean) from public, anon, authenticated;
revoke execute on function public.check_rate_limit(text, text, int, int) from public, anon, authenticated;
grant  execute on function public.create_reservation(text, text, text, text, text, date, time, int, text, text, int, int, int, text, boolean) to service_role;
grant  execute on function public.check_rate_limit(text, text, int, int) to service_role;
