/* GET /api/admin/reservations?from=AAAA-MM-JJ&to=AAAA-MM-JJ — Liste (admin).
   Par défaut : aujourd'hui et les jours suivants, triés par date puis heure
   (dans l'ordre de la soirée : 00:30 après 23:30). */

"use strict";

const CONFIG = require("../../js/config.js");
const RULES = require("../../js/rules.js");
const db = require("../_lib/supabase");
const { send } = require("../_lib/http");
const { requireAdmin } = require("../_lib/auth");
const { capacity } = require("../_lib/booking");

module.exports = async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return send(res, 405, { error: "method_not_allowed" });
  }

  const params = new URL(req.url, "http://x").searchParams;
  const now = RULES.nowInKehl();
  // Avant 6 h du matin, la « soirée en cours » est encore celle de la veille
  const today = now.minutes < 6 * 60 ? RULES.addDays(now.ymd, -1) : now.ymd;
  const from = RULES.isYmd(params.get("from")) ? params.get("from") : today;
  const to = RULES.isYmd(params.get("to")) ? params.get("to")
    : RULES.addDays(from, CONFIG.reservation.maxDaysAhead + 1);

  try {
    const rows = await db.select(
      `reservations?select=*&date=gte.${from}&date=lte.${to}&order=date.asc,heure.asc&limit=1000`
    );
    rows.forEach((r) => { r.heure = String(r.heure).slice(0, 5); });
    rows.sort((a, b) => a.date.localeCompare(b.date) ||
      RULES.eveningOrder(a.heure) - RULES.eveningOrder(b.heure) ||
      a.cree_le.localeCompare(b.cree_le));
    return send(res, 200, { from, to, capacity: capacity(), reservations: rows });
  } catch (err) {
    console.error("[admin/reservations]", err);
    return send(res, 500, { error: "server" });
  }
};
