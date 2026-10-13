/* ==========================================================================
   LE GOIA — Calendrier de réservation (fenêtre surgissante)
   --------------------------------------------------------------------------
   Équivalent sans framework du calendrier du site de location :
   un bouton ouvre un mois, les jours passés, fermés ou trop lointains
   sont grisés, un clic choisit la date.
   Clavier : flèches = jour/semaine, Page préc./suiv. = mois, Entrée = choisir,
   Échap = fermer.
   ========================================================================== */

(function (root) {
  "use strict";

  const RULES = root.GOIA_RULES;

  /**
   * options : anchor (bouton), getValue(), onSelect(ymd), isDisabled(ymd),
   * min, max ("AAAA-MM-JJ"), locale() ("fr-FR"), t(clé), footer() (texte)
   */
  function create(options) {
    const { anchor } = options;
    const pop = document.createElement("div");
    pop.className = "cal";
    pop.hidden = true;
    pop.setAttribute("role", "dialog");
    anchor.setAttribute("aria-haspopup", "dialog");
    anchor.setAttribute("aria-expanded", "false");
    anchor.insertAdjacentElement("afterend", pop);

    let month = null;   // "AAAA-MM" affiché
    let focusYmd = null;

    const monthOf = (ymd) => ymd.slice(0, 7);
    const addMonths = (ym, n) => {
      const [y, m] = ym.split("-").map(Number);
      const d = new Date(Date.UTC(y, m - 1 + n, 1));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    };
    const disabled = (ymd) => ymd < options.min || ymd > options.max || options.isDisabled(ymd);

    function render() {
      const fmt = (opts, ymd) => new Intl.DateTimeFormat(options.locale(), { timeZone: "UTC", ...opts })
        .format(new Date(`${ymd}T12:00:00Z`));
      const first = `${month}-01`;
      const title = fmt({ month: "long", year: "numeric" }, first);
      const startOffset = (RULES.weekdayOf(first) + 6) % 7; // lundi = 0
      const selected = options.getValue();
      const today = options.min;

      pop.innerHTML = "";
      pop.setAttribute("aria-label", title);

      const head = document.createElement("div");
      head.className = "cal__head";
      const mkNav = (dir, label, disabledNav) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "cal__nav";
        b.setAttribute("aria-label", label);
        b.innerHTML = dir < 0
          ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
          : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        b.disabled = disabledNav;
        b.addEventListener("click", () => { month = addMonths(month, dir); render(); });
        return b;
      };
      const h = document.createElement("p");
      h.className = "cal__title";
      h.textContent = title;
      head.append(
        mkNav(-1, options.t("cal.prev"), month <= monthOf(options.min)),
        h,
        mkNav(1, options.t("cal.next"), month >= monthOf(options.max))
      );
      pop.appendChild(head);

      const grid = document.createElement("div");
      grid.className = "cal__grid";
      grid.setAttribute("role", "grid");
      // Jours de la semaine (lundi → dimanche)
      for (let i = 0; i < 7; i++) {
        const wd = document.createElement("span");
        wd.className = "cal__wd";
        wd.textContent = fmt({ weekday: "narrow" }, RULES.addDays("2026-01-05", i));
        wd.setAttribute("aria-hidden", "true");
        grid.appendChild(wd);
      }
      for (let i = 0; i < startOffset; i++) grid.appendChild(document.createElement("span"));

      let ymd = first;
      while (ymd.startsWith(month)) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "cal__day";
        b.dataset.ymd = ymd;
        b.textContent = String(Number(ymd.slice(8)));
        b.setAttribute("aria-label", fmt({ weekday: "long", day: "numeric", month: "long" }, ymd));
        if (ymd === today) b.classList.add("is-today");
        if (ymd === selected) { b.classList.add("is-selected"); b.setAttribute("aria-pressed", "true"); }
        b.disabled = disabled(ymd);
        b.tabIndex = ymd === focusYmd ? 0 : -1;
        const value = ymd;
        b.addEventListener("click", () => { options.onSelect(value); close(true); });
        grid.appendChild(b);
        ymd = RULES.addDays(ymd, 1);
      }
      pop.appendChild(grid);

      const note = options.footer && options.footer();
      if (note) {
        const f = document.createElement("p");
        f.className = "cal__foot";
        f.textContent = note;
        pop.appendChild(f);
      }
    }

    function focusDay() {
      const b = pop.querySelector(`[data-ymd="${focusYmd}"]`);
      if (b) b.focus();
    }

    function moveFocus(days) {
      let next = RULES.addDays(focusYmd, days);
      if (next < options.min) next = options.min;
      if (next > options.max) next = options.max;
      focusYmd = next;
      if (monthOf(next) !== month) { month = monthOf(next); render(); }
      else pop.querySelectorAll(".cal__day").forEach((b) => { b.tabIndex = b.dataset.ymd === focusYmd ? 0 : -1; });
      focusDay();
    }

    pop.addEventListener("keydown", (e) => {
      const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, PageUp: -28, PageDown: 28 };
      if (e.key === "Escape") { e.preventDefault(); close(true); return; }
      if (moves[e.key] && e.target.classList.contains("cal__day")) { e.preventDefault(); moveFocus(moves[e.key]); }
    });

    function onOutside(e) {
      if (!pop.contains(e.target) && !anchor.contains(e.target)) close(false);
    }

    function open() {
      const value = options.getValue();
      focusYmd = value && !disabled(value) ? value : firstEnabled();
      month = monthOf(focusYmd);
      render();
      pop.hidden = false;
      anchor.setAttribute("aria-expanded", "true");
      document.addEventListener("pointerdown", onOutside, true);
      requestAnimationFrame(focusDay);
    }

    function close(returnFocus) {
      if (pop.hidden) return;
      pop.hidden = true;
      anchor.setAttribute("aria-expanded", "false");
      document.removeEventListener("pointerdown", onOutside, true);
      if (returnFocus) anchor.focus();
    }

    function firstEnabled() {
      let d = options.min;
      while (d <= options.max && disabled(d)) d = RULES.addDays(d, 1);
      return d <= options.max ? d : options.min;
    }

    anchor.addEventListener("click", () => (pop.hidden ? open() : close(false)));

    return { open, close, render: () => { if (!pop.hidden) render(); } };
  }

  root.GoiaCalendar = { create };
})(window);
