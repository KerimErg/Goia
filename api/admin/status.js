/* POST /api/admin/status { id, statut: "confirmee" | "refusee" } — Change le statut (admin)
   et envoie automatiquement l'email correspondant au client. */

"use strict";

const db = require("../_lib/supabase");
const { send, readJson } = require("../_lib/http");
const { requireAdmin } = require("../_lib/auth");
const { sendCustomerEmail } = require("../_lib/emails");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUTS = ["confirmee", "refusee"];

module.exports = async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "method_not_allowed" });
  }

  let body;
  try { body = await readJson(req); } catch (e) { return send(res, 400, { error: "bad_request" }); }
  const { id, statut } = body;
  if (!UUID.test(String(id)) || !STATUTS.includes(statut)) return send(res, 400, { error: "bad_request" });

  try {
    // Ne modifie que si le statut change réellement (évite un double email)
    const updated = await db.update(`reservations?id=eq.${id}&statut=neq.${statut}`, {
      statut, traite_le: new Date().toISOString(),
    });

    if (!updated.length) {
      const existing = await db.select(`reservations?id=eq.${id}&select=*`);
      if (!existing.length) return send(res, 404, { error: "not_found" });
      return send(res, 200, { reservation: existing[0], emailSent: false, unchanged: true });
    }

    const r = updated[0];
    const emailSent = await sendCustomerEmail(r, statut);
    r.heure = String(r.heure).slice(0, 5);
    return send(res, 200, { reservation: r, emailSent });
  } catch (err) {
    console.error("[admin/status]", err);
    return send(res, 500, { error: "server" });
  }
};
