/* GET /api/admin/reservations — Liste et tableau de bord (admin).
   Paramètres : from, to (AAAA-MM-JJ), statut, q (recherche : référence, nom,
   email, téléphone). Par défaut : ce soir et les jours suivants, triés par date
   puis heure (dans l'ordre de la soirée : 00:30 après 23:30). */

"use strict";

const CONFIG = require("../../js/config.js");
const RULES = require("../../js/rules.js");
const db = require("../_lib/supabase");
const { send } = require("../_lib/http");
const { requireAdmin } = require("../_lib/auth");
const { capacity, STATUSES, ACTIVE_STATUSES } = require("../_lib/booking");

const sortEvening = (rows) => rows.sort((a, b) => a.date.localeCompare(b.date) ||
  RULES.eveningOrder(a.heure) - RULES.eveningOrder(b.heure) || a.cree_le.localeCompare(b.cree_le));

/** Indicateurs du tableau de bord (comme les 4 cartes du site de location). */
async function dashboard(tonight) {
  const in7 = RULES.addDays(tonight, 6);
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const [week, cancelled] = await Promise.all([
    db.select(`reservations?select=date,heure,personnes&date=gte.${tonight}&date=lte.${in7}&statut=in.(${ACTIVE_STATUSES.join(",")})&limit=2000`),
    db.select(`reservations?select=annule_par&statut=eq.annulee&traite_le=gte.${encodeURIComponent(since30)}&limit=2000`),
  ]);
  const tonightRows = week.filter((r) => r.date === tonight);
  const perSlot = {};
  tonightRows.forEach((r) => { const t = String(r.heure).slice(0, 5); perSlot[t] = (perSlot[t] || 0) + r.personnes; });
  const peak = Math.max(0, ...Object.values(perSlot));
  return {
    tonight: { reservations: tonightRows.length, persons: tonightRows.reduce((n, r) => n + r.personnes, 0) },
    peakOccupancy: Math.round((peak / capacity()) * 100),
    week: { reservations: week.length, persons: week.reduce((n, r) => n + r.personnes, 0) },
    cancelled30: { total: cancelled.length, byClient: cancelled.filter((r) => r.annule_par === "client").length },
  };
}

module.exports = async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return send(res, 405, { error: "method_not_allowed" });
  }

  const params = new URL(req.url, "http://x").searchParams;
  const now = RULES.nowInKehl();
  // Avant 6 h du matin, la « soirée en cours » est encore celle de la veille
  const tonight = now.minutes < 6 * 60 ? RULES.addDays(now.ymd, -1) : now.ymd;
  const from = RULES.isYmd(params.get("from")) ? params.get("from") : tonight;
  const to = RULES.isYmd(params.get("to")) ? params.get("to") : RULES.addDays(from, CONFIG.reservation.maxDaysAhead + 1);
  const statut = STATUSES.includes(params.get("statut")) ? params.get("statut") : "";
  // Recherche : on ne garde que des caractères sûrs pour la syntaxe de filtre PostgREST
  const q = String(params.get("q") || "").replace(/[^\p{L}\p{N}@.+\- ]/gu, "").trim().slice(0, 60);

  let filter = `date=gte.${from}&date=lte.${to}`;
  if (q) {
    const like = encodeURIComponent(`*${q}*`);
    filter += `&or=(reference.ilike.${like},nom.ilike.${like},email.ilike.${like},telephone.ilike.${like})`;
  }

  try {
    const [rows, all, stats] = await Promise.all([
      db.select(`reservations?select=*&${filter}${statut ? `&statut=eq.${statut}` : ""}&order=date.asc,heure.asc&limit=1000`),
      db.select(`reservations?select=statut&${filter}&limit=5000`),
      dashboard(tonight),
    ]);
    rows.forEach((r) => { r.heure = String(r.heure).slice(0, 5); delete r.token_hash; });
    const counts = Object.fromEntries(STATUSES.map((s) => [s, all.filter((r) => r.statut === s).length]));
    counts.all = all.length;
    return send(res, 200, { from, to, tonight, capacity: capacity(), counts, stats, reservations: sortEvening(rows) });
  } catch (err) {
    console.error("[admin/reservations]", err);
    return send(res, 500, { error: "server" });
  }
};
