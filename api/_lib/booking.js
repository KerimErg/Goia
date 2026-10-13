/* Règles de réservation côté serveur : validation et capacité par créneau.
   Le navigateur valide déjà le formulaire, mais le serveur revérifie tout :
   on ne fait jamais confiance aux données envoyées par le client. */

"use strict";

const CONFIG = require("../../js/config.js");
const RULES = require("../../js/rules.js");
const db = require("./supabase");

const capacity = () => CONFIG.reservation.maxPersonsPerSlot;

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
  if (b.age !== true) errors.age = "err.age";
  if (b.privacy !== true) errors.privacy = "err.privacy";

  return { errors, data };
}

/** Personnes déjà réservées par créneau pour une date (hors demandes refusées). */
async function bookedBySlot(date) {
  const rows = await db.select(
    `reservations?select=heure,personnes&date=eq.${date}&statut=neq.refusee`
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

module.exports = { validateBooking, availability, alternatives, capacity };
