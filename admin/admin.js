/* ==========================================================================
   LE GOIA — Panneau admin : vue par jour
   --------------------------------------------------------------------------
   Réservations de la soirée triées par heure, personnes par créneau,
   annulation (email automatique au client), ajout manuel (téléphone),
   blocage d'une journée ou d'une plage, réglage de la capacité.
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
  const AUTO_REFRESH_MS = 60 * 1000;

  let date = "";        // soirée affichée
  let data = null;
  let loading = false;
  let reloadQueued = false;

  /* ---------- Utilitaires ---------- */

  /** « Ce soir » : avant 6 h du matin, c'est encore la soirée de la veille. */
  function tonight() {
    const now = RULES.nowInKehl();
    return now.minutes < 6 * 60 ? RULES.addDays(now.ymd, -1) : now.ymd;
  }

  const fmtDay = (ymd) => {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })
      .format(new Date(Date.UTC(y, m - 1, d)));
  };
  const fmtCreated = (iso) => new Intl.DateTimeFormat("fr-FR", {
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
    if (!res.ok) throw Object.assign(new Error(json.error || String(res.status)), { status: res.status, body: json });
    return json;
  }
  const postJson = (path, body) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  /* ---------- Vues ---------- */

  function showLogin(message) {
    $("#day-view").hidden = true;
    $("#bar-actions").hidden = true;
    $("#login-view").hidden = false;
    const err = $("#login-error");
    err.hidden = !message;
    err.textContent = message || "";
    setTimeout(() => $("#password").focus(), 30);
  }

  function showDay() {
    $("#login-view").hidden = true;
    $("#day-view").hidden = false;
    $("#bar-actions").hidden = false;
  }

  /* ---------- Chargement ---------- */

  async function load() {
    if (loading) { reloadQueued = true; return; }
    loading = true;
    $("#refresh").classList.add("is-spinning");
    try {
      data = await api(`/api/admin/reservations?date=${encodeURIComponent(date || tonight())}`);
      date = data.date;
      showDay();
      render();
    } catch (err) {
      if (!err.silent) {
        $("#list-status").textContent = "Impossible de charger la journée. Vérifiez la connexion puis réessayez.";
        console.error(err);
      }
    } finally {
      loading = false;
      $("#refresh").classList.remove("is-spinning");
      if (reloadQueued) { reloadQueued = false; load(); }
    }
  }

  function goTo(ymd) {
    date = ymd;
    data = null;
    $("#list").innerHTML = "";
    $("#list-status").textContent = "Chargement…";
    load();
  }

  /* ---------- Affichage ---------- */

  function render() {
    // En-tête du jour
    $("#day-title").textContent = fmtDay(date);
    const rel = date === data.tonight ? "Ce soir" : date === RULES.addDays(data.tonight, 1) ? "Demain"
      : date === RULES.addDays(data.tonight, -1) ? "Hier" : "";
    const hours = CONFIG.hours[RULES.weekdayOf(date)];
    $("#day-sub").textContent = [rel, data.open && hours ? `Ouvert ${hours.open} – ${hours.close}` : "Fermé (horaires habituels)"]
      .filter(Boolean).join(" · ");
    $("#day-picker").value = date;
    $("#capacity-label").textContent = String(data.capacity);

    // Indicateurs
    const kpis = [
      ["Réservations", String(data.totals.reservations), "actives"],
      ["Personnes", String(data.totals.persons), "attendues"],
      ["Pic", `${data.totals.peak}/${data.capacity}`, "présents en même temps"],
    ];
    const kbox = $("#kpis");
    kbox.className = "kpis kpis--3";
    kbox.innerHTML = "";
    kpis.forEach(([label, value, sub]) => {
      const k = el("div", "kpi");
      k.append(el("p", "kpi__label", label), el("p", "kpi__value", value), el("p", "kpi__sub", sub));
      kbox.appendChild(k);
    });

    renderBlocks();
    renderOccupancy();
    renderList();
  }

  function renderBlocks() {
    const box = $("#blocks");
    box.className = "blocks";
    box.innerHTML = "";
    data.blocks.forEach((b) => {
      const item = el("div", "block-item");
      const label = el("span");
      label.append(el("strong", null, b.heure_debut ? `Bloqué ${b.heure_debut} – ${b.heure_fin}` : "Journée bloquée"));
      if (b.motif) label.append(` · ${b.motif}`);
      const del = el("button", null, "Débloquer");
      del.type = "button";
      del.addEventListener("click", async () => {
        try {
          await api(`/api/admin/blocks?id=${encodeURIComponent(b.id)}`, { method: "DELETE" });
          toast("Blocage supprimé");
          load();
        } catch (err) { if (!err.silent) toast("Erreur, réessayez.", true); }
      });
      item.append(label, del);
      box.appendChild(item);
    });
  }

  function renderOccupancy() {
    const box = $("#occupancy-rows");
    box.innerHTML = "";
    $("#occupancy").hidden = !data.slots.length;
    data.slots.forEach((s) => {
      const row = el("div", "occ" + (s.blocked ? " is-blocked" : ""));
      const ratio = Math.min(s.present / data.capacity, 1);
      const bar = el("div", "occ__bar" + (ratio >= 1 ? " is-full" : ratio >= .8 ? " is-high" : ""));
      const fill = el("span");
      fill.style.width = `${Math.round(ratio * 100)}%`;
      bar.appendChild(fill);
      row.append(
        el("span", "occ__time", s.time),
        bar,
        el("span", "occ__present", `${s.present}/${data.capacity}`),
        el("span", "occ__arr", s.blocked ? "bloqué" : s.arriving ? `+${s.arriving} arr.` : "")
      );
      row.title = `${s.time} : ${s.present} personnes présentes, ${s.arriving} arrivées`;
      box.appendChild(row);
    });
  }

  function renderList() {
    const list = $("#list");
    list.innerHTML = "";
    $("#list-status").textContent = data.reservations.length ? "" : "Aucune réservation pour cette soirée.";
    data.reservations.forEach((r) => list.appendChild(card(r)));
  }

  function card(r) {
    const c = el("article", `resa resa--${r.statut}`);

    const top = el("div", "resa__top");
    top.appendChild(el("span", "resa__time", r.heure));
    const who = el("div", "resa__who");
    const ref = el("div", "resa__ref", r.reference);
    if (r.source === "telephone") ref.appendChild(el("span", "source-tag", "Téléphone"));
    who.appendChild(ref);
    who.appendChild(el("div", "resa__name", r.nom));
    who.appendChild(el("div", "resa__persons", `${r.personnes} personne${r.personnes > 1 ? "s" : ""} · ${String(r.langue).toUpperCase()}`));
    top.appendChild(who);
    top.appendChild(el("span", `pill pill--${r.statut}`, STATUS_LABEL[r.statut]));
    c.appendChild(top);

    const contact = el("div", "resa__contact");
    const tel = el("a", null, r.telephone);
    tel.href = `tel:${r.telephone.replace(/[^\d+]/g, "")}`;
    contact.appendChild(tel);
    if (r.email) {
      const mail = el("a", null, r.email);
      mail.href = `mailto:${r.email}`;
      contact.appendChild(mail);
    }
    c.appendChild(contact);

    if (r.message) c.appendChild(el("p", "resa__msg", r.message));
    const meta = `Réservée le ${fmtCreated(r.cree_le)}` +
      (r.statut === "annulee" && r.annule_par ? ` · annulée par ${r.annule_par === "client" ? "le client" : "le bar"}` : "");
    c.appendChild(el("p", "resa__meta", meta));

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
    if (["en_attente", "confirmee", "en_cours"].includes(r.statut)) {
      const cancel = el("button", "btn btn--danger btn--small", "Annuler");
      cancel.type = "button";
      cancel.addEventListener("click", () => setStatus(r, "annulee", select));
      actions.appendChild(cancel);
    }
    c.appendChild(actions);
    return c;
  }

  async function setStatus(r, statut, select) {
    if (statut === "annulee" && !window.confirm(
      `Annuler la réservation ${r.reference} de ${r.nom} (${r.heure}, ${r.personnes} pers.) ?` +
      (r.email ? "\nLe client sera prévenu par email." : "\n(Pas d'email : prévenez le client par téléphone.)"))) {
      select.value = r.statut;
      return;
    }
    select.disabled = true;
    try {
      const json = await postJson("/api/admin/status", { id: r.id, statut });
      const label = STATUS_LABEL[statut];
      if (json.emailSent === true) toast(`${label} — email envoyé à ${r.nom}`);
      else if (json.emailSent === false && !json.unchanged) toast(`${label}, mais l'email n'a pas pu partir. Prévenez le client par téléphone.`, true);
      else toast(`Statut : ${label}`);
      load();
    } catch (err) {
      if (!err.silent) toast("Erreur, la modification n'a pas été enregistrée. Réessayez.", true);
      select.value = r.statut;
      select.disabled = false;
    }
  }

  /* ---------- Fenêtres : ajout, blocage, capacité ---------- */

  $$("dialog [data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));
  const formError = (id, msg) => { const p = $(id); p.textContent = msg || ""; p.hidden = !msg; };
  const fillSelect = (select, values, selected) => {
    select.innerHTML = "";
    values.forEach((v) => { const o = el("option", null, v); o.value = v; select.appendChild(o); });
    if (selected && values.includes(selected)) select.value = selected;
  };

  // Ajout manuel
  $("#open-add").addEventListener("click", () => {
    const slots = RULES.daySlots(CONFIG, date);
    if (!slots.length) { toast("Le bar est fermé ce jour-là (horaires de config.js).", true); return; }
    $("#add-form").reset();
    fillSelect($("#add-time"), slots, slots.find((s) => s >= "20:00") || slots[0]);
    $("#add-day").textContent = fmtDay(date);
    formError("#add-error");
    $("#add-dialog").showModal();
    $("#add-name").focus();
  });

  async function submitAdd(force) {
    const body = {
      date,
      time: $("#add-time").value,
      persons: Number($("#add-persons").value),
      name: $("#add-name").value.trim(),
      phone: $("#add-phone").value.trim(),
      email: $("#add-email").value.trim(),
      message: $("#add-message").value.trim(),
      lang: $("#add-lang").value,
      sendEmail: $("#add-send").checked,
      force,
    };
    try {
      const json = await postJson("/api/admin/reservations", body);
      $("#add-dialog").close();
      toast(`Réservation ${json.reference} ajoutée` + (json.emailSent === true ? " — email envoyé" : json.emailSent === false ? " (email non envoyé)" : ""), json.emailSent === false);
      load();
    } catch (err) {
      if (err.silent) return;
      if (err.status === 409 && !force) {
        const why = err.body.error === "blocked" ? "Ce créneau est bloqué." : "Ce créneau est complet.";
        if (window.confirm(`${why}\nAjouter la réservation quand même ?`)) submitAdd(true);
        return;
      }
      if (err.status === 422) {
        const f = err.body.fields || {};
        const msgs = { name: "nom (2 caractères min.)", phone: "téléphone", email: "email", persons: "personnes (1 à 50)", time: "heure", date: "date" };
        formError("#add-error", "À corriger : " + Object.keys(f).map((k) => msgs[k] || k).join(", "));
        return;
      }
      formError("#add-error", "Erreur, réessayez.");
    }
  }
  $("#add-form").addEventListener("submit", (e) => { e.preventDefault(); submitAdd(false); });

  // Blocage
  function updateBlockRange() {
    const slots = RULES.daySlots(CONFIG, date);
    const range = RULES.dayRange(CONFIG, RULES.weekdayOf(date));
    const from = $("#block-from").value || slots[0];
    const ends = [...slots, range ? RULES.fromMinutes(range.close) : null].filter(Boolean)
      .filter((t) => RULES.eveningOrder(t) > RULES.eveningOrder(from));
    const prev = $("#block-to").value;
    fillSelect($("#block-to"), ends, prev || ends[ends.length - 1]);
  }
  $("#open-block").addEventListener("click", () => {
    $("#block-form").reset();
    const slots = RULES.daySlots(CONFIG, date);
    fillSelect($("#block-from"), slots, slots[0]);
    $("#block-to").innerHTML = "";
    updateBlockRange();
    $("#block-range").hidden = true;
    $$('input[name="block-type"][value="range"]')[0].disabled = !slots.length;
    $("#block-day").textContent = fmtDay(date);
    formError("#block-error");
    $("#block-dialog").showModal();
  });
  $$('input[name="block-type"]').forEach((r) => r.addEventListener("change", () => {
    $("#block-range").hidden = $('input[name="block-type"]:checked').value !== "range";
  }));
  $("#block-from").addEventListener("change", () => { $("#block-to").value = ""; updateBlockRange(); });
  $("#block-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const range = $('input[name="block-type"]:checked').value === "range";
    try {
      await postJson("/api/admin/blocks", {
        date,
        from: range ? $("#block-from").value : null,
        to: range ? $("#block-to").value : null,
        motif: $("#block-motif").value.trim(),
      });
      $("#block-dialog").close();
      toast(range ? "Plage bloquée" : "Journée bloquée");
      load();
    } catch (err) {
      if (!err.silent) formError("#block-error", err.message === "bad_range" ? "Plage horaire invalide." : "Erreur, réessayez.");
    }
  });

  // Capacité
  $("#open-settings").addEventListener("click", () => {
    $("#settings-capacity").value = data ? data.capacity : "";
    formError("#settings-error");
    $("#settings-dialog").showModal();
    $("#settings-capacity").select();
  });
  $("#settings-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const json = await postJson("/api/admin/settings", { capacity: Number($("#settings-capacity").value) });
      $("#settings-dialog").close();
      toast(`Capacité : ${json.capacity} personnes par créneau`);
      load();
    } catch (err) {
      if (!err.silent) formError("#settings-error", "Indiquez un nombre entre 1 et 500.");
    }
  });

  /* ---------- Navigation et connexion ---------- */

  $("#day-prev").addEventListener("click", () => goTo(RULES.addDays(date, -1)));
  $("#day-next").addEventListener("click", () => goTo(RULES.addDays(date, 1)));
  $("#day-today").addEventListener("click", () => goTo(tonight()));
  $("#day-picker").addEventListener("change", (e) => { if (e.target.value) goTo(e.target.value); });

  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#login-submit");
    btn.disabled = true;
    try {
      await postJson("/api/admin/login", { password: $("#password").value });
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
    $("#list").innerHTML = "";
    showLogin();
  });

  $("#refresh").addEventListener("click", load);

  // Actualisation automatique quand la page est visible
  setInterval(() => { if (!document.hidden && !$("#day-view").hidden && !$("dialog[open]")) load(); }, AUTO_REFRESH_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !$("#day-view").hidden) load(); });

  date = tonight();
  load();
})();
