/* Panneau admin — réservations d'une soirée.
   GET  /api/admin/reservations?date=AAAA-MM-JJ
        → réservations triées par heure, personnes par créneau, blocages, capacité
   POST /api/admin/reservations  { date, time, persons, name, phone, email?, message?, lang?, sendEmail?, force? }
        → ajout manuel (réservation prise par téléphone), compte dans les disponibilités.
          Si le créneau est complet ou bloqué : 409, l'admin peut confirmer avec force: true. */

"use strict";

const CONFIG = require("../../js/config.js");
const RULES = require("../../js/rules.js");
const db = require("../_lib/supabase");
const { send, readJson } = require("../_lib/http");
const { requireAdmin } = require("../_lib/auth");
const { getCapacity, presentAt, validateBooking, insertReservation, ACTIVE_STATUSES, eveningMinutes } = require("../_lib/booking");
const { sendCustomerEmail, manageUrl } = require("../_lib/emails");

/** « Ce soir » : avant 6 h du matin, c'est encore la soirée de la veille. */
function tonight() {
  const now = RULES.nowInKehl();
  return now.minutes < 6 * 60 ? RULES.addDays(now.ymd, -1) : now.ymd;
}

async function dayView(date) {
  const [capacity, rows, blocks] = await Promise.all([
    getCapacity(),
    db.select(`reservations?select=*&date=eq.${date}&limit=1000`),
    db.select(`blocages?select=*&date=eq.${date}&order=heure_debut.asc.nullsfirst`),
  ]);
  rows.forEach((r) => { r.heure = String(r.heure).slice(0, 5); delete r.token_hash; });
  rows.sort((a, b) => RULES.eveningOrder(a.heure) - RULES.eveningOrder(b.heure) || a.cree_le.localeCompare(b.cree_le));
  const active = rows.filter((r) => ACTIVE_STATUSES.includes(r.statut));

  // Par créneau : arrivées, personnes présentes (réservations de 2 h qui se chevauchent), blocage
  const slots = RULES.daySlotMinutes(CONFIG, date).map((m) => {
    const time = RULES.fromMinutes(m);
    const blocked = blocks.some((b) => !b.heure_debut || (m >= eveningMinutes(b.heure_debut) && m < eveningMinutes(b.heure_fin)));
    return {
      time,
      arriving: active.filter((r) => r.heure === time).reduce((n, r) => n + r.personnes, 0),
      present: presentAt(active, m),
      blocked,
    };
  });
  blocks.forEach((b) => {
    if (b.heure_debut) { b.heure_debut = b.heure_debut.slice(0, 5); b.heure_fin = b.heure_fin.slice(0, 5); }
  });

  return {
    date,
    tonight: tonight(),
    capacity,
    open: !!RULES.dayRange(CONFIG, RULES.weekdayOf(date)),
    totals: {
      reservations: active.length,
      persons: active.reduce((n, r) => n + r.personnes, 0),
      peak: Math.max(0, ...slots.map((s) => s.present)),
    },
    slots,
    blocks,
    reservations: rows,
  };
}

module.exports = async function handler(req, res) {
  if (!requireAdmin(req, res)) return;

  try {
    if (req.method === "GET") {
      const params = new URL(req.url, "http://x").searchParams;
      const date = RULES.isYmd(params.get("date")) ? params.get("date") : tonight();
      return send(res, 200, await dayView(date));
    }

    if (req.method === "POST") {
      let body;
      try { body = await readJson(req); } catch (e) { return send(res, 400, { error: "bad_request" }); }
      const { errors, data } = validateBooking(body, { admin: true });
      if (Object.keys(errors).length) return send(res, 422, { error: "validation", fields: errors });

      const result = await insertReservation(data, { source: "telephone", force: body.force === true });
      if (!result.ok) return send(res, 409, { error: result.reason });

      const r = result.reservation;
      let emailSent = null;
      if (r.email && body.sendEmail === true) {
        emailSent = await sendCustomerEmail(r, "confirmee", manageUrl(req, r.reference, result.token));
      }
      return send(res, 201, { reference: r.reference, emailSent });
    }

    res.setHeader("Allow", "GET, POST");
    return send(res, 405, { error: "method_not_allowed" });
  } catch (err) {
    console.error("[admin/reservations]", err);
    return send(res, 500, { error: "server" });
  }
};
