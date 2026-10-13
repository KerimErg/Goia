/* ==========================================================================
   LE GOIA — Panneau admin des réservations
   --------------------------------------------------------------------------
   Même organisation que l'admin du site de location : indicateurs, filtres
   par statut avec compteurs, recherche, menu de statut sur chaque réservation.
   Adapté au bar : regroupement par soirée avec compteur de personnes.
   Connexion par mot de passe (vérifié par le serveur, jamais stocké ici).
   ========================================================================== */

(function () {
  "use strict";

  const RULES = window.GOIA_RULES;
  const CONFIG = window.GOIA_CONFIG;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const STATUS_LABEL = {
    en_attente: "En attente", confirmee: "Confirmée", en_cours: "En cours", terminee: "Terminée", annulee: "Annulée",
  };
  const ACTIVE = ["en_attente", "confirmee", "en_cours"];
  const AUTO_REFRESH_MS = 2 * 60 * 1000;

  let range = "upcoming";      // "today" | "tomorrow" | "upcoming" | "date"
  let statusFilter = "";       // "" = toutes
  let search = "";
  let data = null;
  let loading = false;

  /* ---------- Utilitaires ---------- */

  /** « Ce soir » : avant 6 h du matin, c'est encore la soirée de la veille. */
  function tonight() {
    const now = RULES.nowInKehl();
    return now.minutes < 6 * 60 ? RULES.addDays(now.ymd, -1) : now.ymd;
  }

  function formatDay(ymd) {
    const [y, m, d] = ymd.split("-").map(Number);
    const label = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })
      .format(new Date(Date.UTC(y, m - 1, d)));
    if (ymd === tonight()) return `Ce soir · ${label}`;
    if (ymd === RULES.addDays(tonight(), 1)) return `Demain · ${label}`;
    return label;
  }

  const formatCreated = (iso) => new Intl.DateTimeFormat("fr-FR", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: RULES.TZ,
  }).format(new Date(iso));
  const eur = (n) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);
  const zoneName = (id) => { const z = (CONFIG.zones || []).find((x) => x.id === id); return z ? z.name.fr : ""; };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  let toastTimer;
  function toast(message, warn) {
    const box = $("#toast");
    box.textContent = message;
    box.classList.toggle("toast--warn", !!warn);
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { box.hidden = true; }, warn ? 6000 : 3500);
  }

  async function api(path, options) {
    const res = await fetch(path, { credentials: "same-origin", cache: "no-store", ...options });
    const json = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== "/api/admin/login") {
      showLogin();
      throw Object.assign(new Error("unauthorized"), { silent: true });
    }
    if (!res.ok) throw Object.assign(new Error(json.error || String(res.status)), { status: res.status });
    return json;
  }

  /* ---------- Vues ---------- */

  function showLogin(message) {
    $("#list-view").hidden = true;
    $("#bar-actions").hidden = true;
    $("#login-view").hidden = false;
    const err = $("#login-error");
    err.hidden = !message;
    err.textContent = message || "";
    setTimeout(() => $("#password").focus(), 30);
  }

  function showList() {
    $("#login-view").hidden = true;
    $("#list-view").hidden = false;
    $("#bar-actions").hidden = false;
  }

  /* ---------- Chargement ---------- */

  function query() {
    const p = new URLSearchParams();
    if (range === "today") { p.set("from", tonight()); p.set("to", tonight()); }
    if (range === "tomorrow") { const d = RULES.addDays(tonight(), 1); p.set("from", d); p.set("to", d); }
    if (range === "date" && $("#filter-date").value) { p.set("from", $("#filter-date").value); p.set("to", $("#filter-date").value); }
    if (statusFilter) p.set("statut", statusFilter);
    if (search) p.set("q", search);
    const s = p.toString();
    return s ? `?${s}` : "";
  }

  let reloadQueued = false;
  async function load() {
    // Un filtre changé pendant un chargement relance un chargement juste après
    if (loading) { reloadQueued = true; return; }
    loading = true;
    $("#refresh").classList.add("is-spinning");
    if (!data) $("#list-status").textContent = "Chargement…";
    try {
      data = await api(`/api/admin/reservations${query()}`);
      showList();
      render();
    } catch (err) {
      if (!err.silent) {
        $("#list-status").textContent = "Impossible de charger les réservations. Vérifiez la connexion puis réessayez.";
        console.error(err);
      }
    } finally {
      loading = false;
      $("#refresh").classList.remove("is-spinning");
      if (reloadQueued) { reloadQueued = false; load(); }
    }
  }

  /* ---------- Affichage ---------- */

  function renderKpis() {
    const s = data.stats;
    const kpis = [
      ["Ce soir", String(s.tonight.reservations), `${s.tonight.persons} personne${s.tonight.persons > 1 ? "s" : ""} attendue${s.tonight.persons > 1 ? "s" : ""}`],
      ["Remplissage ce soir", `${s.peakOccupancy} %`, `créneau le plus chargé · capacité ${data.capacity}`],
      ["7 prochains jours", String(s.week.reservations), `${s.week.persons} personnes`],
      ["Annulations (30 j)", String(s.cancelled30.total), `dont ${s.cancelled30.byClient} par les clients`],
    ];
    const box = $("#kpis");
    box.innerHTML = "";
    kpis.forEach(([label, value, sub]) => {
      const k = el("div", "kpi");
      k.append(el("p", "kpi__label", label), el("p", "kpi__value", value), el("p", "kpi__sub", sub));
      box.appendChild(k);
    });
    $("#updated-at").textContent = `Mis à jour à ${new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: RULES.TZ }).format(new Date())}`;
  }

  function renderStatusTabs() {
    const box = $("#status-tabs");
    box.innerHTML = "";
    [["", "Toutes", data.counts.all], ...Object.keys(STATUS_LABEL).map((s) => [s, STATUS_LABEL[s], data.counts[s]])]
      .forEach(([value, label, count]) => {
        const b = el("button", "status-tab", `${label} (${count})`);
        b.type = "button";
        b.setAttribute("aria-pressed", String(statusFilter === value));
        b.addEventListener("click", () => { statusFilter = value; load(); });
        box.appendChild(b);
      });
  }

  function render() {
    renderKpis();
    renderStatusTabs();
    const days = $("#days");
    days.innerHTML = "";
    const rows = data.reservations;
    $("#list-status").textContent = rows.length ? "" : "Aucune réservation pour ces critères.";

    // Regroupement par soirée (date de réservation)
    const byDay = new Map();
    rows.forEach((r) => {
      if (!byDay.has(r.date)) byDay.set(r.date, []);
      byDay.get(r.date).push(r);
    });

    byDay.forEach((list, date) => {
      const persons = (statuses) => list.filter((r) => statuses.includes(r.statut)).reduce((n, r) => n + r.personnes, 0);
      const expected = persons(ACTIVE);
      const section = el("section", "day");
      const head = el("div", "day__head");
      head.appendChild(el("h2", "day__title", formatDay(date)));
      const count = el("p", "day__count");
      count.append(el("strong", null, `${expected} pers.`), ` attendues · ${list.filter((r) => ACTIVE.includes(r.statut)).length} réservation(s)`);
      head.appendChild(count);
      section.appendChild(head);
      list.forEach((r) => section.appendChild(card(r)));
      days.appendChild(section);
    });
  }

  function card(r) {
    const c = el("article", `resa resa--${r.statut}`);

    const top = el("div", "resa__top");
    top.appendChild(el("span", "resa__time", r.heure));
    const who = el("div", "resa__who");
    who.appendChild(el("div", "resa__ref", r.reference));
    who.appendChild(el("div", "resa__name", r.nom));
    who.appendChild(el("div", "resa__persons", `${r.personnes} personne${r.personnes > 1 ? "s" : ""} · ${String(r.langue).toUpperCase()}`));
    top.appendChild(who);
    top.appendChild(el("span", `pill pill--${r.statut}`, STATUS_LABEL[r.statut]));
    c.appendChild(top);

    const contact = el("div", "resa__contact");
    const tel = el("a", null, r.telephone);
    tel.href = `tel:${r.telephone.replace(/[^\d+]/g, "")}`;
    const mail = el("a", null, r.email);
    mail.href = `mailto:${r.email}`;
    contact.append(tel, mail);
    c.appendChild(contact);

    const extras = el("div", "resa__extras");
    if (r.espace && zoneName(r.espace)) extras.append(lineOf("Espace", zoneName(r.espace)));
    if ((r.precommande || []).length) {
      extras.append(lineOf("Pré-commande", r.precommande.map((l) => `${l.quantite} × ${l.nom}`).join(", ") + ` · ${eur(Number(r.total_estime))}`));
    }
    if (extras.childElementCount) c.appendChild(extras);

    if (r.message) c.appendChild(el("p", "resa__msg", r.message));
    const meta = `Réservée le ${formatCreated(r.cree_le)}` +
      (r.statut === "annulee" && r.annule_par ? ` · annulée par ${r.annule_par === "client" ? "le client" : "le bar"}` : "");
    c.appendChild(el("p", "resa__meta", meta));

    // Menu de statut (comme sur le site de location)
    const actions = el("div", "resa__actions");
    const select = el("select", "status-select");
    select.setAttribute("aria-label", `Statut de ${r.reference}`);
    Object.entries(STATUS_LABEL).forEach(([value, label]) => {
      const o = el("option", null, label);
      o.value = value;
      select.appendChild(o);
    });
    select.value = r.statut;
    select.addEventListener("change", () => setStatus(r, select.value, select));
    actions.appendChild(select);
    c.appendChild(actions);
    return c;
  }

  function lineOf(label, value) {
    const p = el("p");
    p.append(el("span", null, `${label} : `), value);
    return p;
  }

  async function setStatus(r, statut, select) {
    if (statut === "annulee" &&
        !window.confirm(`Annuler la réservation ${r.reference} de ${r.nom} (${r.heure}, ${r.personnes} pers.) ?\nLe client sera prévenu par email.`)) {
      select.value = r.statut;
      return;
    }
    select.disabled = true;
    try {
      const json = await api("/api/admin/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: r.id, statut }),
      });
      Object.assign(r, json.reservation);
      const label = STATUS_LABEL[statut];
      if (json.emailSent === true) toast(`Statut : ${label} — email envoyé à ${r.nom}`);
      else if (json.emailSent === false && !json.unchanged) toast(`Statut : ${label}, mais l'email n'a pas pu partir. Prévenez le client par téléphone.`, true);
      else toast(`Statut : ${label}`);
      load(); // met à jour les compteurs et indicateurs
    } catch (err) {
      if (!err.silent) toast("Erreur, la modification n'a pas été enregistrée. Réessayez.", true);
      select.value = r.statut;
      select.disabled = false;
    }
  }

  /* ---------- Événements ---------- */

  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#login-submit");
    btn.disabled = true;
    try {
      await api("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: $("#password").value }),
      });
      $("#password").value = "";
      await load();
    } catch (err) {
      const messages = {
        wrong_password: "Mot de passe incorrect.",
        rate_limited: "Trop de tentatives. Réessayez dans 15 minutes.",
        not_configured: "ADMIN_PASSWORD n'est pas configuré dans Vercel.",
      };
      showLogin(messages[err.message] || "Connexion impossible. Réessayez.");
    } finally {
      btn.disabled = false;
    }
  });

  $("#logout").addEventListener("click", async () => {
    await fetch("/api/admin/login", { method: "DELETE", credentials: "same-origin" }).catch(() => {});
    data = null;
    $("#days").innerHTML = "";
    showLogin();
  });

  $("#refresh").addEventListener("click", load);

  function setRange(value) {
    range = value;
    $$(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.range === value)));
    $("#filter-date").classList.toggle("is-active", value === "date");
    if (value !== "date") $("#filter-date").value = "";
    load();
  }
  $$(".chip").forEach((c) => c.addEventListener("click", () => setRange(c.dataset.range)));
  $("#filter-date").addEventListener("change", () => setRange($("#filter-date").value ? "date" : "upcoming"));

  let searchTimer;
  $("#search").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { search = e.target.value.trim(); load(); }, 300);
  });

  // Actualisation automatique quand la page est visible
  setInterval(() => { if (!document.hidden && !$("#list-view").hidden) load(); }, AUTO_REFRESH_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !$("#list-view").hidden) load(); });

  load();
})();
