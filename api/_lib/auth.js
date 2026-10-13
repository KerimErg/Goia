/* Authentification du panneau admin.
   Le mot de passe est dans la variable d'environnement ADMIN_PASSWORD.
   Après connexion, le navigateur reçoit un cookie signé (HttpOnly) valable 12 h.
   Changer ADMIN_PASSWORD dans Vercel déconnecte immédiatement toutes les sessions. */

"use strict";

const crypto = require("crypto");
const { parseCookies, send } = require("./http");

const COOKIE = "goia_admin";
const SESSION_SECONDS = 12 * 60 * 60;

function signingKey() {
  const pwd = process.env.ADMIN_PASSWORD || "";
  if (!pwd) throw new Error("ADMIN_PASSWORD manquant");
  return crypto.createHmac("sha256", "goia-admin-session").update(pwd).digest();
}

const sign = (payload) => crypto.createHmac("sha256", signingKey()).update(payload).digest("base64url");

function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function passwordMatches(input) {
  const pwd = process.env.ADMIN_PASSWORD || "";
  return !!pwd && safeEqual(input || "", pwd);
}

function sessionCookie() {
  const exp = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const token = `${exp}.${sign(String(exp))}`;
  return `${COOKIE}=${token}; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`;
}

const clearCookie = () => `${COOKIE}=; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

function isAuthenticated(req) {
  const token = parseCookies(req)[COOKIE] || "";
  const [exp, sig] = token.split(".");
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  return safeEqual(sig, sign(exp));
}

/** À appeler en tête de chaque fonction admin : renvoie false (et répond 401) si non connecté. */
function requireAdmin(req, res) {
  try {
    if (isAuthenticated(req)) return true;
  } catch (e) {
    send(res, 500, { error: "not_configured" });
    return false;
  }
  send(res, 401, { error: "unauthorized" });
  return false;
}

module.exports = { passwordMatches, sessionCookie, clearCookie, requireAdmin };
