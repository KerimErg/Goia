/* ==========================================================================
   LE GOIA — Page de confirmation / « Gérer ma réservation »
   --------------------------------------------------------------------------
   Comme la page « C'est réservé ! » du site de location : référence,
   récapitulatif, informations pratiques. Sans compte client : l'accès se fait
   par le lien secret (?ref=…&t=…) reçu par email, qui permet aussi d'annuler
   gratuitement jusqu'à X heures avant.
   ========================================================================== */

(function () {
  "use strict";

  const CONFIG = window.GOIA_CONFIG;
  const L = window.GOIA_LANG;
  const t = L.t;
  const $ = (sel) => document.querySelector(sel);

  const params = new URLSearchParams(location.search);
  const ref = params.get("ref") || "";
  const token = params.get("t") || "";
  let reservation = null;

  const localized = (o) => (o == null ? "" : typeof o === "string" ? o : o[L.lang] || o.fr || "");

  function toast(message, type) {
    const box = document.createElement("div");
    box.className = `toast-msg${type === "error" ? " toast-msg--error" : ""}`;
    box.setAttribute("role", type === "error" ? "alert" : "status");
    box.textContent = message;
    $("#toasts").appendChild(box);
    setTimeout(() => { box.classList.add("is-leaving"); setTimeout(() => box.remove(), 300); }, 4200);
  }

  function render() {
    const r = reservation;
    if (!r) return;
    const cancelled = r.status === "annulee";
    const ad = CONFIG.address;

    document.title = `${r.reference} — Le Goia`;
    $("#conf-check").classList.toggle("is-cancelled", cancelled);
    $("#conf-check").innerHTML = cancelled
      ? '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    $("#conf-title").textContent = cancelled ? t("conf.cancelledTitle") : t("conf.title", { name: r.firstName });
    $("#conf-lead").textContent = cancelled
      ? t(r.cancelledBy === "client" ? "conf.cancelledClient" : "conf.cancelledBar")
      : t("conf.email", { email: r.email });
    $("#conf-ref").textContent = r.reference;

    $("#conf-when").textContent = L.formatDateLong(r.date);
    const status = $("#conf-status");
    status.className = `pill pill--${r.status}`;
    status.textContent = t(`status.${r.status}`);
    $("#conf-time").textContent = t("recap.at", { date: L.formatDateShort(r.date), time: r.time });
    $("#conf-persons").textContent = t("recap.persons", { n: r.persons });
    $("#conf-address").textContent = `${ad.street}, ${ad.zip} ${ad.city}`;
    $("#conf-phone").textContent = CONFIG.phoneDisplay;
    $("#conf-phone").href = `tel:${CONFIG.phone}`;

    // Espace + pré-commande
    const extra = $("#conf-extra");
    extra.innerHTML = "";
    const zone = (CONFIG.zones || []).find((z) => z.id === r.zone);
    const line = (label, value) => {
      const p = document.createElement("p");
      p.append(Object.assign(document.createElement("span"), { className: "conf-card__muted", textContent: `${label} : ` }), value);
      extra.appendChild(p);
    };
    if (zone) line(t("recap.zone"), localized(zone.name));
    if (r.preorder.length) {
      line(t("recap.preorder"), r.preorder.map((l) => `${l.quantite} × ${L.lang === "de" ? l.nom_de || l.nom : l.nom}`).join(", "));
      line(t("recap.total"), `${L.eur(r.total)} · ${t("recap.payOnSite")}`);
    }
    extra.hidden = !extra.childElementCount;

    // Annulation
    $("#conf-cancel").hidden = !r.cancellable;
    $("#conf-note").textContent = cancelled ? ""
      : r.cancellable ? t("conf.cancelUntil", { h: r.cancelHoursBefore })
      : ["en_attente", "confirmee"].includes(r.status) ? t("conf.tooLate", { h: r.cancelHoursBefore }) : "";
    const home = $("#conf-home");
    home.textContent = cancelled ? t("conf.newBooking") : t("conf.home");
    home.href = cancelled ? `/?lang=${L.lang}#reservation` : `/?lang=${L.lang}`;
    $("#dlg-title").textContent = t("dlg.title", { ref: r.reference });
  }

  async function load() {
    try {
      if (!ref || !token) throw Object.assign(new Error("missing"), { status: 404 });
      const res = await fetch(`/api/manage?ref=${encodeURIComponent(ref)}&t=${encodeURIComponent(token)}`, { cache: "no-store" });
      if (!res.ok) throw Object.assign(new Error("http"), { status: res.status });
      reservation = (await res.json()).reservation;
      $("#conf-loading").hidden = true;
      $("#conf-content").hidden = false;
      render();
    } catch (err) {
      $("#conf-loading").hidden = true;
      const box = $("#conf-error");
      box.hidden = false;
      box.dataset.key = err.status === 404 ? "conf.notFound" : "booking.error.generic";
      box.textContent = t(box.dataset.key);
    }
  }

  /* ---------- Annulation ---------- */
  const dialog = $("#cancel-dialog");
  $("#conf-cancel").addEventListener("click", () => dialog.showModal());
  $("#dlg-keep").addEventListener("click", () => dialog.close());
  $("#dlg-confirm").addEventListener("click", async () => {
    const btn = $("#dlg-confirm");
    btn.disabled = true;
    btn.textContent = t("dlg.cancelling");
    try {
      const res = await fetch("/api/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref, t: token, action: "cancel" }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        reservation = json.reservation;
        toast(t("toast.cancelled"));
      } else if (res.status === 409) {
        if (json.reservation) reservation = json.reservation;
        toast(t("toast.tooLate"), "error");
      } else throw new Error(json.error || res.status);
      render();
      dialog.close();
    } catch (err) {
      console.error("[Le Goia] Annulation impossible :", err);
      toast(t("booking.error.generic"), "error");
    } finally {
      btn.disabled = false;
      btn.textContent = t("dlg.confirm");
    }
  });

  L.init();
  L.onChange(() => {
    render();
    const box = $("#conf-error");
    if (!box.hidden && box.dataset.key) box.textContent = t(box.dataset.key);
  });
  load();
})();
