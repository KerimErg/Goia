/* Règles de réservation côté serveur : validation, prix, capacité par créneau.
   Comme sur le site de location : le navigateur n'envoie jamais de prix,
   tout est revérifié et recalculé ici à partir de config.js et menu.json. */

"use strict";

const crypto = require("crypto");
const CONFIG = require("../../js/config.js");
const RULES = require("../../js/rules.js");
const MENU = require("../../data/menu.json");
const db = require("./supabase");

/** Statuts qui occupent une place (comme ACTIVE_STATUSES sur le site de location). */
const ACTIVE_STATUSES = ["en_attente", "confirmee", "en_cours"];
const STATUSES = ["en_attente", "confirmee", "en_cours", "terminee", "annulee"];

const capacity = () => CONFIG.reservation.maxPersonsPerSlot;

/** Chichas proposées en pré-commande (catégorie "chichas" de menu.json), indexées par nom FR. */
function preorderCatalog() {
  const cat = MENU.categories.find((c) => c.id === "chichas");
  const items = {};
  (cat ? cat.groups : []).forEach((g) => g.items.forEach((it) => {
    if (typeof it.price === "number") items[it.name.fr] = { name: it.name, price: it.price };
  }));
  return items;
}

/** Espaces disponibles pour un nombre de personnes. */
const zonesFor = (persons) => (CONFIG.zones || []).filter((z) => !z.minPersons || persons >= z.minPersons);

/** Renvoie { errors, data } ; errors = { champ: cléDeMessage } (mêmes clés que js/i18n.js). */
function validateBooking(body) {
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
    espace: str(b.zone),
    precommande: [],
    total: 0,
  };

  const errors = {};
  if (data.nom.length < 2) errors.name = "err.name";
  if (!/^\+?\d{6,15}$/.test(data.telephone.replace(/[\s().\/-]/g, ""))) errors.phone = "err.phone";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email)) errors.email = "err.email";

  const now = RULES.nowInKehl();
  if (!RULES.isYmd(data.date)) errors.date = "err.date";
  else if (data.date < now.ymd) errors.date = "err.datePast";
  else if (!RULES.dayRange(CONFIG, RULES.weekdayOf(data.date))) errors.date = "err.dateClosed";
  else if (!RULES.slotsFor(CONFIG, data.date, now).includes(data.heure)) errors.time = "err.time";

  if (!(data.personnes >= 1 && data.personnes <= CONFIG.reservation.maxPersons)) errors.persons = "err.persons";

  // Espace : doit exister et être autorisé pour ce nombre de personnes
  const zones = zonesFor(data.personnes || 1);
  if (CONFIG.zones && CONFIG.zones.length) {
    if (!zones.some((z) => z.id === data.espace)) errors.zone = "err.zone";
  } else data.espace = "";

  // Pré-commande : parfums existants, quantités raisonnables, prix recalculés
  const catalog = preorderCatalog();
  const lines = Array.isArray(b.preorder) ? b.preorder : [];
  let totalQty = 0;
  for (const line of lines.slice(0, 20)) {
    const item = catalog[line && line.name];
    const qty = Number.parseInt(line && line.qty, 10);
    if (!item || !(qty >= 1 && qty <= CONFIG.reservation.preorderMaxPerItem)) { errors.preorder = "err.preorder"; break; }
    totalQty += qty;
    data.precommande.push({ nom: line.name, nom_de: item.name.de, quantite: qty, prix: item.price });
  }
  if (totalQty > (data.personnes || 0)) errors.preorder = "err.preorderMax";
  data.total = Math.round(data.precommande.reduce((s, l) => s + l.prix * l.quantite, 0) * 100) / 100;

  if (b.age !== true) errors.age = "err.age";
  if (b.privacy !== true) errors.privacy = "err.privacy";

  return { errors, data };
}

/** Personnes déjà réservées par créneau pour une date (réservations actives uniquement). */
async function bookedBySlot(date) {
  const rows = await db.select(
    `reservations?select=heure,personnes&date=eq.${date}&statut=in.(${ACTIVE_STATUSES.join(",")})`
  );
  const booked = {};
  rows.forEach((r) => {
    const t = String(r.heure).slice(0, 5);
    booked[t] = (booked[t] || 0) + r.personnes;
  });
  return booked;
}

/** Liste des créneaux d'une date avec les places restantes. */
async function availability(date) {
  const slots = RULES.slotsFor(CONFIG, date);
  if (!slots.length) return [];
  const booked = await bookedBySlot(date);
  return slots.map((time) => ({ time, remaining: Math.max(capacity() - (booked[time] || 0), 0) }));
}

/** Jusqu'à 4 créneaux libres les plus proches de l'heure demandée. */
async function alternatives(date, time, persons) {
  const target = RULES.eveningOrder(time);
  return (await availability(date))
    .filter((s) => s.time !== time && s.remaining >= persons)
    .sort((a, b) => Math.abs(RULES.eveningOrder(a.time) - target) - Math.abs(RULES.eveningOrder(b.time) - target))
    .slice(0, 4)
    .sort((a, b) => RULES.eveningOrder(a.time) - RULES.eveningOrder(b.time))
    .map((s) => s.time);
}

/* ---------- Référence et lien « Gérer ma réservation » ---------- */

const REF_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // sans 0/O, 1/I/L : facile à dicter au téléphone
function newReference() {
  const bytes = crypto.randomBytes(6);
  return "GO-" + Array.from(bytes, (b) => REF_ALPHABET[b % REF_ALPHABET.length]).join("");
}
const newToken = () => crypto.randomBytes(24).toString("base64url");
const hashToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");

/** Le client peut-il encore annuler en ligne ? (jusqu'à X h avant, comme les 48 h du site de location) */
function isCancellable(r, now) {
  if (!["en_attente", "confirmee"].includes(r.statut)) return false;
  now = now || RULES.nowInKehl();
  const hhmm = String(r.heure).slice(0, 5);
  // Minutes entre maintenant et l'heure réservée (un créneau après minuit appartient à la soirée de r.date)
  const dayDiff = Math.round((Date.parse(r.date) - Date.parse(now.ymd)) / 86400000);
  const slotMinutes = RULES.eveningOrder(hhmm) + dayDiff * 1440;
  return slotMinutes - now.minutes >= CONFIG.reservation.cancelHoursBefore * 60;
}

module.exports = {
  ACTIVE_STATUSES, STATUSES, capacity, zonesFor, preorderCatalog,
  validateBooking, availability, alternatives,
  newReference, newToken, hashToken, isCancellable,
};
