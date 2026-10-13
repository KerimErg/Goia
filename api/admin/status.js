/* POST /api/admin/status { id, statut } — Change le statut d'une réservation (admin),
   comme le menu de statut du site de location :
   en_attente · confirmee · en_cours (clients sur place) · terminee · annulee.
   Emails automatiques au client :
   - passage à « annulee »  → email d'annulation
   - passage de « en_attente » à « confirmee » → email de confirmation (avec un nouveau lien de gestion) */

"use strict";

const db = require("../_lib/supabase");
const { send, readJson, siteUrl } = require("../_lib/http");
const { requireAdmin } = require("../_lib/auth");
const { STATUSES, newToken, hashToken } = require("../_lib/booking");
const { sendCustomerEmail } = require("../_lib/emails");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "method_not_allowed" });
  }

  let body;
  try { body = await readJson(req); } catch (e) { return send(res, 400, { error: "bad_request" }); }
  const { id, statut } = body;
  if (!UUID.test(String(id)) || !STATUSES.includes(statut)) return send(res, 400, { error: "bad_request" });

  try {
    const existing = await db.select(`reservations?id=eq.${id}&select=*`);
    if (!existing.length) return send(res, 404, { error: "not_found" });
    const before = existing[0];
    if (before.statut === statut) {
      delete before.token_hash;
      return send(res, 200, { reservation: before, emailSent: false, unchanged: true });
    }

    const changes = { statut, traite_le: new Date().toISOString(), annule_par: statut === "annulee" ? "bar" : null };
    let token = null;
    const confirming = statut === "confirmee" && before.statut === "en_attente";
    if (confirming) { token = newToken(); changes.token_hash = hashToken(token); }

    // Ne modifie que si le statut n'a pas changé entre-temps (évite un double email)
    const updated = await db.update(`reservations?id=eq.${id}&statut=eq.${before.statut}`, changes);
    if (!updated.length) return send(res, 409, { error: "conflict" });
    const r = updated[0];

    let emailSent = null; // null = pas d'email prévu pour ce changement
    if (statut === "annulee") emailSent = await sendCustomerEmail(r, "annulee");
    else if (confirming) {
      const url = `${siteUrl(req)}/reservation/confirmation/?ref=${encodeURIComponent(r.reference)}&t=${encodeURIComponent(token)}`;
      emailSent = await sendCustomerEmail(r, "confirmee", url);
    }

    r.heure = String(r.heure).slice(0, 5);
    delete r.token_hash;
    return send(res, 200, { reservation: r, emailSent });
  } catch (err) {
    console.error("[admin/status]", err);
    return send(res, 500, { error: "server" });
  }
};
