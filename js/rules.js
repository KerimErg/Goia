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
   * Tous les créneaux d'une date, en minutes depuis minuit de cette date
   * (un créneau après minuit vaut plus de 1440 : il appartient à la même soirée).
   */
  function daySlotMinutes(config, ymd) {
    if (!isYmd(ymd)) return [];
    const range = dayRange(config, weekdayOf(ymd));
    if (!range) return [];
    const { slotMinutes, lastSlotBeforeClose } = config.reservation;
    const out = [];
    for (let m = range.open; m <= range.close - lastSlotBeforeClose; m += slotMinutes) out.push(m);
    return out;
  }

  /** Tous les créneaux d'une date ("HH:MM"), y compris ceux déjà passés. */
  const daySlots = (config, ymd) => daySlotMinutes(config, ymd).map(fromMinutes);

  /** Date réservable : pas dans le passé ni au-delà de maxDaysAhead jours. */
  function inBookingWindow(config, ymd, now) {
    now = now || nowInKehl();
    return isYmd(ymd) && ymd >= now.ymd && ymd <= addDays(now.ymd, config.reservation.maxDaysAhead);
  }

  /** Un créneau est-il encore réservable maintenant ? (délai minimum : minLeadMinutes) */
  function isSlotOpen(config, ymd, minutes, now) {
    now = now || nowInKehl();
    if (!inBookingWindow(config, ymd, now)) return false;
    if (ymd > now.ymd) return true;
    return minutes >= now.minutes + (config.reservation.minLeadMinutes || 0);
  }

  /**
   * Créneaux encore réservables pour une date ("HH:MM"), dans l'ordre de la soirée
   * (sans tenir compte des places : voir /api/disponibilites).
   */
  function slotsFor(config, ymd, now) {
    now = now || nowInKehl();
    return daySlotMinutes(config, ymd).filter((m) => isSlotOpen(config, ymd, m, now)).map(fromMinutes);
  }

  /** Ordre « soirée » : 00:30 vient après 23:30 (utile pour trier). */
  const eveningOrder = (hhmm) => { const m = toMinutes(hhmm); return m < 12 * 60 ? m + 1440 : m; };

  const api = {
    TZ, pad, toMinutes, fromMinutes, weekdayOf, addDays, isYmd, nowInKehl, dayRange,
    daySlotMinutes, daySlots, inBookingWindow, isSlotOpen, slotsFor, eveningOrder,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.GOIA_RULES = api;
})(typeof window !== "undefined" ? window : globalThis);
