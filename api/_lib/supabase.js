/* Accès à la base Supabase via son API REST, avec la clé secrète.
   La clé ne quitte jamais le serveur : elle est lue dans les variables
   d'environnement Vercel (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY). */

"use strict";

function settings() {
  const url = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) throw new Error("SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquante");
  return { url, key };
}

function headers(key, extra) {
  const h = { apikey: key, "Content-Type": "application/json", ...extra };
  // Les anciennes clés « service_role » sont des JWT et vont aussi dans Authorization ;
  // les nouvelles clés « sb_secret_… » passent uniquement par l'en-tête apikey.
  if (key.startsWith("eyJ")) h.Authorization = `Bearer ${key}`;
  return h;
}

async function request(method, path, body, extraHeaders) {
  const { url, key } = settings();
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: headers(key, extraHeaders),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(`Supabase ${method} ${path.split("?")[0]} → ${res.status} ${data && data.message}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

module.exports = {
  /** Appelle une fonction SQL (voir supabase/schema.sql). */
  rpc: (name, args) => request("POST", `rpc/${name}`, args),
  select: (query) => request("GET", query),
  insert: (table, values) => request("POST", table, values, { Prefer: "return=representation" }),
  upsert: (table, values) => request("POST", table, values, { Prefer: "resolution=merge-duplicates,return=representation" }),
  update: (query, values) => request("PATCH", query, values, { Prefer: "return=representation" }),
  remove: (query) => request("DELETE", query, undefined, { Prefer: "return=representation" }),
};
