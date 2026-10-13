/* POST /api/reservations — Enregistre une demande de réservation.
   Étapes : anti-spam → validation → limitation d'envois → contrôle de capacité
   (atomique, en base) → emails au client et au bar. */

"use strict";

const db = require("./_lib/supabase");
const { send, readJson, clientIp, hashKey, siteUrl } = require("./_lib/http");
const { validateBooking, alternatives, capacity } = require("./_lib/booking");
const { sendCustomerEmail, sendBarNotification } = require("./_lib/emails");

const LIMITS = [
  // [nom, clé, nombre max, fenêtre en secondes]
  ["booking-ip", (req) => clientIp(req), 3, 60 * 60],          // 3 demandes / heure / connexion
  ["booking-email", (req, d) => d.email, 3, 24 * 60 * 60],     // 3 demandes / jour / adresse email
];

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "method_not_allowed" });
  }

  let body;
  try { body = await readJson(req); } catch (e) { return send(res, 400, { error: "bad_request" }); }

  // Anti-spam 1 : champ invisible rempli, ou formulaire envoyé trop vite (< 3 s) = robot.
  // On répond « OK » sans rien enregistrer pour ne pas renseigner le robot.
  if (body.botcheck || (typeof body.elapsed === "number" && body.elapsed < 3000)) {
    return send(res, 201, { ok: true });
  }

  const { errors, data } = validateBooking(body);
  if (Object.keys(errors).length) return send(res, 422, { error: "validation", fields: errors });

  try {
    // Anti-spam 2 : limitation du nombre d'envois
    for (const [bucket, keyOf, max, windowSeconds] of LIMITS) {
      const allowed = await db.rpc("check_rate_limit", {
        p_bucket: bucket, p_key: hashKey(keyOf(req, data)), p_max: max, p_window_seconds: windowSeconds,
      });
      if (!allowed) return send(res, 429, { error: "rate_limited" });
    }

    const result = await db.rpc("create_reservation", {
      p_nom: data.nom, p_telephone: data.telephone, p_email: data.email,
      p_date: data.date, p_heure: data.heure, p_personnes: data.personnes,
      p_message: data.message, p_langue: data.langue, p_capacite: capacity(),
    });

    if (!result.ok) {
      return send(res, 409, {
        error: "full",
        remaining: result.restant,
        alternatives: await alternatives(data.date, data.heure, data.personnes),
      });
    }

    const r = result.reservation;
    // Les emails partent en parallèle ; un échec n'annule pas la réservation.
    await Promise.allSettled([
      sendCustomerEmail(r, "received"),
      sendBarNotification(r, `${siteUrl(req)}/admin/`),
    ]);

    return send(res, 201, {
      ok: true,
      reservation: { date: r.date, time: String(r.heure).slice(0, 5), persons: r.personnes },
    });
  } catch (err) {
    console.error("[reservations]", err);
    return send(res, 500, { error: "server" });
  }
};
