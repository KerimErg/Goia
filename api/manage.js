/* Espace « Gérer ma réservation » (sans compte client) :
   GET  /api/manage?ref=GO-XXXXXX&t=jeton  → détails de la réservation
   POST /api/manage { ref, t, action: "cancel" } → annulation par le client
   Le jeton secret n'est connu que du client (lien reçu par email et page de
   confirmation) ; seule son empreinte est stockée en base. */

"use strict";

const crypto = require("crypto");
const CONFIG = require("../js/config.js");
const db = require("./_lib/supabase");
const { send, readJson, siteUrl } = require("./_lib/http");
const { hashToken, isCancellable } = require("./_lib/booking");
const { sendCustomerEmail, sendBarNotification } = require("./_lib/emails");

const REF = /^GO-[A-Z0-9]{6}$/;

async function findReservation(ref, token) {
  if (!REF.test(String(ref)) || typeof token !== "string" || token.length < 20) return null;
  const rows = await db.select(`reservations?reference=eq.${ref}&select=*`);
  const r = rows[0];
  if (!r || !r.token_hash) return null;
  const a = Buffer.from(r.token_hash, "hex");
  const b = Buffer.from(hashToken(token), "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? r : null;
}

/** Données renvoyées au client (jamais l'empreinte du jeton ni l'id interne). */
const publicView = (r) => ({
  reference: r.reference,
  firstName: String(r.nom).trim().split(/\s+/)[0],
  email: r.email,
  date: r.date,
  time: String(r.heure).slice(0, 5),
  persons: r.personnes,
  zone: r.espace,
  preorder: r.precommande || [],
  total: Number(r.total_estime),
  status: r.statut,
  cancelledBy: r.annule_par,
  cancellable: isCancellable(r),
  cancelHoursBefore: CONFIG.reservation.cancelHoursBefore,
});

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const params = new URL(req.url, "http://x").searchParams;
      const r = await findReservation(params.get("ref"), params.get("t"));
      if (!r) return send(res, 404, { error: "not_found" });
      return send(res, 200, { reservation: publicView(r) });
    }

    if (req.method === "POST") {
      let body;
      try { body = await readJson(req); } catch (e) { return send(res, 400, { error: "bad_request" }); }
      if (body.action !== "cancel") return send(res, 400, { error: "bad_request" });
      const r = await findReservation(body.ref, body.t);
      if (!r) return send(res, 404, { error: "not_found" });
      if (r.statut === "annulee") return send(res, 200, { reservation: publicView(r), unchanged: true });
      if (!isCancellable(r)) return send(res, 409, { error: "too_late", reservation: publicView(r) });

      const updated = await db.update(`reservations?id=eq.${r.id}&statut=in.(en_attente,confirmee)`, {
        statut: "annulee", annule_par: "client", traite_le: new Date().toISOString(),
      });
      if (!updated.length) return send(res, 409, { error: "too_late", reservation: publicView(r) });

      const u = updated[0];
      await Promise.allSettled([
        sendCustomerEmail(u, "annulee_client"),
        sendBarNotification(u, "annulation_client", `${siteUrl(req)}/admin/`),
      ]);
      return send(res, 200, { reservation: publicView(u) });
    }

    res.setHeader("Allow", "GET, POST");
    return send(res, 405, { error: "method_not_allowed" });
  } catch (err) {
    console.error("[manage]", err);
    return send(res, 500, { error: "server" });
  }
};
