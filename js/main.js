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
     7. (réservation : voir js/booking.js)
     8. WhatsApp, téléphone, réseaux (depuis js/config.js)
     9. Carte Google Maps (chargée après clic)
    10. Animations d'apparition
   Vous n'avez normalement pas besoin de modifier ce fichier :
   les contenus se règlent dans config.js, i18n.js et data/menu.json.
   ========================================================================== */

(function () {
  "use strict";

  const CONFIG = window.GOIA_CONFIG;
  const RULES = window.GOIA_RULES; // règles horaires partagées avec le serveur (js/rules.js)
  const L = window.GOIA_LANG;      // langue FR / DE partagée avec les autres pages (js/lang.js)
  const t = L.t;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  let menuData = null;
  let activeCategory = null;

  /* ======================================================================
     1. Utilitaires
     ====================================================================== */

  /** localStorage peut être bloqué (navigation privée) : on protège tout. */
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignoré */ } },
  };

  const locale = L.locale;
  const { nowInKehl } = RULES;
  const dayRange = (dayIndex) => RULES.dayRange(CONFIG, dayIndex);

  /* ======================================================================
     2. Langue FR / DE (textes dans js/i18n.js, logique dans js/lang.js)
     ====================================================================== */

  /** Met à jour ce qui est propre à cette page quand la langue change. */
  function onLangChange() {
    document.title = t("meta.title");
    const desc = $('meta[name="description"]');
    if (desc) desc.setAttribute("content", t("meta.description"));
    renderMenu();
    renderHours();
    updateWhatsAppLinks();
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

  const localized = (obj) => (obj == null ? "" : typeof obj === "string" ? obj : obj[L.lang] || obj.fr || "");

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
  L.init();
  L.onChange(onLangChange);
  initMap();
  initReveal();
  onLangChange();
  initAgeGate();
  loadMenu();
})();
