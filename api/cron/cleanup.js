/* GET /api/cron/cleanup — Suppression automatique (RGPD).
   Appelée chaque nuit par Vercel Cron (voir vercel.json).
   - réservations dont la date remonte à plus de 6 mois
   - journal anti-spam de plus de 2 jours
   Protégée par la variable CRON_SECRET (Vercel l'envoie automatiquement). */

"use strict";

const crypto = require("crypto");
const db = require("../_lib/supabase");
const { send } = require("../_lib/http");

const RETENTION_MONTHS = 6;

function authorized(req) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return false;
  const given = Buffer.from(String(req.headers.authorization || ""));
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

module.exports = async function handler(req, res) {
  if (!authorized(req)) return send(res, 401, { error: "unauthorized" });

  const cutoff = new Date();
  cutoff.setUTCMonth(cutoff.getUTCMonth() - RETENTION_MONTHS);
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  const eventsCutoff = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();

  try {
    const deleted = await db.remove(`reservations?date=lt.${cutoffDate}&select=id`);
    const events = await db.remove(`rate_events?created_at=lt.${encodeURIComponent(eventsCutoff)}&select=id`);
    await db.remove(`blocages?date=lt.${cutoffDate}&select=id`);
    console.log(`[cleanup] ${deleted.length} réservation(s) avant le ${cutoffDate} supprimée(s)`);
    return send(res, 200, { ok: true, cutoff: cutoffDate, reservationsDeleted: deleted.length, rateEventsDeleted: events.length });
  } catch (err) {
    console.error("[cleanup]", err);
    return send(res, 500, { error: "server" });
  }
};
