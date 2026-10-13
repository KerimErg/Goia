/* ==========================================================================
   LE GOIA — Logique du site
   --------------------------------------------------------------------------
   Sommaire :
     1. Utilitaires (traduction, stockage, dates)
     2. Langue FR / DE
     3. Vérification de l'âge
     4. Navigation
     5. Menu (chargé depuis data/menu.json)
     6. Horaires & statut « ouvert maintenant »
     7. Panneau de réservation (date, horaire, personnes)
     8. WhatsApp, téléphone, réseaux (depuis js/config.js)
     9. Carte Google Maps (chargée après clic)
    10. Animations d'apparition
   Vous n'avez normalement pas besoin de modifier ce fichier :
   les contenus se règlent dans config.js, i18n.js et data/menu.json.
   ========================================================================== */

(function () {
  "use strict";

  const CONFIG = window.GOIA_CONFIG;
  const I18N = window.GOIA_I18N;
  const RULES = window.GOIA_RULES; // règles horaires partagées avec le serveur (js/rules.js)
  const LANGS = ["fr", "de"];
  const API_AVAILABILITY = "/api/availability";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  let lang = "fr";
  let menuData = null;
  let activeCategory = null;

  /* ======================================================================
     1. Utilitaires
     ====================================================================== */

  /** Renvoie le texte traduit et remplace les {variables}. */
  function t(key, vars) {
    let str = (I18N[lang] && I18N[lang][key]) ?? I18N.fr[key] ?? key;
    if (vars) str = str.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ""));
    return str;
  }

  /** localStorage peut être bloqué (navigation privée) : on protège tout. */
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignoré */ } },
  };

  const locale = () => (lang === "de" ? "de-DE" : "fr-FR");
  const { nowInKehl, weekdayOf, addDays } = RULES;
  const dayRange = (dayIndex) => RULES.dayRange(CONFIG, dayIndex);

  /* ======================================================================
     2. Langue FR / DE
     ====================================================================== */

  function detectLang() {
    const fromUrl = new URLSearchParams(location.search).get("lang");
    if (LANGS.includes(fromUrl)) return fromUrl;
    const saved = store.get("goia_lang");
    if (LANGS.includes(saved)) return saved;
    const browser = (navigator.languages || [navigator.language || ""])
      .map((l) => l.slice(0, 2).toLowerCase())
      .find((l) => LANGS.includes(l));
    return browser || "fr";
  }

  function setLang(newLang, save) {
    lang = LANGS.includes(newLang) ? newLang : "fr";
    if (save) store.set("goia_lang", lang);

    document.documentElement.lang = lang;
    document.title = t("meta.title");
    const desc = $('meta[name="description"]');
    if (desc) desc.setAttribute("content", t("meta.description"));

    $$("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    $$("[data-i18n-html]").forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
    $$("[data-i18n-placeholder]").forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
    $$("[data-i18n-aria-label]").forEach((el) => { el.setAttribute("aria-label", t(el.dataset.i18nAriaLabel)); });
    $$(".lang-switch button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === lang)));

    // Contenus générés dynamiquement
    renderMenu();
    renderHours();
    renderPanel();
    if (calendar) calendar.render();
    updateWhatsAppLinks();
  }

  function initLang() {
    $$(".lang-switch button").forEach((btn) =>
      btn.addEventListener("click", () => setLang(btn.dataset.lang, true))
    );
  }

  /* ======================================================================
     3. Vérification de l'âge (mémorisée dans le navigateur)
     ====================================================================== */

  function initAgeGate() {
    const gate = $("#age-gate");
    if (store.get("goia_age_ok") === "1") return;

    gate.hidden = false;
    document.body.classList.add("is-locked");
    const yes = $("#age-yes");
    setTimeout(() => yes.focus(), 50);

    yes.addEventListener("click", () => {
      store.set("goia_age_ok", "1");
      gate.hidden = true;
      document.body.classList.remove("is-locked");
    });
    $("#age-no").addEventListener("click", () => {
      $("#age-denied").hidden = false;
      $(".age-gate__actions").hidden = true;
    });

    // Garde le focus clavier à l'intérieur de la fenêtre
    gate.addEventListener("keydown", (e) => {
      if (e.key !== "Tab") return;
      const focusables = $$("button:not([hidden])", gate).filter((b) => b.offsetParent !== null);
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  /* ======================================================================
     4. Navigation (fond au scroll + menu burger)
     ====================================================================== */

  function initNav() {
    const nav = $("#nav");
    const burger = $("#nav-burger");

    const onScroll = () => nav.classList.toggle("is-scrolled", window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    const setOpen = (open) => {
      nav.classList.toggle("is-open", open);
      burger.setAttribute("aria-expanded", String(open));
    };
    burger.addEventListener("click", () => setOpen(!nav.classList.contains("is-open")));
    $$("#nav-links a").forEach((a) => a.addEventListener("click", () => setOpen(false)));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); });
  }

  /* ======================================================================
     5. Menu
     ====================================================================== */

  async function loadMenu() {
    try {
      const res = await fetch("data/menu.json", { cache: "no-cache" });
      if (!res.ok) throw new Error(res.status);
      menuData = await res.json();
      activeCategory = menuData.categories[0] && menuData.categories[0].id;
      renderMenu();
      // Le menu change la hauteur de la page : on recale un lien direct (ex. /#infos)
      const target = location.hash && document.getElementById(location.hash.slice(1));
      if (target) target.scrollIntoView();
    } catch (err) {
      console.error(
        "[Le Goia] Impossible de charger data/menu.json. " +
        "Ouvrez le site via un serveur (voir README), pas en double-cliquant sur index.html, " +
        "et vérifiez la syntaxe du fichier sur jsonlint.com.", err
      );
      $("#menu-panels").innerHTML = "";
      const p = document.createElement("p");
      p.className = "menu__status";
      p.textContent = t("menu.error");
      $("#menu-panels").appendChild(p);
    }
  }

  const localized = (obj) => (obj == null ? "" : typeof obj === "string" ? obj : obj[lang] || obj.fr || "");

  function renderMenu() {
    if (!menuData) return;
    const tabs = $("#menu-tabs");
    const panels = $("#menu-panels");
    const priceFmt = new Intl.NumberFormat(locale(), { style: "currency", currency: "EUR" });
    tabs.innerHTML = "";
    panels.innerHTML = "";

    menuData.categories.forEach((cat) => {
      const selected = cat.id === activeCategory;

      // Onglet
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "menu__tab";
      tab.id = `tab-${cat.id}`;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(selected));
      tab.setAttribute("aria-controls", `panel-${cat.id}`);
      tab.tabIndex = selected ? 0 : -1;
      tab.textContent = localized(cat.name);
      tab.addEventListener("click", () => selectCategory(cat.id));
      tabs.appendChild(tab);

      // Panneau
      const panel = document.createElement("div");
      panel.className = "menu__panel";
      panel.id = `panel-${cat.id}`;
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", tab.id);
      panel.hidden = !selected;

      const groups = document.createElement("div");
      groups.className = "menu__groups";
      (cat.groups || []).forEach((group) => {
        const g = document.createElement("div");
        g.className = "menu__group";
        if (group.name) {
          const h = document.createElement("h3");
          h.className = "menu__group-title";
          h.textContent = localized(group.name);
          g.appendChild(h);
        }
        const ul = document.createElement("ul");
        ul.className = "menu__list";
        (group.items || []).forEach((item) => {
          const li = document.createElement("li");
          li.className = "menu__item";

          const line = document.createElement("div");
          line.className = "menu__line";
          const name = document.createElement("span");
          name.className = "menu__name";
          name.textContent = localized(item.name);
          if (item.tag) {
            const tag = document.createElement("span");
            tag.className = `menu__tag menu__tag--${item.tag}`;
            tag.textContent = t(`menu.tag.${item.tag}`);
            name.appendChild(tag);
          }
          const dots = document.createElement("span");
          dots.className = "menu__dots";
          dots.setAttribute("aria-hidden", "true");
          const price = document.createElement("span");
          price.className = "menu__price";
          price.textContent = typeof item.price === "number" ? priceFmt.format(item.price) : (item.price || "");
          line.append(name, dots, price);
          li.appendChild(line);

          const descText = localized(item.desc);
          if (descText) {
            const desc = document.createElement("p");
            desc.className = "menu__desc";
            desc.textContent = descText;
            li.appendChild(desc);
          }
          ul.appendChild(li);
        });
        g.appendChild(ul);
        groups.appendChild(g);
      });
      panel.appendChild(groups);
      panels.appendChild(panel);
    });

    // Navigation clavier entre onglets (flèches gauche/droite)
    tabs.onkeydown = (e) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
      const ids = menuData.categories.map((c) => c.id);
      let i = ids.indexOf(activeCategory);
      if (e.key === "ArrowRight") i = (i + 1) % ids.length;
      if (e.key === "ArrowLeft") i = (i - 1 + ids.length) % ids.length;
      if (e.key === "Home") i = 0;
      if (e.key === "End") i = ids.length - 1;
      e.preventDefault();
      selectCategory(ids[i], true);
    };
  }

  function selectCategory(id, focus) {
    activeCategory = id;
    $$(".menu__tab").forEach((tab) => {
      const on = tab.id === `tab-${id}`;
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      if (on) {
        if (focus) tab.focus();
        tab.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
      }
    });
    $$(".menu__panel").forEach((p) => { p.hidden = p.id !== `panel-${id}`; });
  }

  /* ======================================================================
     6. Horaires
     ====================================================================== */

  function renderHours() {
    const list = $("#hours-list");
    const order = [1, 2, 3, 4, 5, 6, 0]; // lundi → dimanche
    const label = (d) => {
      const h = CONFIG.hours[d];
      return h ? `${h.open} – ${h.close}` : t("info.closed");
    };
    const today = nowInKehl().weekday;

    // Regroupe les jours consécutifs ayant les mêmes horaires (ex. Lundi – Jeudi)
    const groups = [];
    order.forEach((d) => {
      const last = groups[groups.length - 1];
      if (last && last.label === label(d)) last.days.push(d);
      else groups.push({ label: label(d), days: [d] });
    });

    list.innerHTML = "";
    groups.forEach((g) => {
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      const first = t(`day.${g.days[0]}`);
      const last = t(`day.${g.days[g.days.length - 1]}`);
      dt.textContent = g.days.length > 1 ? `${first} – ${last}` : first;
      dd.textContent = g.label;
      if (g.days.includes(today)) { dt.classList.add("is-today"); dd.classList.add("is-today"); }
      if (!CONFIG.hours[g.days[0]]) dd.classList.add("is-closed");
      list.append(dt, dd);
    });

    // Statut ouvert / fermé (tient compte des soirées qui finissent après minuit)
    const now = nowInKehl();
    const todayRange = dayRange(now.weekday);
    const yesterdayRange = dayRange((now.weekday + 6) % 7);
    const open =
      (todayRange && now.minutes >= todayRange.open && now.minutes < todayRange.close) ||
      (yesterdayRange && now.minutes + 1440 < yesterdayRange.close);
    const status = $("#open-status");
    status.hidden = false;
    status.classList.toggle("is-open", !!open);
    status.textContent = open ? t("info.openNow") : t("info.closedNow");
  }

  /* ======================================================================
     7. Panneau de réservation (date, horaire, personnes)
     ====================================================================== */

  /* Panneau de réservation (même rôle que le panneau de recherche du site de
     location) : date au calendrier, horaire, personnes → étapes sur /reservation/ */
  const panel = $("#booking-panel");
  const bp = { date: "", time: "", persons: 2 };
  let slotAvailability = {};   // places restantes par créneau pour la date choisie
  let availabilityRequest = 0;
  let panelErrorKey = "";
  let calendar = null;

  const formatDateShort = (ymd) => {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Intl.DateTimeFormat(locale(), { weekday: "short", day: "numeric", month: "long", timeZone: "UTC" })
      .format(new Date(Date.UTC(y, m - 1, d)));
  };

  /** Texte sous le calendrier : jours de fermeture + réservation jusqu'à N jours. */
  function calendarFooter() {
    const closed = [1, 2, 3, 4, 5, 6, 0].filter((d) => !CONFIG.hours[d]).map((d) => t(`day.${d}`).toLowerCase());
    const range = t("cal.range", { n: CONFIG.reservation.maxDaysAhead });
    return closed.length ? `${t("cal.closed", { days: closed.join(", ") })} · ${range}` : range;
  }

  function showPanelError(key) {
    panelErrorKey = key;
    const box = $("#bp-error");
    box.textContent = key ? t(key) : "";
    box.hidden = !key;
  }

  function renderPanel() {
    $("#bp-date-value").textContent = bp.date ? formatDateShort(bp.date) : t("panel.datePh");
    $("#bp-date").classList.toggle("is-empty", !bp.date);

    // Horaires du jour choisi ; un créneau sans assez de places est grisé « complet »
    const select = $("#bp-time");
    select.innerHTML = "";
    const add = (value, text, disabled) => {
      const o = document.createElement("option");
      o.value = value; o.textContent = text; o.disabled = !!disabled;
      select.appendChild(o);
    };
    const slots = bp.date ? RULES.slotsFor(CONFIG, bp.date) : [];
    const isFull = (s) => slotAvailability[s] !== undefined && slotAvailability[s] < bp.persons;
    if (!slots.length) {
      add("", bp.date ? t("booking.time.none") : "—");
      select.disabled = true;
    } else {
      add("", t("booking.time.choose"));
      slots.forEach((s) => add(s, isFull(s) ? `${s} — ${t("booking.time.full")}` : s, isFull(s)));
      select.disabled = false;
    }
    if (!slots.includes(bp.time) || isFull(bp.time)) bp.time = "";
    select.value = bp.time;

    const max = CONFIG.reservation.maxPersons;
    $("#bp-persons-value").textContent = String(bp.persons);
    $("#bp-less").disabled = bp.persons <= 1;
    $("#bp-more").disabled = bp.persons >= max;
    $("#bp-note").textContent = bp.persons >= max
      ? t("booking.persons.more", { max })
      : t("panel.note", { h: CONFIG.reservation.cancelHoursBefore });

    // Tous les créneaux du jour sont complets pour ce groupe
    const allFull = slots.length && slots.every(isFull);
    if (allFull) showPanelError("booking.fullNoAlt");
    else if (panelErrorKey === "booking.fullNoAlt") showPanelError("");
    else if (panelErrorKey) showPanelError(panelErrorKey);
  }

  /** Demande au serveur les places restantes pour la date choisie. */
  async function loadAvailability() {
    const date = bp.date;
    const requestId = ++availabilityRequest;
    slotAvailability = {};
    if (!date) return;
    try {
      const res = await fetch(`${API_AVAILABILITY}?date=${encodeURIComponent(date)}`, { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      if (requestId !== availabilityRequest) return; // une autre date a été choisie entre-temps
      json.slots.forEach((s) => { slotAvailability[s.time] = s.remaining; });
      renderPanel();
    } catch (e) {
      // Serveur injoignable : tous les créneaux restent proposés, le serveur revérifiera.
    }
  }

  function initBookingPanel() {
    const now = nowInKehl();
    const max = CONFIG.reservation.maxPersons;

    // Retour depuis /reservation/ (« Modifier la date et l'heure ») : on reprend les choix
    const params = new URLSearchParams(location.search);
    if (RULES.slotsFor(CONFIG, params.get("date") || "").length) bp.date = params.get("date");
    if (params.get("time")) bp.time = params.get("time");
    const p = Number.parseInt(params.get("persons"), 10);
    if (p >= 1 && p <= max) bp.persons = p;

    calendar = window.GoiaCalendar.create({
      anchor: $("#bp-date"),
      getValue: () => bp.date,
      onSelect: (ymd) => {
        bp.date = ymd;
        bp.time = "";
        showPanelError("");
        renderPanel();
        loadAvailability();
      },
      isDisabled: (ymd) => !RULES.slotsFor(CONFIG, ymd).length,
      min: now.ymd,
      max: addDays(now.ymd, CONFIG.reservation.maxDaysAhead),
      locale,
      t,
      footer: calendarFooter,
    });

    $("#bp-time").addEventListener("change", (e) => { bp.time = e.target.value; showPanelError(""); });
    const setPersons = (n) => { bp.persons = Math.min(Math.max(n, 1), max); renderPanel(); };
    $("#bp-less").addEventListener("click", () => setPersons(bp.persons - 1));
    $("#bp-more").addEventListener("click", () => setPersons(bp.persons + 1));

    panel.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!bp.date) { showPanelError("panel.errDate"); $("#bp-date").focus(); return; }
      if (!bp.time) { showPanelError("panel.errTime"); $("#bp-time").focus(); return; }
      const query = new URLSearchParams({ date: bp.date, time: bp.time, persons: String(bp.persons), lang });
      location.href = `reservation/?${query}`;
    });

    renderPanel();
    if (bp.date) loadAvailability();
  }

  /* ======================================================================
     8. Coordonnées, WhatsApp et réseaux (depuis config.js)
     ====================================================================== */

  /** Lien WhatsApp (section Infos) avec un message d'accueil pré-rempli. */
  function updateWhatsAppLinks() {
    const url = `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(t("wa.message"))}`;
    $$("[data-config-wa]").forEach((a) => { a.href = url; });
  }

  function applyConfig() {
    $$("[data-config-tel]").forEach((a) => { a.href = `tel:${CONFIG.phone}`; });
    $$("[data-config-mail]").forEach((a) => { a.href = `mailto:${CONFIG.email}`; });
    $$("[data-config-text]").forEach((el) => { el.textContent = CONFIG[el.dataset.configText]; });
    $$("[data-config-href]").forEach((a) => {
      const url = CONFIG[a.dataset.configHref];
      if (url) a.href = url; else a.hidden = true;
    });

    const ad = CONFIG.address;
    const address = $("#info-address");
    address.textContent = "";
    address.append(ad.street, document.createElement("br"), `${ad.zip} ${ad.city}, ${ad.country}`);

    $("#directions-link").href =
      `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(CONFIG.mapsQuery)}`;
    $("#year").textContent = new Date().getFullYear();
  }

  /* ======================================================================
     9. Carte Google Maps — uniquement après clic (DSGVO / RGPD)
     ====================================================================== */

  function initMap() {
    $("#map-load").addEventListener("click", () => {
      const iframe = document.createElement("iframe");
      iframe.src = `https://maps.google.com/maps?q=${encodeURIComponent(CONFIG.mapsQuery)}&z=16&output=embed`;
      iframe.title = t("map.title");
      iframe.loading = "lazy";
      iframe.referrerPolicy = "no-referrer-when-downgrade";
      iframe.allowFullscreen = true;
      const map = $("#map");
      map.innerHTML = "";
      map.appendChild(iframe);
    });
  }

  /* ======================================================================
     10. Apparition au scroll
     ====================================================================== */

  function initReveal() {
    const items = $$(".reveal");
    if (!("IntersectionObserver" in window)) {
      items.forEach((el) => el.classList.add("is-visible"));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    items.forEach((el) => io.observe(el));
  }

  /* ---------------------------------------------------------------------- */

  applyConfig();
  initNav();
  initLang();
  initBookingPanel();
  initMap();
  initReveal();
  setLang(detectLang(), false);
  initAgeGate();
  loadMenu();
})();
