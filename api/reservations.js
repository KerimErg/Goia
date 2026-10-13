/* POST /api/reservations — Crée une réservation, confirmée immédiatement si le
   créneau a de la place (même logique que le site de location).
   Étapes : anti-spam → validation → limitation d'envois → capacité (atomique,
   en base) → emails au client et au bar → renvoie la référence. */

"use strict";

const db = require("./_lib/supabase");
const { send, readJson, clientIp, hashKey, siteUrl } = require("./_lib/http");
const { validateBooking, alternatives, capacity, newReference, newToken, hashToken } = require("./_lib/booking");
const { sendCustomerEmail, sendBarNotification } = require("./_lib/emails");

const LIMITS = [
  // [nom, clé, nombre max, fenêtre en secondes]
  ["booking-ip", (req) => clientIp(req), 3, 60 * 60],          // 3 réservations / heure / connexion
  ["booking-email", (req, d) => d.email, 3, 24 * 60 * 60],     // 3 réservations / jour / adresse email
];

/** Lien « Gérer ma réservation » (page de confirmation) envoyé par email. */
const manageUrl = (req, reference, token) =>
  `${siteUrl(req)}/reservation/confirmation/?ref=${encodeURIComponent(reference)}&t=${encodeURIComponent(token)}`;

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
    return send(res, 201, { ok: true, reference: newReference(), token: "" });
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

    const token = newToken();
    let result;
    for (let attempt = 0; attempt < 3; attempt++) {
      result = await db.rpc("create_reservation", {
        p_reference: newReference(), p_token_hash: hashToken(token),
        p_nom: data.nom, p_telephone: data.telephone, p_email: data.email,
        p_date: data.date, p_heure: data.heure, p_personnes: data.personnes,
        p_message: data.message, p_langue: data.langue,
        p_espace: data.espace, p_precommande: data.precommande, p_total: data.total,
        p_capacite: capacity(),
      });
      if (result.reason !== "duplicate_reference") break;
    }

    if (!result.ok) {
      if (result.reason !== "full") throw new Error(`create_reservation: ${result.reason}`);
      return send(res, 409, {
        error: "full",
        remaining: result.restant,
        alternatives: await alternatives(data.date, data.heure, data.personnes),
      });
    }

    const r = result.reservation;
    // Les emails partent en parallèle ; un échec n'annule pas la réservation.
    await Promise.allSettled([
      sendCustomerEmail(r, "confirmee", manageUrl(req, r.reference, token)),
      sendBarNotification(r, "nouvelle", `${siteUrl(req)}/admin/`),
    ]);

    return send(res, 201, { ok: true, reference: r.reference, token });
  } catch (err) {
    console.error("[reservations]", err);
    return send(res, 500, { error: "server" });
  }
};
