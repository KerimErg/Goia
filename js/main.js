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
     7. Formulaire de réservation
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
  const API_RESERVATIONS = "/api/reservations";
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

  function formatDateLong(ymd) {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Intl.DateTimeFormat(locale(), {
      weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
    }).format(new Date(Date.UTC(y, m - 1, d)));
  }

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
    refreshTimeSlots();
    renderPersons();
    refreshVisibleErrors();
    updateWhatsAppLinks();
    if (!$("#booking-success").hidden) showSuccess(lastBooking);
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
     7. Formulaire de réservation
     ====================================================================== */

  const form = $("#booking-form");
  const fields = {
    name: $("#f-name"),
    phone: $("#f-phone"),
    email: $("#f-email"),
    date: $("#f-date"),
    time: $("#f-time"),
    persons: $("#f-persons"),
    age: $("#f-age"),
    privacy: $("#f-privacy"),
  };
  let lastBooking = null;
  let slotAvailability = {};   // places restantes par créneau pour la date choisie, ex. { "21:00": 6 }
  let availabilityRequest = 0;
  let lastAlternatives = [];
  const formOpenedAt = Date.now(); // anti-robot : un humain met plus de 3 s à remplir le formulaire

  /** Chaque règle renvoie la clé du message d'erreur, ou "" si c'est valide. */
  const validators = {
    name: (v) => (v.trim().length >= 2 ? "" : "err.name"),
    phone: (v) => (/^\+?\d{6,15}$/.test(v.replace(/[\s().\/-]/g, "")) ? "" : "err.phone"),
    email: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? "" : "err.email"),
    date: (v) => {
      if (!v) return "err.date";
      if (v < nowInKehl().ymd) return "err.datePast";
      if (!dayRange(weekdayOf(v))) return "err.dateClosed";
      return "";
    },
    time: (v) => (v ? "" : "err.time"),
    persons: (v) => (v ? "" : "err.persons"),
    age: (_, el) => (el.checked ? "" : "err.age"),
    privacy: (_, el) => (el.checked ? "" : "err.privacy"),
  };

  /** Affiche (ou efface si key = "") l'erreur d'un champ. */
  function setFieldError(name, key) {
    const el = fields[name];
    if (!el) return;
    const wrap = el.closest(".field");
    const msg = $(`#${el.id}-err`);
    wrap.classList.toggle("has-error", !!key);
    el.setAttribute("aria-invalid", String(!!key));
    if (key) el.setAttribute("aria-describedby", msg.id);
    else el.removeAttribute("aria-describedby");
    msg.dataset.key = key;
    msg.textContent = key ? t(key) : "";
  }

  function validateField(name) {
    const el = fields[name];
    const key = validators[name](el.value, el);
    setFieldError(name, key);
    return !key;
  }

  function focusFirstInvalid() {
    const first = Object.values(fields).find((el) => el.getAttribute("aria-invalid") === "true");
    if (first) first.focus();
  }

  /** Après un changement de langue, retraduit les erreurs déjà affichées. */
  function refreshVisibleErrors() {
    $$(".field__error").forEach((p) => { if (p.dataset.key) p.textContent = t(p.dataset.key); });
    const alert = $("#form-alert");
    if (!alert.hidden && alert.dataset.key) alert.textContent = t(alert.dataset.key);
  }

  function showAlert(key) {
    const alert = $("#form-alert");
    alert.dataset.key = key || "";
    alert.textContent = key ? t(key) : "";
    alert.hidden = !key;
    if (!key) showAlternatives([]);
  }

  /** Créneau complet : propose des horaires proches encore disponibles (boutons). */
  function showAlternatives(times) {
    lastAlternatives = times;
    const box = $("#slot-alternatives");
    box.innerHTML = "";
    box.hidden = !times.length;
    times.forEach((time) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "slot-chip";
      b.textContent = time;
      b.addEventListener("click", () => {
        fields.time.value = time;
        validateField("time");
        showAlert("");
        $("#f-submit").focus();
      });
      box.appendChild(b);
    });
  }

  /** Bornes du calendrier : aujourd'hui → aujourd'hui + N jours. */
  function initDateInput() {
    const today = nowInKehl().ymd;
    fields.date.min = today;
    fields.date.max = addDays(today, CONFIG.reservation.maxDaysAhead);
  }

  /** Créneaux selon le jour choisi ; les créneaux complets sont grisés. */
  function refreshTimeSlots() {
    const select = fields.time;
    const date = fields.date.value;
    const previous = select.value;
    select.innerHTML = "";

    const addOption = (value, text, disabled) => {
      const o = document.createElement("option");
      o.value = value;
      o.textContent = text;
      o.disabled = !!disabled;
      select.appendChild(o);
    };

    const range = date ? dayRange(weekdayOf(date)) : null;
    const slots = range ? RULES.slotsFor(CONFIG, date) : [];
    if (!slots.length) {
      addOption("", t(date && !range ? "booking.time.closed" : date ? "booking.time.none" : "booking.time.pickDate"));
      select.disabled = true;
      return;
    }

    const persons = Number(fields.persons.value) || 1;
    const isFull = (s) => slotAvailability[s] !== undefined && slotAvailability[s] < persons;
    addOption("", t("booking.time.choose"));
    slots.forEach((s) => addOption(s, isFull(s) ? `${s} — ${t("booking.time.full")}` : s, isFull(s)));
    select.disabled = false;
    if (slots.includes(previous) && !isFull(previous)) select.value = previous;
  }

  /** Demande au serveur les places restantes pour la date choisie. */
  async function loadAvailability() {
    const date = fields.date.value;
    const requestId = ++availabilityRequest;
    slotAvailability = {};
    if (!date) return;
    try {
      const res = await fetch(`${API_AVAILABILITY}?date=${encodeURIComponent(date)}`, { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      if (requestId !== availabilityRequest) return; // une date plus récente a été choisie entre-temps
      json.slots.forEach((s) => { slotAvailability[s.time] = s.remaining; });
      refreshTimeSlots();
    } catch (e) {
      // Serveur injoignable : on garde tous les créneaux, le serveur revérifiera à l'envoi.
    }
  }

  function renderPersons() {
    const select = fields.persons;
    const current = select.value || "2";
    const max = CONFIG.reservation.maxPersons;
    select.innerHTML = "";
    for (let i = 1; i <= max; i++) {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = String(i);
      select.appendChild(o);
    }
    select.value = Number(current) <= max ? current : "2";
    $("#persons-hint").textContent = t("booking.persons.more", { max });
  }

  function showSuccess(data) {
    if (!data) return;
    $("#success-title").textContent = t("booking.success.title", { name: data.name.split(" ")[0] });
    $("#success-text").textContent = t("booking.success.text");
    $("#success-recap").textContent = t("booking.success.recap", {
      date: formatDateLong(data.date), time: data.time, persons: data.persons,
    });
  }

  function initBookingForm() {
    initDateInput();
    renderPersons();

    // Validation en direct : au départ d'un champ, puis à chaque saisie si erreur
    Object.keys(fields).forEach((name) => {
      const el = fields[name];
      const isCheck = el.type === "checkbox";
      el.addEventListener(isCheck || el.tagName === "SELECT" ? "change" : "blur", () => {
        if (isCheck || el.value) validateField(name);
      });
      el.addEventListener("input", () => {
        if (el.closest(".field").classList.contains("has-error")) validateField(name);
      });
    });

    fields.date.addEventListener("change", () => {
      showAlert("");
      refreshTimeSlots();
      loadAvailability();
      validateField("date");
      if (fields.time.closest(".field").classList.contains("has-error")) validateField("time");
    });
    fields.persons.addEventListener("change", refreshTimeSlots);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      showAlert("");

      // Re-calcule les créneaux (au cas où la page est restée ouverte longtemps)
      refreshTimeSlots();
      const results = Object.keys(fields).map(validateField);
      if (results.includes(false)) {
        showAlert("err.summary");
        focusFirstInvalid();
        return;
      }

      const data = {
        name: fields.name.value.trim(),
        phone: fields.phone.value.trim(),
        email: fields.email.value.trim(),
        date: fields.date.value,
        time: fields.time.value,
        persons: fields.persons.value,
        message: $("#f-message").value.trim(),
      };

      const btn = $("#f-submit");
      const label = $("span", btn);
      btn.disabled = true;
      label.textContent = t("booking.sending");

      try {
        const res = await fetch(API_RESERVATIONS, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            ...data,
            age: fields.age.checked,
            privacy: fields.privacy.checked,
            lang,
            botcheck: form.botcheck.checked,
            elapsed: Date.now() - formOpenedAt,
          }),
        });
        const json = await res.json().catch(() => ({}));

        if (res.status === 201 && json.ok) {
          finish(data);
        } else if (res.status === 422 && json.fields) {
          // Le serveur a refusé certains champs : on les signale comme le ferait le navigateur
          Object.entries(json.fields).forEach(([name, key]) => setFieldError(name, key));
          showAlert("err.summary");
          focusFirstInvalid();
        } else if (res.status === 409) {
          // Créneau complet (quelqu'un a réservé entre-temps) : on propose d'autres horaires
          slotAvailability[data.time] = json.remaining || 0;
          refreshTimeSlots();
          const alts = json.alternatives || [];
          showAlert(alts.length ? "booking.full" : "booking.fullNoAlt");
          showAlternatives(alts);
          loadAvailability();
        } else if (res.status === 429) {
          showAlert("booking.error.rateLimited");
        } else {
          throw new Error(json.error || res.status);
        }
      } catch (err) {
        console.error("[Le Goia] Échec de l'envoi :", err);
        showAlert("booking.error.generic");
      } finally {
        btn.disabled = false;
        label.textContent = t("booking.submit");
      }
    });

    function finish(data) {
      lastBooking = data;
      showSuccess(data);
      form.hidden = true;
      const box = $("#booking-success");
      box.hidden = false;
      box.focus({ preventScroll: true });
      box.scrollIntoView({ block: "center", behavior: "smooth" });
    }

    $("#success-again").addEventListener("click", () => {
      form.reset();
      slotAvailability = {};
      renderPersons();
      refreshTimeSlots();
      showAlert("");
      Object.keys(fields).forEach((name) => setFieldError(name, ""));
      $("#booking-success").hidden = true;
      form.hidden = false;
      fields.name.focus();
    });
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
  initBookingForm();
  initMap();
  initReveal();
  setLang(detectLang(), false);
  initAgeGate();
  loadMenu();
})();
