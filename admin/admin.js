/* ==========================================================================
   LE GOIA — Panneau admin des réservations
   --------------------------------------------------------------------------
   Connexion par mot de passe (vérifié par le serveur, jamais stocké ici),
   liste des réservations par soirée, boutons Confirmer / Refuser.
   ========================================================================== */

(function () {
  "use strict";

  const RULES = window.GOIA_RULES;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const STATUS_LABEL = { en_attente: "En attente", confirmee: "Confirmée", refusee: "Refusée" };
  const AUTO_REFRESH_MS = 2 * 60 * 1000;

  let range = "upcoming";      // "today" | "tomorrow" | "upcoming" | "date"
  let reservations = [];
  let loading = false;

  /* ---------- Utilitaires ---------- */

  /** "Ce soir" : avant 6 h du matin, c'est encore la soirée de la veille. */
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

  function queryForRange() {
    if (range === "today") return `?from=${tonight()}&to=${tonight()}`;
    if (range === "tomorrow") { const d = RULES.addDays(tonight(), 1); return `?from=${d}&to=${d}`; }
    if (range === "date" && $("#filter-date").value) {
      const d = $("#filter-date").value;
      return `?from=${d}&to=${d}`;
    }
    return "";
  }

  async function load() {
    if (loading) return;
    loading = true;
    $("#refresh").classList.add("is-spinning");
    if (!reservations.length) $("#list-status").textContent = "Chargement…";
    try {
      const json = await api(`/api/admin/reservations${queryForRange()}`);
      reservations = json.reservations;
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
    }
  }

  /* ---------- Affichage ---------- */

  function render() {
    const showRefused = $("#show-refused").checked;
    const visible = reservations.filter((r) => showRefused || r.statut !== "refusee");
    const days = $("#days");
    days.innerHTML = "";

    const pending = reservations.filter((r) => r.statut === "en_attente").length;
    const banner = $("#pending-banner");
    banner.hidden = !pending;
    banner.textContent = pending === 1 ? "1 demande en attente de réponse" : `${pending} demandes en attente de réponse`;

    $("#list-status").textContent = visible.length ? "" : "Aucune réservation pour cette période.";

    // Regroupement par soirée (date de réservation)
    const byDay = new Map();
    visible.forEach((r) => {
      if (!byDay.has(r.date)) byDay.set(r.date, []);
      byDay.get(r.date).push(r);
    });

    byDay.forEach((list, date) => {
      const all = reservations.filter((r) => r.date === date);
      const sum = (statut) => all.filter((r) => r.statut === statut).reduce((n, r) => n + r.personnes, 0);
      const confirmed = sum("confirmee");
      const waiting = sum("en_attente");

      const section = el("section", "day");
      const head = el("div", "day__head");
      head.appendChild(el("h2", "day__title", formatDay(date)));
      const count = el("p", "day__count");
      count.append(el("strong", null, `${confirmed + waiting} pers.`), ` · ${confirmed} confirmées · ${waiting} en attente`);
      head.appendChild(count);
      section.appendChild(head);
      list.forEach((r) => section.appendChild(card(r)));
      days.appendChild(section);
    });
  }

  function card(r) {
    const c = el("article", `resa resa--${r.statut}`);
    c.dataset.id = r.id;

    const top = el("div", "resa__top");
    top.appendChild(el("span", "resa__time", r.heure));
    const who = el("div", "resa__who");
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

    if (r.message) c.appendChild(el("p", "resa__msg", r.message));
    c.appendChild(el("p", "resa__meta", `Demande reçue le ${formatCreated(r.cree_le)}`));

    const actions = el("div", "resa__actions");
    if (r.statut !== "confirmee") {
      const ok = el("button", "btn btn--gold", "Confirmer");
      ok.type = "button";
      ok.addEventListener("click", () => setStatus(r, "confirmee", ok));
      actions.appendChild(ok);
    }
    if (r.statut !== "refusee") {
      const no = el("button", "btn btn--danger", r.statut === "confirmee" ? "Annuler / refuser" : "Refuser");
      no.type = "button";
      no.addEventListener("click", () => {
        if (window.confirm(`Refuser la réservation de ${r.nom} (${r.heure}, ${r.personnes} pers.) ?\nLe client sera prévenu par email.`)) {
          setStatus(r, "refusee", no);
        }
      });
      actions.appendChild(no);
    }
    c.appendChild(actions);
    return c;
  }

  async function setStatus(r, statut, button) {
    $$("button", button.parentElement).forEach((b) => { b.disabled = true; });
    try {
      const json = await api("/api/admin/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: r.id, statut }),
      });
      Object.assign(r, json.reservation);
      render();
      const verb = statut === "confirmee" ? "Confirmée" : "Refusée";
      if (json.unchanged) toast(`${verb} (déjà fait)`);
      else if (json.emailSent) toast(`${verb} — email envoyé à ${r.nom}`);
      else toast(`${verb}, mais l'email n'a pas pu partir. Prévenez le client par téléphone.`, true);
    } catch (err) {
      if (!err.silent) toast("Erreur, la modification n'a pas été enregistrée. Réessayez.", true);
      $$("button", button.parentElement).forEach((b) => { b.disabled = false; });
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
    reservations = [];
    $("#days").innerHTML = "";
    showLogin();
  });

  $("#refresh").addEventListener("click", load);
  $("#show-refused").addEventListener("change", render);

  function setRange(value) {
    range = value;
    $$(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.range === value)));
    $("#filter-date").classList.toggle("is-active", value === "date");
    if (value !== "date") $("#filter-date").value = "";
    reservations = [];
    load();
  }
  $$(".chip").forEach((c) => c.addEventListener("click", () => setRange(c.dataset.range)));
  $("#filter-date").addEventListener("change", () => setRange($("#filter-date").value ? "date" : "upcoming"));

  // Actualisation automatique quand la page est visible
  setInterval(() => { if (!document.hidden && !$("#list-view").hidden) load(); }, AUTO_REFRESH_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !$("#list-view").hidden) load(); });

  load();
})();
