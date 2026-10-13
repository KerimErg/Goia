/* GET /api/availability?date=AAAA-MM-JJ — Places restantes par créneau.
   Permet au formulaire de griser les créneaux complets. */

"use strict";

const RULES = require("../js/rules.js");
const { send } = require("./_lib/http");
const { availability } = require("./_lib/booking");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return send(res, 405, { error: "method_not_allowed" });
  }
  const date = String((req.query && req.query.date) || new URL(req.url, "http://x").searchParams.get("date") || "");
  if (!RULES.isYmd(date)) return send(res, 400, { error: "bad_date" });
  try {
    return send(res, 200, { date, slots: await availability(date) });
  } catch (err) {
    console.error("[availability]", err);
    return send(res, 500, { error: "server" });
  }
};
