/* Petits utilitaires HTTP communs aux fonctions serverless. */

"use strict";

const crypto = require("crypto");

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

/** Corps JSON de la requête (Vercel le pré-analyse ; sinon on le lit nous-mêmes). */
async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 20000) throw new Error("Corps trop volumineux");
  }
  return raw ? JSON.parse(raw) : {};
}

function clientIp(req) {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return fwd || req.headers["x-real-ip"] || (req.socket && req.socket.remoteAddress) || "unknown";
}

/** Empreinte non réversible (on ne stocke jamais l'adresse IP en clair). */
function hashKey(value) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || "goia";
  return crypto.createHmac("sha256", secret).update(String(value)).digest("hex").slice(0, 32);
}

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || "").split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function siteUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/+$/, "");
  const proto = req.headers["x-forwarded-proto"] || "https";
  return `${proto}://${req.headers["x-forwarded-host"] || req.headers.host}`;
}

module.exports = { send, readJson, clientIp, hashKey, parseCookies, siteUrl };
