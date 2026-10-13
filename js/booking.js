/* ==========================================================================
   LE GOIA — Réservation en direct (section « Réserver » de l'accueil)
   --------------------------------------------------------------------------
   1. nombre de personnes → 2. jour (calendrier des 30 prochains jours)
   → 3. créneau (places restantes en temps réel) → 4. coordonnées → confirmé.
   Les disponibilités viennent de /api/disponibilites et sont rafraîchies
   automatiquement ; le serveur revérifie tout au moment de l'envoi.
   ========================================================================== */

(function () {
  "use strict";

  const CONFIG = window.GOIA_CONFIG;
  const RULES = window.GOIA_RULES;
  const L = window.GOIA_LANG;
  const t = L.t;
  const R = CONFIG.reservation;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const root = $("#book");
  if (!root) return;

  const REFRESH_MS = 30 * 1000;   // rafraîchissement des places quand la section est visible
  const state = {
    persons: 2,
    date: "",
    time: "",
    month: "",          // "AAAA-MM" affiché dans le calendrier
    days: {},           // { "2026-10-16": "available" | "full" | "closed" }
    slots: null,        // créneaux du jour choisi (null = pas encore chargés)
    fewSeats: R.fewSeatsThreshold,
    loadError: false,
    sending: false,
  };
  const formOpenedAt = Date.now(); // anti-robot : un humain met plus de 3 s
  let requestId = 0;
  let sectionVisible = false;

  /* ---------- Chargement des disponibilités ---------- */

  async function refresh() {
    const id = ++requestId;
    const params = new URLSearchParams({ personnes: String(state.persons) });
    if (state.date) params.set("date", state.date);
    try {
      const res = await fetch(`/api/disponibilites?${params}`, { cache: "no-store" });
      if (!res.ok) throw new Error(res.status);
      const json = await res.json();
      if (id !== requestId) return; // une réponse plus récente est attendue
      state.days = Object.fromEntries(json.days.map((d) => [d.date, d.status]));
      state.fewSeats = json.fewSeatsThreshold || state.fewSeats;
      state.slots = state.date ? json.slots : null;
      state.loadError = false;
      // Le créneau choisi n'est plus possible (pris entre-temps, ou trop proche)
      if (state.time && !(state.slots || []).some((s) => s.time === state.time && s.status === "available")) {
        state.time = "";
      }
    } catch (e) {
      if (id !== requestId) return;
      state.loadError = true;
    }
    render();
  }

  /* ---------- 1. Nombre de personnes ---------- */

  function renderPersons() {
    const box = $("#bk-persons");
    box.innerHTML = "";
    for (let n = 1; n <= R.maxPersons; n++) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pchip";
      b.textContent = String(n);
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(n === state.persons));
      b.setAttribute("aria-label", t("bk.personsAria", { n }));
      b.addEventListener("click", () => {
        if (state.persons === n) return;
        state.persons = n;
        state.time = "";
        render();
        refresh();
      });
      box.appendChild(b);
    }
    $("#bk-persons-more").textContent = t("bk.personsMore", { max: R.maxPersons });
  }

  /* ---------- 2. Calendrier des 30 prochains jours ---------- */

  function renderCalendar() {
    const now = RULES.nowInKehl();
    const min = now.ymd;
    const max = RULES.addDays(now.ymd, R.maxDaysAhead);
    if (!state.month) state.month = (state.date || min).slice(0, 7);
    const fmt = (opts, ymd) => new Intl.DateTimeFormat(L.locale(), { timeZone: "UTC", ...opts }).format(new Date(`${ymd}T12:00:00Z`));
    const addMonths = (ym, k) => {
      const [y, m] = ym.split("-").map(Number);
      const d = new Date(Date.UTC(y, m - 1 + k, 1));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    };

    const cal = $("#bk-cal");
    cal.innerHTML = "";
    const head = document.createElement("div");
    head.className = "bcal__head";
    const nav = (dir, label, disabled) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "bcal__nav";
      b.setAttribute("aria-label", label);
      b.disabled = disabled;
      b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${dir < 0 ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      b.addEventListener("click", () => { state.month = addMonths(state.month, dir); renderCalendar(); });
      return b;
    };
    const title = document.createElement("p");
    title.className = "bcal__title";
    title.textContent = fmt({ month: "long", year: "numeric" }, `${state.month}-01`);
    title.setAttribute("aria-live", "polite");
    head.append(nav(-1, t("cal.prev"), state.month <= min.slice(0, 7)), title, nav(1, t("cal.next"), state.month >= max.slice(0, 7)));
    cal.appendChild(head);

    const grid = document.createElement("div");
    grid.className = "bcal__grid";
    for (let i = 0; i < 7; i++) {
      const wd = document.createElement("span");
      wd.className = "bcal__wd";
      wd.setAttribute("aria-hidden", "true");
      wd.textContent = fmt({ weekday: "short" }, RULES.addDays("2026-01-05", i)).replace(".", "");
      grid.appendChild(wd);
    }
    const first = `${state.month}-01`;
    for (let i = 0; i < (RULES.weekdayOf(first) + 6) % 7; i++) grid.appendChild(document.createElement("span"));

    for (let ymd = first; ymd.startsWith(state.month); ymd = RULES.addDays(ymd, 1)) {
      const inRange = ymd >= min && ymd <= max;
      // Avant le premier chargement : on se fie aux horaires de config.js
      const status = !inRange ? "out" : state.days[ymd] || (RULES.dayRange(CONFIG, RULES.weekdayOf(ymd)) ? "available" : "closed");
      const b = document.createElement("button");
      b.type = "button";
      b.className = `bday bday--${status}`;
      if (ymd === state.date) b.classList.add("is-selected");
      if (ymd === min) b.classList.add("is-today");
      b.disabled = status !== "available";
      const num = document.createElement("span");
      num.className = "bday__num";
      num.textContent = String(Number(ymd.slice(8)));
      b.appendChild(num);
      if (status === "full") {
        const tag = document.createElement("span");
        tag.className = "bday__tag";
        tag.textContent = t("bk.dayFull");
        b.appendChild(tag);
      }
      const statusLabel = status === "full" ? t("bk.dayFull") : status === "closed" ? t("bk.legend.closed") : "";
      b.setAttribute("aria-label", fmt({ weekday: "long", day: "numeric", month: "long" }, ymd) + (statusLabel ? ` — ${statusLabel}` : ""));
      if (ymd === state.date) b.setAttribute("aria-pressed", "true");
      const value = ymd;
      b.addEventListener("click", () => selectDate(value));
      grid.appendChild(b);
    }
    cal.appendChild(grid);
  }

  function selectDate(ymd) {
    state.date = ymd;
    state.time = "";
    state.slots = null;
    showTaken(false);
    render();
    refresh();
    if (window.matchMedia("(max-width: 899px)").matches) {
      setTimeout(() => $("#step-slots").scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    }
  }

  /* ---------- 3. Créneaux du jour ---------- */

  function renderSlots() {
    const step = $("#step-slots");
    const box = $("#bk-slots");
    const info = $("#bk-slots-info");
    box.innerHTML = "";
    $("#bk-day-label").textContent = state.date ? L.formatDateLong(state.date) : "";
    step.classList.toggle("is-waiting", !state.date);

    if (!state.date) { info.textContent = t("bk.pickDate"); info.hidden = false; return; }
    if (state.loadError && !state.slots) { info.textContent = t("bk.loadError"); info.hidden = false; return; }
    if (!state.slots) { info.textContent = t("bk.loading"); info.hidden = false; return; }

    const available = state.slots.filter((s) => s.status === "available");
    info.hidden = available.length > 0;
    info.textContent = available.length ? "" : t("bk.noSlots", { n: state.persons });

    state.slots.forEach((s) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `slot slot--${s.status}`;
      b.disabled = s.status !== "available";
      if (s.time === state.time) { b.classList.add("is-selected"); b.setAttribute("aria-pressed", "true"); }
      const time = document.createElement("span");
      time.className = "slot__time";
      time.textContent = s.time;
      b.appendChild(time);
      let note = "";
      if (s.status === "available" && s.remaining <= state.fewSeats) {
        note = s.remaining === 1 ? t("bk.fewSeats1") : t("bk.fewSeats", { n: s.remaining });
      } else if (s.status === "full") note = t("bk.slotFull");
      else if (s.status === "past") note = t("bk.slotPast");
      else if (s.status === "blocked") note = t("bk.slotBlocked");
      if (note) {
        const n = document.createElement("span");
        n.className = "slot__note";
        n.textContent = note;
        b.appendChild(n);
      }
      b.setAttribute("aria-label", note ? `${s.time} — ${note}` : s.time);
      b.addEventListener("click", () => selectTime(s.time));
      box.appendChild(b);
    });
  }

  function selectTime(time) {
    state.time = time;
    showTaken(false);
    render();
    const form = $("#step-form");
    setTimeout(() => {
      form.scrollIntoView({ behavior: "smooth", block: window.matchMedia("(max-width: 899px)").matches ? "start" : "nearest" });
      $("#bk-name").focus({ preventScroll: true });
    }, 60);
  }

  /* ---------- 4. Coordonnées ---------- */

  const fields = {
    name: $("#bk-name"), phone: $("#bk-phone"), email: $("#bk-email"), age: $("#bk-age"), privacy: $("#bk-privacy"),
  };
  const validators = {
    name: (v) => (v.trim().length >= 2 ? "" : "err.name"),
    phone: (v) => (/^\+?\d{6,15}$/.test(v.replace(/[\s().\/-]/g, "")) ? "" : "err.phone"),
    email: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? "" : "err.email"),
    age: (_, el) => (el.checked ? "" : "err.age"),
    privacy: (_, el) => (el.checked ? "" : "err.privacy"),
  };

  function setFieldError(name, key) {
    const el = fields[name];
    if (!el) return;
    const msg = $(`#${el.id}-err`);
    el.closest(".field").classList.toggle("has-error", !!key);
    el.setAttribute("aria-invalid", String(!!key));
    if (key) el.setAttribute("aria-describedby", msg.id); else el.removeAttribute("aria-describedby");
    msg.dataset.key = key;
    msg.textContent = key ? t(key) : "";
  }
  function validateField(name) {
    const key = validators[name](fields[name].value, fields[name]);
    setFieldError(name, key);
    return !key;
  }
  Object.keys(fields).forEach((name) => {
    const el = fields[name];
    const isCheck = el.type === "checkbox";
    el.addEventListener(isCheck ? "change" : "blur", () => { if (isCheck || el.value) validateField(name); });
    el.addEventListener("input", () => { if (el.closest(".field").classList.contains("has-error")) validateField(name); });
  });

  function renderForm() {
    const form = $("#step-form");
    form.hidden = !state.time;
    if (!state.time) return;
    $("#bk-summary-text").textContent = t("bk.summary", {
      date: L.formatDateShort(state.date), time: state.time, n: state.persons,
    });
    $("#bk-submit-label").textContent = state.sending ? t("bk.sending") : t("bk.submit");
  }

  function showAlert(key) {
    const box = $("#bk-alert");
    box.dataset.key = key || "";
    box.textContent = key ? t(key) : "";
    box.hidden = !key;
  }

  /** Créneau pris entre-temps : message clair en haut des créneaux. */
  function showTaken(on) {
    const box = $("#bk-taken");
    box.hidden = !on;
    box.textContent = on ? t("bk.taken") : "";
  }

  $("#step-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (state.sending || !state.time) return;
    showAlert("");
    const ok = Object.keys(fields).map(validateField).every(Boolean);
    if (!ok) {
      showAlert("err.summary");
      const first = Object.values(fields).find((el) => el.getAttribute("aria-invalid") === "true");
      if (first) first.focus();
      return;
    }

    state.sending = true;
    $("#bk-submit").disabled = true;
    renderForm();
    const booking = { date: state.date, time: state.time, persons: state.persons };

    try {
      const res = await fetch("/api/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          ...booking,
          name: fields.name.value.trim(),
          phone: fields.phone.value.trim(),
          email: fields.email.value.trim(),
          message: $("#bk-message").value.trim(),
          age: fields.age.checked,
          privacy: fields.privacy.checked,
          lang: L.lang,
          botcheck: $("#step-form").botcheck.checked,
          elapsed: Date.now() - formOpenedAt,
        }),
      });
      const json = await res.json().catch(() => ({}));

      if (res.status === 201 && json.ok) {
        showDone(booking, json);
      } else if (res.status === 409) {
        // Quelqu'un a pris la place entre-temps : on rafraîchit et on le dit clairement
        state.time = "";
        showTaken(true);
        await refresh();
        $("#step-slots").scrollIntoView({ behavior: "smooth", block: "start" });
      } else if (res.status === 422 && json.fields) {
        Object.entries(json.fields).forEach(([k, v]) => setFieldError(k, v));
        showAlert("err.summary");
      } else if (res.status === 429) {
        showAlert("booking.error.rateLimited");
      } else {
        throw new Error(json.error || res.status);
      }
    } catch (err) {
      console.error("[Le Goia] Échec de la réservation :", err);
      showAlert("booking.error.generic");
    } finally {
      state.sending = false;
      $("#bk-submit").disabled = false;
      renderForm();
    }
  });

  $("#bk-change").addEventListener("click", () => {
    state.time = "";
    render();
    $("#step-slots").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  /* ---------- Confirmation à l'écran ---------- */

  let lastDone = null;
  function showDone(booking, json) {
    lastDone = { ...booking, name: fields.name.value.trim().split(/\s+/)[0], email: fields.email.value.trim(), reference: json.reference, token: json.token };
    renderDone();
    $("#book-flow").hidden = true;
    const done = $("#bk-done");
    done.hidden = false;
    done.focus({ preventScroll: true });
    done.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function renderDone() {
    if (!lastDone) return;
    const d = lastDone;
    $("#bk-done-title").textContent = t("bk.done.title", { name: d.name });
    $("#bk-done-text").textContent = t("bk.done.text", { date: L.formatDateLong(d.date), time: d.time, n: d.persons, email: d.email });
    $("#bk-done-ref").textContent = d.reference;
    $("#bk-done-manage").href = `/reservation/confirmation/?ref=${encodeURIComponent(d.reference)}&t=${encodeURIComponent(d.token)}&lang=${L.lang}`;
  }

  $("#bk-done-again").addEventListener("click", () => {
    $("#step-form").reset();
    Object.keys(fields).forEach((k) => setFieldError(k, ""));
    showAlert("");
    lastDone = null;
    state.date = "";
    state.time = "";
    state.slots = null;
    $("#bk-done").hidden = true;
    $("#book-flow").hidden = false;
    render();
    refresh();
    root.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  /* ---------- Affichage global ---------- */

  function render() {
    renderPersons();
    renderCalendar();
    renderSlots();
    renderForm();
    $("#bk-reload").hidden = !state.loadError;
  }

  $("#bk-reload").addEventListener("click", refresh);

  L.onChange(() => {
    render();
    renderDone();
    $$(".field__error", root).forEach((p) => { if (p.dataset.key) p.textContent = t(p.dataset.key); });
    const alert = $("#bk-alert");
    if (!alert.hidden && alert.dataset.key) alert.textContent = t(alert.dataset.key);
    if (!$("#bk-taken").hidden) showTaken(true);
  });

  // Temps réel : rafraîchit les places quand la section est visible
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries) => {
      const wasVisible = sectionVisible;
      sectionVisible = entries.some((e) => e.isIntersecting);
      if (sectionVisible && !wasVisible) refresh();
    }).observe(root);
  } else sectionVisible = true;
  setInterval(() => {
    if (sectionVisible && !document.hidden && !state.sending && $("#bk-done").hidden) refresh();
  }, REFRESH_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && sectionVisible) refresh(); });

  render();
  refresh();
})();
