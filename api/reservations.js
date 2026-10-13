/* POST /api/reservations — Réservation directe par le client.
   Étapes : anti-spam → validation → limitation d'envois → contrôle de
   disponibilité atomique en base (deux clients ne peuvent jamais prendre la
   dernière place en même temps) → confirmation immédiate → emails. */

"use strict";

const db = require("./_lib/supabase");
const { send, readJson, clientIp, hashKey, siteUrl } = require("./_lib/http");
const { validateBooking, insertReservation } = require("./_lib/booking");
const { sendCustomerEmail, sendBarNotification, manageUrl } = require("./_lib/emails");

const LIMITS = [
  // [nom, clé, nombre max, fenêtre en secondes]
  ["booking-ip", (req) => clientIp(req), 3, 60 * 60],          // 3 réservations / heure / connexion
  ["booking-email", (req, d) => d.email, 3, 24 * 60 * 60],     // 3 réservations / jour / adresse email
];

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "method_not_allowed" });
  }

  let body;
  try { body = await readJson(req); } catch (e) { return send(res, 400, { error: "bad_request" }); }

  // Anti-spam 1 : champ invisible rempli, ou formulaire envoyé trop vite (< 3 s) = robot.
  // On répond comme si tout allait bien, sans rien enregistrer.
  if (body.botcheck || (typeof body.elapsed === "number" && body.elapsed < 3000)) {
    return send(res, 201, { ok: true, reference: "GO-" + Math.random().toString(36).slice(2, 8).toUpperCase(), token: "" });
  }

  const { errors, data } = validateBooking(body);
  if (Object.keys(errors).length) {
    // Créneau devenu trop proche ou passé : même réponse qu'un créneau pris
    if (errors.time === "err.slotTaken" && Object.keys(errors).length === 1) return send(res, 409, { error: "full" });
    return send(res, 422, { error: "validation", fields: errors });
  }

  try {
    // Anti-spam 2 : limitation du nombre d'envois
    for (const [bucket, keyOf, max, windowSeconds] of LIMITS) {
      const allowed = await db.rpc("check_rate_limit", {
        p_bucket: bucket, p_key: hashKey(keyOf(req, data)), p_max: max, p_window_seconds: windowSeconds,
      });
      if (!allowed) return send(res, 429, { error: "rate_limited" });
    }

    const result = await insertReservation(data, { source: "site", force: false });
    if (!result.ok) return send(res, 409, { error: result.reason });

    const r = result.reservation;
    // Les emails partent en parallèle ; un échec n'annule pas la réservation.
    await Promise.allSettled([
      sendCustomerEmail(r, "confirmee", manageUrl(req, r.reference, result.token)),
      sendBarNotification(r, "nouvelle", `${siteUrl(req)}/admin/`),
    ]);

    return send(res, 201, {
      ok: true,
      reference: r.reference,
      token: result.token,
      reservation: { date: r.date, time: String(r.heure).slice(0, 5), persons: r.personnes },
    });
  } catch (err) {
    console.error("[reservations]", err);
    return send(res, 500, { error: "server" });
  }
};
