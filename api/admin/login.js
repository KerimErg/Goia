/* POST /api/admin/login { password } — Connexion au panneau admin.
   DELETE /api/admin/login — Déconnexion. */

"use strict";

const db = require("../_lib/supabase");
const { send, readJson, clientIp, hashKey } = require("../_lib/http");
const { passwordMatches, sessionCookie, clearCookie } = require("../_lib/auth");

module.exports = async function handler(req, res) {
  if (req.method === "DELETE") {
    res.setHeader("Set-Cookie", clearCookie());
    return send(res, 200, { ok: true });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, DELETE");
    return send(res, 405, { error: "method_not_allowed" });
  }
  if (!process.env.ADMIN_PASSWORD) return send(res, 500, { error: "not_configured" });

  let body;
  try { body = await readJson(req); } catch (e) { return send(res, 400, { error: "bad_request" }); }

  try {
    // Protection contre les essais de mots de passe en série : 10 tentatives / 15 min
    const allowed = await db.rpc("check_rate_limit", {
      p_bucket: "admin-login", p_key: hashKey(clientIp(req)), p_max: 10, p_window_seconds: 15 * 60,
    });
    if (!allowed) return send(res, 429, { error: "rate_limited" });
  } catch (err) {
    console.error("[admin/login]", err);
    return send(res, 500, { error: "server" });
  }

  if (!passwordMatches(typeof body.password === "string" ? body.password : "")) {
    return send(res, 401, { error: "wrong_password" });
  }
  res.setHeader("Set-Cookie", sessionCookie());
  return send(res, 200, { ok: true });
};
