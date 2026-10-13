/* Panneau admin — réglages.
   GET  /api/admin/settings            → { capacity, defaultCapacity }
   POST /api/admin/settings { capacity } → capacité par créneau (personnes présentes en même temps).
   La valeur enregistrée ici a priorité sur maxPersonsPerSlot de js/config.js. */

"use strict";

const CONFIG = require("../../js/config.js");
const db = require("../_lib/supabase");
const { send, readJson } = require("../_lib/http");
const { requireAdmin } = require("../_lib/auth");
const { getCapacity } = require("../_lib/booking");

module.exports = async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  try {
    if (req.method === "GET") {
      return send(res, 200, { capacity: await getCapacity(), defaultCapacity: CONFIG.reservation.maxPersonsPerSlot });
    }
    if (req.method === "POST") {
      let body;
      try { body = await readJson(req); } catch (e) { return send(res, 400, { error: "bad_request" }); }
      const capacity = Number(body.capacity);
      if (!Number.isInteger(capacity) || capacity < 1 || capacity > 500) return send(res, 400, { error: "bad_capacity" });
      await db.upsert("reglages", { cle: "capacite_creneau", valeur: capacity, modifie_le: new Date().toISOString() });
      return send(res, 200, { capacity });
    }
    res.setHeader("Allow", "GET, POST");
    return send(res, 405, { error: "method_not_allowed" });
  } catch (err) {
    console.error("[admin/settings]", err);
    return send(res, 500, { error: "server" });
  }
};
