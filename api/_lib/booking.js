/* Règles de réservation côté serveur : validation, capacité, disponibilités.
   Le navigateur valide déjà le formulaire, mais le serveur revérifie tout :
   on ne fait jamais confiance aux données envoyées par le client. */

"use strict";

const crypto = require("crypto");
const CONFIG = require("../../js/config.js");
const RULES = require("../../js/rules.js");
const db = require("./supabase");

/** Statuts qui occupent une place. Les réservations annulées libèrent la leur. */
const ACTIVE_STATUSES = ["en_attente", "confirmee", "en_cours"];
const STATUSES = ["en_attente", "confirmee", "en_cours", "terminee", "annulee"];

const R = CONFIG.reservation;
const hhmm = (t) => String(t).slice(0, 5);

/* ---------- Capacité (réglable dans l'admin, sinon config.js) ---------- */

async function getCapacity() {
  const rows = await db.select("reglages?cle=eq.capacite_creneau&select=valeur");
  const n = rows.length ? Number(rows[0].valeur) : NaN;
  return Number.isInteger(n) && n > 0 ? n : R.maxPersonsPerSlot;
}

/* ---------- Disponibilités ---------- */

/**
 * Charge, pour une période, uniquement ce qui sert au calcul des places
 * (heure, personnes, durée) : jamais de nom, téléphone ni email.
 */
async function loadOccupancy(from, to) {
  const [reservations, blocks] = await Promise.all([
    db.select(`reservations?select=date,heure,personnes,duree_min&date=gte.${from}&date=lte.${to}&statut=in.(${ACTIVE_STATUSES.join(",")})&limit=5000`),
    db.select(`blocages?select=id,date,heure_debut,heure_fin,motif&date=gte.${from}&date=lte.${to}&limit=1000`),
  ]);
  return { reservations, blocks };
}

/** Minutes de la soirée (00:30 → 1470) pour une heure "HH:MM[:SS]". */
const eveningMinutes = (t) => RULES.eveningOrder(hhmm(t));

/** Personnes présentes à un instant m (minutes de la soirée) pour une date. */
function presentAt(reservations, m) {
  return reservations.reduce((n, r) => {
    const start = eveningMinutes(r.heure);
    return start <= m && m < start + (r.duree_min || R.durationMinutes) ? n + r.personnes : n;
  }, 0);
}

function isBlocked(blocks, m) {
  return blocks.some((b) => !b.heure_debut || (m >= eveningMinutes(b.heure_debut) && m < eveningMinutes(b.heure_fin)));
}

/**
 * Créneaux d'une date avec leur état pour un groupe de `persons` personnes :
 *   available | full | past | blocked, et les places restantes (`remaining`).
 * Une réservation occupe sa place pendant durationMinutes : les places
 * restantes d'un créneau sont le minimum sur toute la durée du séjour.
 */
function computeSlots(date, persons, data, capacity, now) {
  now = now || RULES.nowInKehl();
  const res = data.reservations.filter((r) => r.date === date);
  const blocks = data.blocks.filter((b) => b.date === date);
  return RULES.daySlotMinutes(CONFIG, date).map((m) => {
    let remaining = capacity;
    for (let k = m; k < m + R.durationMinutes; k += R.slotMinutes) {
      remaining = Math.min(remaining, capacity - presentAt(res, k));
    }
    remaining = Math.max(remaining, 0);
    let status = "available";
    if (!RULES.isSlotOpen(CONFIG, date, m, now)) status = "past";
    else if (isBlocked(blocks, m)) status = "blocked";
    else if (remaining < persons) status = "full";
    return { time: RULES.fromMinutes(m), status, remaining: status === "available" ? remaining : 0 };
  });
}

/** État de chaque jour de la fenêtre de réservation : closed | full | available. */
function computeDays(persons, data, capacity, now) {
  now = now || RULES.nowInKehl();
  const days = [];
  for (let i = 0; i <= R.maxDaysAhead; i++) {
    const date = RULES.addDays(now.ymd, i);
    const slots = computeSlots(date, persons, data, capacity, now);
    const dayBlocked = data.blocks.some((b) => b.date === date && !b.heure_debut);
    let status;
    if (!slots.length || dayBlocked) status = "closed";
    else if (slots.some((s) => s.status === "available")) status = "available";
    else if (slots.every((s) => s.status === "past")) status = "closed";
    else status = "full";
    days.push({ date, status });
  }
  return days;
}

/* ---------- Validation d'une réservation client ---------- */

