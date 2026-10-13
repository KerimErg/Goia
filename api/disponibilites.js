/* GET /api/disponibilites?personnes=4            → état des 30 prochains jours
   GET /api/disponibilites?personnes=4&date=…     → + créneaux de ce jour
   Renvoie uniquement des horaires, des états et des nombres de places :
   jamais de nom, téléphone ou email d'autres clients. */

"use strict";

const CONFIG = require("../js/config.js");
const RULES = require("../js/rules.js");
const { send } = require("./_lib/http");
const { getCapacity, loadOccupancy, computeSlots, computeDays } = require("./_lib/booking");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return send(res, 405, { error: "method_not_allowed" });
  }
  const params = new URL(req.url, "http://x").searchParams;
  const persons = Number.parseInt(params.get("personnes"), 10);
  const date = params.get("date");
  if (!(persons >= 1 && persons <= CONFIG.reservation.maxPersons)) return send(res, 400, { error: "bad_persons" });
  if (date && !RULES.isYmd(date)) return send(res, 400, { error: "bad_date" });

  try {
    const now = RULES.nowInKehl();
    const to = RULES.addDays(now.ymd, CONFIG.reservation.maxDaysAhead);
    const [capacity, data] = await Promise.all([getCapacity(), loadOccupancy(now.ymd, to)]);
    const out = { persons, days: computeDays(persons, data, capacity, now) };
    if (date) {
      const inWindow = RULES.inBookingWindow(CONFIG, date, now);
      out.date = date;
      out.slots = inWindow ? computeSlots(date, persons, data, capacity, now) : [];
    }
    out.fewSeatsThreshold = CONFIG.reservation.fewSeatsThreshold;
    return send(res, 200, out);
  } catch (err) {
    console.error("[disponibilites]", err);
    return send(res, 500, { error: "server" });
  }
};
