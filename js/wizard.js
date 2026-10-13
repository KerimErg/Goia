/* ==========================================================================
   LE GOIA — Réservation en 4 étapes (/reservation/)
   --------------------------------------------------------------------------
   Reprend le parcours du site de location (étapes + récapitulatif fixe) :
     Location : Protection → Options    → Conducteur  → Paiement
     Goia     : Espace     → Chichas    → Coordonnées → Confirmation
   La date, l'horaire et le nombre de personnes viennent du panneau de la
   page d'accueil (?date=…&time=…&persons=…). Le serveur revérifie tout et
   la réservation est confirmée immédiatement s'il reste de la place.
   ========================================================================== */

(function () {
  "use strict";

  const CONFIG = window.GOIA_CONFIG;
  const RULES = window.GOIA_RULES;
  const L = window.GOIA_LANG;
  const t = L.t;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* ---------- Paramètres venant du panneau ---------- */
  const params = new URLSearchParams(location.search);
  const booking = {
    date: params.get("date") || "",
    time: params.get("time") || "",
    persons: Number.parseInt(params.get("persons"), 10),
    zone: "",
    preorder: {},        // { "Goia Gold": 1, … } (clé = nom FR dans menu.json)
  };

  // Lien invalide ou périmé → retour au panneau
  if (!RULES.slotsFor(CONFIG, booking.date).includes(booking.time) ||
      !(booking.persons >= 1 && booking.persons <= CONFIG.reservation.maxPersons)) {
    location.replace("/#reservation");
    return;
  }

  const formOpenedAt = Date.now(); // anti-robot : un humain met plus de 3 s
  let catalog = [];                // chichas proposées (groupes de menu.json)
  let availability = {};           // places restantes par créneau
  let steps = [];
  let step = 0;
  let sending = false;

  const zones = () => CONFIG.zones || [];
  const zoneAllowed = (z) => !z.minPersons || booking.persons >= z.minPersons;
  const localized = (o) => (o == null ? "" : typeof o === "string" ? o : o[L.lang] || o.fr || "");
  const preorderLines = () => {
    const lines = [];
    catalog.forEach((g) => g.items.forEach((it) => {
      const qty = booking.preorder[it.name.fr] || 0;
      if (qty) lines.push({ item: it, qty });
    }));
    return lines;
  };
  const preorderTotal = () => preorderLines().reduce((s, l) => s + l.item.price * l.qty, 0);
  const preorderCount = () => Object.values(booking.preorder).reduce((a, b) => a + b, 0);

  /* ======================================================================
     Étapes
     ====================================================================== */

  function buildSteps() {
    steps = [];
    if (zones().length) steps.push("zone");
    if (catalog.length) steps.push("preorder");
    steps.push("details", "review");
  }

  function renderStepper() {
    const ol = $("#steps");
    ol.innerHTML = "";
    steps.forEach((key, i) => {
      const li = document.createElement("li");
      li.className = "steps__item";
      const b = document.createElement("button");
      b.type = "button";
      b.className = "steps__btn" + (i === step ? " is-current" : i < step ? " is-done" : "");
      b.disabled = i > step;
      if (i === step) b.setAttribute("aria-current", "step");
      const n = document.createElement("span");
      n.className = "steps__num";
      n.innerHTML = i < step
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        : String(i + 1);
      b.append(n, document.createTextNode(t(`wiz.step.${key}`)));
      b.addEventListener("click", () => goTo(i));
      li.appendChild(b);
      ol.appendChild(li);
      if (i < steps.length - 1) {
        const sep = document.createElement("li");
        sep.className = "steps__sep";
        sep.setAttribute("aria-hidden", "true");
        ol.appendChild(sep);
      }
    });
  }

  function goTo(i, opts) {
    step = Math.max(0, Math.min(i, steps.length - 1));
    $$(".wiz__step").forEach((s) => {
      const on = s.dataset.step === steps[step];
      s.hidden = !on;
      if (on) { s.classList.remove("is-entering"); void s.offsetWidth; s.classList.add("is-entering"); }
    });
    renderStepper();
    renderCurrentStep();
    const last = step === steps.length - 1;
    $("#wiz-prev").disabled = step === 0;
    $("#wiz-next-label").textContent = last ? t("wiz.confirm") : t("wiz.next");
    $("#wiz-next").classList.toggle("is-final", last);
    if (!(opts && opts.noScroll)) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderCurrentStep() {
    const key = steps[step];
    if (key === "zone") renderZones();
    if (key === "preorder") renderPreorder();
    if (key === "review") renderReview();
    renderRecap();
  }

  /* ---------- Étape « Espace » (cartes comme les protections du site de location) ---------- */
  function renderZones() {
    const list = $("#zone-list");
    list.innerHTML = "";
    zones().forEach((z) => {
      const allowed = zoneAllowed(z);
      const b = document.createElement("button");
      b.type = "button";
      b.className = "opt-card" + (booking.zone === z.id ? " is-selected" : "");
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(booking.zone === z.id));
      b.disabled = !allowed;
      if (z.recommended) {
        const badge = document.createElement("span");
        badge.className = "opt-card__badge";
        badge.textContent = t("wiz.recommended");
        b.appendChild(badge);
      }
      const name = document.createElement("span");
      name.className = "opt-card__name";
      name.textContent = localized(z.name);
      const desc = document.createElement("span");
      desc.className = "opt-card__desc";
      desc.textContent = localized(z.desc);
      b.append(zoneIcon(z.id), name, desc);
      if (z.minPersons) {
        const min = document.createElement("span");
        min.className = "opt-card__meta";
        min.textContent = t("wiz.minPersons", { n: z.minPersons });
        b.appendChild(min);
      }
      b.addEventListener("click", () => { booking.zone = z.id; renderZones(); renderRecap(); });
      list.appendChild(b);
    });
  }

  function zoneIcon(id) {
    const paths = {
      indifferent: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>',
      lounge: '<path d="M4 11V9a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v2"/><path d="M3 12.5a1.5 1.5 0 0 1 3 0V15h12v-2.5a1.5 1.5 0 0 1 3 0V18H3z"/><path d="M5 18v2M19 18v2"/>',
      terrasse: '<path d="M12 3v2M12 19v2M4.2 7l1.4 1.4M18.4 15.6l1.4 1.4M3 12h2M19 12h2M4.2 17l1.4-1.4M18.4 8.4l1.4-1.4"/><circle cx="12" cy="12" r="4"/>',
      carre: '<path d="M12 3.5l7 3v5c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9v-5z"/><path d="M9 12l2 2 4-4"/>',
    };
    const span = document.createElement("span");
    span.className = "opt-card__icon";
    span.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths[id] || paths.lounge}</svg>`;
    return span;
  }

  /* ---------- Étape « Chichas » (quantités comme les options du site de location) ---------- */
  function renderPreorder() {
    const list = $("#pre-list");
    list.innerHTML = "";
    $("#pre-max").textContent = t("wiz.pre.max", { n: booking.persons });
    const priceFmt = new Intl.NumberFormat(L.locale(), { style: "currency", currency: "EUR" });
    const remaining = booking.persons - preorderCount();

    catalog.forEach((g) => {
      const h = document.createElement("h2");
      h.className = "pre-group";
      h.textContent = localized(g.name);
      list.appendChild(h);
      const grid = document.createElement("div");
      grid.className = "qty-grid";
      g.items.forEach((it) => {
        const key = it.name.fr;
        const n = booking.preorder[key] || 0;
        const max = Math.min(CONFIG.reservation.preorderMaxPerItem, n + remaining);
        const card = document.createElement("div");
        card.className = "qty-card" + (n ? " is-selected" : "");
        const info = document.createElement("div");
        info.className = "qty-card__info";
        const name = document.createElement("p");
        name.className = "qty-card__name";
        name.textContent = localized(it.name);
        if (it.tag) {
          const tag = document.createElement("span");
          tag.className = `menu__tag menu__tag--${it.tag}`;
          tag.textContent = t(`menu.tag.${it.tag}`);
          name.appendChild(tag);
        }
        info.appendChild(name);
        if (it.desc) {
          const d = document.createElement("p");
          d.className = "qty-card__desc";
          d.textContent = localized(it.desc);
          info.appendChild(d);
        }
        const price = document.createElement("p");
        price.className = "qty-card__price";
        price.textContent = priceFmt.format(it.price);
        info.appendChild(price);

        const ctrl = document.createElement("div");
        ctrl.className = "stepper stepper--card";
        const minus = document.createElement("button");
        minus.type = "button";
        minus.className = "stepper__btn";
        minus.textContent = "−";
        minus.disabled = n === 0;
        minus.setAttribute("aria-label", `${t("wiz.pre.remove")} : ${localized(it.name)}`);
        const count = document.createElement("span");
        count.className = "stepper__count";
        count.textContent = String(n);
        const plus = document.createElement("button");
        plus.type = "button";
        plus.className = "stepper__btn";
        plus.textContent = "+";
        plus.disabled = n >= max;
        plus.setAttribute("aria-label", `${t("wiz.pre.add")} : ${localized(it.name)}`);
        const setQty = (q) => {
          if (q > 0) booking.preorder[key] = q; else delete booking.preorder[key];
          $("#pre-error").textContent = "";
          renderPreorder();
          renderRecap();
        };
        minus.addEventListener("click", () => setQty(n - 1));
        plus.addEventListener("click", () => setQty(n + 1));
        ctrl.append(minus, count, plus);
        card.append(info, ctrl);
        grid.appendChild(card);
      });
      list.appendChild(grid);
    });
  }

  /* ---------- Étape « Coordonnées » ---------- */
  const fields = {
    name: $("#f-name"), phone: $("#f-phone"), email: $("#f-email"), age: $("#f-age"), privacy: $("#f-privacy"),
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
  const validateField = (name) => {
    const key = validators[name](fields[name].value, fields[name]);
    setFieldError(name, key);
    return !key;
  };
  function validateDetails() {
    const ok = Object.keys(fields).map(validateField).every(Boolean);
    if (!ok) {
      const first = Object.values(fields).find((el) => el.getAttribute("aria-invalid") === "true");
      if (first) first.focus();
    }
    return ok;
  }

  Object.keys(fields).forEach((name) => {
    const el = fields[name];
    const isCheck = el.type === "checkbox";
    el.addEventListener(isCheck ? "change" : "blur", () => { if (isCheck || el.value) validateField(name); });
    el.addEventListener("input", () => { if (el.closest(".field").classList.contains("has-error")) validateField(name); });
  });
  $("#details-form").addEventListener("submit", (e) => { e.preventDefault(); next(); });

  /* ---------- Étape « Confirmation » (remplace le paiement du site de location) ---------- */
  function renderReview() {
    const box = $("#review");
    box.innerHTML = "";
    const block = (title, lines, editStep) => {
      const sec = document.createElement("div");
      sec.className = "review__block";
      const head = document.createElement("div");
      head.className = "review__head";
      const h = document.createElement("h2");
      h.textContent = title;
      head.appendChild(h);
      if (editStep !== undefined) {
        const edit = document.createElement(typeof editStep === "string" ? "a" : "button");
        edit.className = "review__edit";
        edit.textContent = t("wiz.rev.edit");
        if (typeof editStep === "string") edit.href = editStep;
        else { edit.type = "button"; edit.addEventListener("click", () => goTo(editStep)); }
        head.appendChild(edit);
      }
      sec.appendChild(head);
      lines.filter(Boolean).forEach((l) => sec.appendChild(Object.assign(document.createElement("p"), { textContent: l })));
      box.appendChild(sec);
    };
    const zone = zones().find((z) => z.id === booking.zone);
    block(t("recap.title"), [
      t("recap.at", { date: L.formatDateLong(booking.date), time: booking.time }),
      t("recap.persons", { n: booking.persons }),
      zone ? `${t("recap.zone")} : ${localized(zone.name)}` : "",
    ], backHref());
    if (steps.includes("preorder")) {
      const lines = preorderLines();
      block(t("recap.preorder"), lines.length
        ? [...lines.map((l) => `${l.qty} × ${localized(l.item.name)}`), `${t("recap.total")} : ${L.eur(preorderTotal())} · ${t("recap.payOnSite")}`]
        : [t("recap.none")], steps.indexOf("preorder"));
    }
    block(t("wiz.rev.contact"), [
      fields.name.value.trim(), fields.phone.value.trim(), fields.email.value.trim(), $("#f-message").value.trim(),
    ], steps.indexOf("details"));
  }

  /* ---------- Récapitulatif (colonne de droite, comme sur le site de location) ---------- */
  function renderRecap() {
    const r = $("#recap");
    const ad = CONFIG.address;
    const zone = zones().find((z) => z.id === booking.zone);
    const lines = preorderLines();
    r.innerHTML = `
      <div class="recap__visual" aria-hidden="true"><span class="recap__smoke"></span><span class="recap__brand">Le <em>Goia</em></span></div>
      <div class="recap__body">
        <p class="recap__eyebrow"></p>
        <p class="recap__title"></p>
        <div class="recap__rows">
          <div><p class="recap__label"></p><p class="recap__value recap__when"></p><p class="recap__sub recap__persons"></p></div>
          <div><p class="recap__label recap__label--where"></p><p class="recap__value">Le Goia</p><p class="recap__sub recap__addr"></p></div>
        </div>
        <dl class="recap__lines"></dl>
        <div class="recap__total"><p class="recap__total-label"></p><p class="recap__total-value"></p></div>
      </div>`;
    $(".recap__eyebrow", r).textContent = t("hero.eyebrow");
    $(".recap__title", r).textContent = t("recap.title");
    $(".recap__label", r).textContent = t("recap.when");
    $(".recap__when", r).textContent = t("recap.at", { date: L.formatDateShort(booking.date), time: booking.time });
    $(".recap__persons", r).textContent = t("recap.persons", { n: booking.persons });
    $(".recap__label--where", r).textContent = t("recap.where");
    $(".recap__addr", r).textContent = `${ad.street}, ${ad.zip} ${ad.city}`;

    const dl = $(".recap__lines", r);
    const row = (k, v, cls) => {
      const d = document.createElement("div");
      if (cls) d.className = cls;
      d.append(Object.assign(document.createElement("dt"), { textContent: k }), Object.assign(document.createElement("dd"), { textContent: v }));
      dl.appendChild(d);
    };
    if (zones().length) row(t("recap.zone"), zone ? localized(zone.name) : "—");
    if (steps.includes("preorder")) {
      if (!lines.length) row(t("recap.preorder"), t("recap.none"));
      lines.forEach((l) => row(`${localized(l.item.name)}${l.qty > 1 ? ` ×${l.qty}` : ""}`, L.eur(l.item.price * l.qty)));
    }
    const total = $(".recap__total", r);
    if (lines.length) {
      $(".recap__total-label", r).innerHTML = "";
      $(".recap__total-label", r).append(t("recap.total"), Object.assign(document.createElement("small"), { textContent: t("recap.payOnSite") }));
      $(".recap__total-value", r).textContent = L.eur(preorderTotal());
    } else total.hidden = true;
  }

  /* ======================================================================
     Navigation et envoi
     ====================================================================== */

  function next() {
    const key = steps[step];
    if (key === "zone" && !booking.zone) { toast(t("err.zone"), "error"); return; }
    if (key === "details" && !validateDetails()) return;
    if (step < steps.length - 1) { goTo(step + 1); return; }
    submit();
  }

  $("#wiz-next").addEventListener("click", next);
  $("#wiz-prev").addEventListener("click", () => goTo(step - 1));

  async function submit() {
    if (sending) return;
    if (!validateDetails()) { goTo(steps.indexOf("details")); return; }
    sending = true;
    const btn = $("#wiz-next");
    btn.disabled = true;
    $("#wiz-next-label").textContent = t("wiz.sending");

    try {
      const res = await fetch("/api/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          name: fields.name.value.trim(),
          phone: fields.phone.value.trim(),
          email: fields.email.value.trim(),
          message: $("#f-message").value.trim(),
          date: booking.date,
          time: booking.time,
          persons: booking.persons,
          zone: booking.zone,
          preorder: Object.entries(booking.preorder).map(([name, qty]) => ({ name, qty })),
          age: fields.age.checked,
          privacy: fields.privacy.checked,
          lang: L.lang,
          botcheck: $("#details-form").botcheck.checked,
          elapsed: Date.now() - formOpenedAt,
        }),
      });
      const json = await res.json().catch(() => ({}));

      if (res.status === 201 && json.ok) {
        // Comme sur le site de location : direction la page de confirmation
        location.href = `/reservation/confirmation/?ref=${encodeURIComponent(json.reference)}&t=${encodeURIComponent(json.token)}&lang=${L.lang}`;
        return;
      }
      if (res.status === 422 && json.fields) {
        const f = json.fields;
        if (f.zone && steps.includes("zone")) { booking.zone = ""; goTo(steps.indexOf("zone")); toast(t(f.zone), "error"); }
        else if (f.preorder && steps.includes("preorder")) { goTo(steps.indexOf("preorder")); $("#pre-error").textContent = t(f.preorder); toast(t(f.preorder), "error"); }
        else if (f.date || f.time || f.persons) { location.href = backHref(); return; }
        else { goTo(steps.indexOf("details")); Object.entries(f).forEach(([k, v]) => setFieldError(k, v)); toast(t("wiz.fix"), "error"); }
      } else if (res.status === 409) {
        availability[booking.time] = json.remaining || 0;
        showFullBanner(json.alternatives || []);
        toast(t("toast.full"), "error");
      } else if (res.status === 429) {
        toast(t("booking.error.rateLimited"), "error");
      } else {
        throw new Error(json.error || res.status);
      }
    } catch (err) {
      console.error("[Le Goia] Échec de la réservation :", err);
      toast(t("booking.error.generic"), "error");
    } finally {
      sending = false;
      btn.disabled = false;
      if (step === steps.length - 1) $("#wiz-next-label").textContent = t("wiz.confirm");
    }
  }

  /* ---------- Créneau complet : proposer d'autres horaires ---------- */
  function showFullBanner(alts) {
    const banner = $("#wiz-banner");
    banner.hidden = false;
    banner.dataset.alts = JSON.stringify(alts);
    $("#wiz-banner-text").textContent = alts.length ? t("booking.full") : t("booking.fullNoAlt");
    const box = $("#wiz-alternatives");
    box.innerHTML = "";
    alts.forEach((time) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "slot-chip";
      b.textContent = time;
      b.addEventListener("click", () => {
        booking.time = time;
        params.set("time", time);
        history.replaceState(null, "", `?${params}`);
        banner.hidden = true;
        updateBackLink();
        renderCurrentStep();
      });
      box.appendChild(b);
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function checkAvailability() {
    try {
      const res = await fetch(`/api/availability?date=${encodeURIComponent(booking.date)}`, { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      json.slots.forEach((s) => { availability[s.time] = s.remaining; });
      if ((availability[booking.time] ?? Infinity) < booking.persons) {
        const target = RULES.eveningOrder(booking.time);
        const alts = json.slots.filter((s) => s.remaining >= booking.persons && s.time !== booking.time)
          .sort((a, b) => Math.abs(RULES.eveningOrder(a.time) - target) - Math.abs(RULES.eveningOrder(b.time) - target))
          .slice(0, 4).map((s) => s.time).sort((a, b) => RULES.eveningOrder(a) - RULES.eveningOrder(b));
        showFullBanner(alts);
      }
    } catch (e) { /* le serveur revérifiera à l'envoi */ }
  }

  /* ---------- Notifications (comme les « toasts » du site de location) ---------- */
  function toast(message, type) {
    const box = document.createElement("div");
    box.className = `toast-msg${type === "error" ? " toast-msg--error" : ""}`;
    box.setAttribute("role", type === "error" ? "alert" : "status");
    box.textContent = message;
    $("#toasts").appendChild(box);
    setTimeout(() => { box.classList.add("is-leaving"); setTimeout(() => box.remove(), 300); }, 4200);
  }

  /* ---------- Lien « Modifier la date et l'heure » ---------- */
  const backHref = () => `/?${new URLSearchParams({ date: booking.date, time: booking.time, persons: String(booking.persons), lang: L.lang })}#reservation`;
  const updateBackLink = () => { $("#wiz-back").href = backHref(); };

  /* ---------- Démarrage ---------- */
  async function loadCatalog() {
    try {
      const res = await fetch("/data/menu.json", { cache: "no-cache" });
      const menu = await res.json();
      const cat = menu.categories.find((c) => c.id === "chichas");
      catalog = cat ? cat.groups.map((g) => ({ name: g.name, items: g.items.filter((it) => typeof it.price === "number") })) : [];
    } catch (e) {
      catalog = []; // sans menu, l'étape « Chichas » est simplement sautée
    }
  }

  L.init();
  L.onChange(() => {
    renderStepper();
    renderCurrentStep();
    $("#wiz-next-label").textContent = step === steps.length - 1 ? t("wiz.confirm") : t("wiz.next");
    $$(".field__error").forEach((p) => { if (p.dataset.key) p.textContent = t(p.dataset.key); });
    const banner = $("#wiz-banner");
    if (!banner.hidden) showFullBanner(JSON.parse(banner.dataset.alts || "[]"));
    updateBackLink();
  });

  (async () => {
    const recommended = zones().find((z) => z.recommended && zoneAllowed(z));
    if (recommended) booking.zone = recommended.id;
    await loadCatalog();
    buildSteps();
    updateBackLink();
    goTo(0, { noScroll: true });
    checkAvailability();
  })();
})();