/** Renvoie { errors, data } ; errors = { champ: cléDeMessage } (mêmes clés que js/i18n.js). */
function validateBooking(body, opts) {
  const admin = !!(opts && opts.admin);
  const b = body || {};
  const str = (v) => (typeof v === "string" ? v.trim() : "");
  const data = {
    nom: str(b.name).slice(0, 80),
    telephone: str(b.phone).slice(0, 25),
    email: str(b.email).slice(0, 120).toLowerCase(),
    date: str(b.date),
    heure: str(b.time),
    personnes: Number.parseInt(b.persons, 10),
    message: str(b.message).slice(0, 500),
    langue: b.lang === "de" ? "de" : "fr",
  };

  const errors = {};
  if (data.nom.length < 2) errors.name = "err.name";
  if (!/^\+?\d{6,15}$/.test(data.telephone.replace(/[\s().\/-]/g, ""))) errors.phone = "err.phone";
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email);
  if (!emailOk && !(admin && !data.email)) errors.email = "err.email"; // facultatif pour l'admin (téléphone)

  const now = RULES.nowInKehl();
  if (!RULES.isYmd(data.date)) errors.date = "err.date";
  else if (!admin && data.date < now.ymd) errors.date = "err.datePast";
  else if (!RULES.dayRange(CONFIG, RULES.weekdayOf(data.date))) errors.date = "err.dateClosed";
  else if (admin) {
    if (!RULES.daySlots(CONFIG, data.date).includes(data.heure)) errors.time = "err.time";
  } else if (!RULES.slotsFor(CONFIG, data.date, now).includes(data.heure)) errors.time = "err.slotTaken";

  const maxPersons = admin ? 50 : R.maxPersons;
  if (!(data.personnes >= 1 && data.personnes <= maxPersons)) errors.persons = "err.persons";
  if (!admin) {
    if (b.age !== true) errors.age = "err.age";
    if (b.privacy !== true) errors.privacy = "err.privacy";
  }
  return { errors, data };
}

/* ---------- Référence et lien « Gérer ma réservation » ---------- */

const REF_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // sans 0/O, 1/I/L : facile à dicter au téléphone
function newReference() {
  const bytes = crypto.randomBytes(6);
  return "GO-" + Array.from(bytes, (x) => REF_ALPHABET[x % REF_ALPHABET.length]).join("");
}
const newToken = () => crypto.randomBytes(24).toString("base64url");
const hashToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");

/**
 * Enregistre une réservation (contrôle de capacité atomique en base).
 * Renvoie { ok, reservation, token } ou { ok: false, reason: "full" | "blocked" }.
 */
async function insertReservation(data, { source, force }) {
  const capacity = await getCapacity();
  const token = newToken();
  let result;
  for (let attempt = 0; attempt < 3; attempt++) {
    result = await db.rpc("create_reservation", {
      p_reference: newReference(), p_token_hash: hashToken(token),
      p_nom: data.nom, p_telephone: data.telephone, p_email: data.email,
      p_date: data.date, p_heure: data.heure, p_personnes: data.personnes,
      p_message: data.message, p_langue: data.langue,
      p_capacite: capacity, p_duree: R.durationMinutes, p_pas: R.slotMinutes,
      p_source: source, p_force: !!force,
    });
    if (result.reason !== "duplicate_reference") break;
  }
  if (result.ok) return { ok: true, reservation: result.reservation, token };
  if (result.reason === "full" || result.reason === "blocked") return { ok: false, reason: result.reason };
  throw new Error(`create_reservation: ${result.reason}`);
}

/** Le client peut-il encore annuler en ligne ? (jusqu'à cancelHoursBefore heures avant) */
function isCancellable(r, now) {
  if (!["en_attente", "confirmee"].includes(r.statut)) return false;
  now = now || RULES.nowInKehl();
  // Minutes entre maintenant et l'heure réservée (un créneau après minuit appartient à la soirée de r.date)
  const dayDiff = Math.round((Date.parse(r.date) - Date.parse(now.ymd)) / 86400000);
  const slotMinutes = eveningMinutes(r.heure) + dayDiff * 1440;
  return slotMinutes - now.minutes >= R.cancelHoursBefore * 60;
}

module.exports = {
  ACTIVE_STATUSES, STATUSES, getCapacity, loadOccupancy, computeSlots, computeDays, presentAt,
  validateBooking, insertReservation, newToken, hashToken, isCancellable, eveningMinutes,
};
