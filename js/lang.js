/* ==========================================================================
   LE GOIA — Langue FR / DE pour les pages de réservation
   (même fonctionnement que la page d'accueil : ?lang=, choix mémorisé,
   langue du navigateur ; textes dans js/i18n.js)
   ========================================================================== */

(function (root) {
  "use strict";

  const I18N = root.GOIA_I18N;
  const LANGS = ["fr", "de"];
  const listeners = [];

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignoré */ } },
  };

  function detect() {
    const fromUrl = new URLSearchParams(location.search).get("lang");
    if (LANGS.includes(fromUrl)) return fromUrl;
    const saved = store.get("goia_lang");
    if (LANGS.includes(saved)) return saved;
    const browser = (navigator.languages || [navigator.language || ""])
      .map((l) => l.slice(0, 2).toLowerCase())
      .find((l) => LANGS.includes(l));
    return browser || "fr";
  }

  let lang = detect();

  function t(key, vars) {
    let str = (I18N[lang] && I18N[lang][key]) ?? I18N.fr[key] ?? key;
    if (vars) str = str.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ""));
    return str;
  }

  function apply() {
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll("[data-i18n-html]").forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
    document.querySelectorAll("[data-i18n-aria-label]").forEach((el) => { el.setAttribute("aria-label", t(el.dataset.i18nAriaLabel)); });
    document.querySelectorAll(".lang-switch button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === lang)));
  }

  function set(newLang, save) {
    lang = LANGS.includes(newLang) ? newLang : "fr";
    if (save) store.set("goia_lang", lang);
    apply();
    listeners.forEach((fn) => fn(lang));
  }

  const locale = () => (lang === "de" ? "de-DE" : "fr-FR");

  function formatDate(ymd, options) {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Intl.DateTimeFormat(locale(), { timeZone: "UTC", ...options }).format(new Date(Date.UTC(y, m - 1, d)));
  }

  root.GOIA_LANG = {
    get lang() { return lang; },
    t, set, apply, locale,
    onChange(fn) { listeners.push(fn); },
    init() {
      document.querySelectorAll(".lang-switch button").forEach((b) => b.addEventListener("click", () => set(b.dataset.lang, true)));
      apply();
    },
    formatDateLong: (ymd) => formatDate(ymd, { weekday: "long", day: "numeric", month: "long" }),
    formatDateShort: (ymd) => formatDate(ymd, { weekday: "short", day: "numeric", month: "short" }),
    eur: (n) => new Intl.NumberFormat(locale(), { style: "currency", currency: "EUR" }).format(n),
  };
})(window);
