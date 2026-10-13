/* ==========================================================================
   LE GOIA — Règles horaires partagées (site + serveur)
   --------------------------------------------------------------------------
   Calcul des créneaux de réservation à partir des horaires de config.js.
   Le même fichier est utilisé par le navigateur (affichage du formulaire)
   et par le serveur (vérification), pour qu'ils soient toujours d'accord.
   Pas besoin de modifier ce fichier : changez plutôt js/config.js.
   ========================================================================== */

(function (root) {
  "use strict";

  const TZ = "Europe/Berlin";
  const pad = (n) => String(n).padStart(2, "0");

  const toMinutes = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
  const fromMinutes = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;

  /** Jour de la semaine (0 = dimanche) d'une date "AAAA-MM-JJ". */
  function weekdayOf(ymd) {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  }

  function addDays(ymd, days) {
    const [y, m, d] = ymd.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + days));
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
  }

  const isYmd = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    addDays(s, 0) === s; // rejette les dates impossibles (ex. 2026-02-31)

  /** Date/heure actuelles à Kehl (fuseau Europe/Berlin), quel que soit l'appareil. */
  function nowInKehl(date) {
    const parts = {};
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(date || new Date()).forEach((p) => { parts[p.type] = p.value; });
    const ymd = `${parts.year}-${parts.month}-${parts.day}`;
    return { ymd, weekday: weekdayOf(ymd), minutes: Number(parts.hour) * 60 + Number(parts.minute) };
  }

  /** Plage d'ouverture d'un jour en minutes ; une fermeture après minuit est gérée. */
  function dayRange(config, dayIndex) {
    const h = config.hours[dayIndex];
    if (!h) return null;
    const open = toMinutes(h.open);
    let close = toMinutes(h.close);
    if (close <= open) close += 24 * 60;
    return { open, close };
  }

  /**
   * Créneaux réservables pour une date ("HH:MM"), dans l'ordre de la soirée.
   * Les créneaux déjà passés aujourd'hui sont exclus.
   */
  function slotsFor(config, ymd, now) {
    now = now || nowInKehl();
    if (!isYmd(ymd) || ymd < now.ymd) return [];
    if (ymd > addDays(now.ymd, config.reservation.maxDaysAhead)) return [];
    const range = dayRange(config, weekdayOf(ymd));
    if (!range) return [];
    const { slotMinutes, lastSlotBeforeClose } = config.reservation;
    const slots = [];
    for (let m = range.open; m <= range.close - lastSlotBeforeClose; m += slotMinutes) {
      if (ymd === now.ymd && m <= now.minutes) continue;
      slots.push(fromMinutes(m));
    }
    return slots;
  }

  /** Ordre « soirée » : 00:30 vient après 23:30 (utile pour trier). */
  const eveningOrder = (hhmm) => { const m = toMinutes(hhmm); return m < 12 * 60 ? m + 1440 : m; };

  const api = { TZ, pad, toMinutes, fromMinutes, weekdayOf, addDays, isYmd, nowInKehl, dayRange, slotsFor, eveningOrder };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.GOIA_RULES = api;
})(typeof window !== "undefined" ? window : globalThis);
