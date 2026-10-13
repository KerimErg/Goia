/* Panneau admin — blocages (soirée privée, fermeture exceptionnelle).
   POST   /api/admin/blocks { date, from?, to?, motif? }  (sans from/to : journée entière)
   DELETE /api/admin/blocks?id=…
   Un créneau bloqué n'accepte plus de réservation en ligne. Les réservations
   déjà prises ne sont pas annulées automatiquement (à faire depuis la liste). */

"use strict";

const CONFIG = require("../../js/config.js");
const RULES = require("../../js/rules.js");
const db = require("../_lib/supabase");
const { send, readJson } = require("../_lib/http");
const { requireAdmin } = require("../_lib/auth");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HHMM = /^\d{2}:\d{2}$/;

module.exports = async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  try {
    if (req.method === "POST") {
      let body;
      try { body = await readJson(req); } catch (e) { return send(res, 400, { error: "bad_request" }); }
      const date = String(body.date || "");
      const from = body.from ? String(body.from) : "";
      const to = body.to ? String(body.to) : "";
      const motif = typeof body.motif === "string" ? body.motif.trim().slice(0, 120) : "";
      if (!RULES.isYmd(date)) return send(res, 400, { error: "bad_date" });
      if (from || to) {
        // Plage : début = un créneau du jour ; fin = un créneau ou l'heure de fermeture, après le début
        const range = RULES.dayRange(CONFIG, RULES.weekdayOf(date));
        const slots = RULES.daySlots(CONFIG, date);
        const closeTime = range ? RULES.fromMinutes(range.close) : "";
        if (!HHMM.test(from) || !HHMM.test(to) || !slots.includes(from) ||
            !(slots.includes(to) || to === closeTime) || RULES.eveningOrder(to) <= RULES.eveningOrder(from)) {
          return send(res, 400, { error: "bad_range" });
        }
      }
      const rows = await db.insert("blocages", {
        date, heure_debut: from || null, heure_fin: to || null, motif: motif || null,
      });
      return send(res, 201, { block: rows[0] });
    }

    if (req.method === "DELETE") {
      const id = new URL(req.url, "http://x").searchParams.get("id");
      if (!UUID.test(String(id))) return send(res, 400, { error: "bad_request" });
      const removed = await db.remove(`blocages?id=eq.${id}&select=id`);
      return send(res, removed.length ? 200 : 404, { ok: !!removed.length });
    }

    res.setHeader("Allow", "POST, DELETE");
    return send(res, 405, { error: "method_not_allowed" });
  } catch (err) {
    console.error("[admin/blocks]", err);
    return send(res, 500, { error: "server" });
  }
};
