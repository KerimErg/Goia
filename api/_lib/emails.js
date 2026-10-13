/* Emails automatiques envoyés avec Resend (https://resend.com).
   - au client : confirmation (avec référence et lien « Gérer ma réservation »),
     annulation par le bar, confirmation de son annulation — en FR ou en DE
   - au bar : nouvelle réservation, annulation par un client
   Variables d'environnement : RESEND_API_KEY, EMAIL_FROM, BAR_EMAIL.
   Un échec d'envoi n'empêche jamais l'enregistrement de la réservation. */

"use strict";

const CONFIG = require("../../js/config.js");

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function formatDate(ymd, lang) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "fr-FR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

const eur = (n, lang) => new Intl.NumberFormat(lang === "de" ? "de-DE" : "fr-FR", { style: "currency", currency: "EUR" }).format(n);
const hhmm = (t) => String(t).slice(0, 5);
const firstName = (nom) => String(nom).trim().split(/\s+/)[0];
const zoneName = (id, lang) => {
  const z = (CONFIG.zones || []).find((x) => x.id === id);
  return z ? z.name[lang] || z.name.fr : "";
};
const preorderText = (r, lang) => (r.precommande || [])
  .map((l) => `${l.quantite} × ${lang === "de" ? l.nom_de || l.nom : l.nom}`).join(", ");

/* ---------- Textes FR / DE ---------- */
const TEXT = {
  fr: {
    confirmee: {
      subject: (r) => `Le Goia — Réservation confirmée ${r.reference}`,
      title: (r) => `C'est réservé, ${firstName(r.nom)} !`,
      intro: () => "Votre table vous attend. Voici le récapitulatif de votre réservation.",
      note: () => `Pièce d'identité demandée à l'entrée : le Goia est réservé aux personnes majeures. Un empêchement ? Annulez en ligne jusqu'à ${CONFIG.reservation.cancelHoursBefore} h avant, ou appelez-nous.`,
      button: "Gérer ma réservation",
    },
    annulee: {
      subject: (r) => `Le Goia — Réservation ${r.reference} annulée`,
      title: () => "Réservation annulée",
      intro: (r) => `Bonjour ${firstName(r.nom)}, nous sommes désolés : nous avons dû annuler votre réservation.`,
      note: () => "N'hésitez pas à réserver un autre créneau sur notre site ou à nous appeler, nous ferons notre possible.",
    },
    annulee_client: {
      subject: (r) => `Le Goia — Annulation de la réservation ${r.reference}`,
      title: () => "Annulation confirmée",
      intro: (r) => `Bonjour ${firstName(r.nom)}, votre réservation a bien été annulée. À bientôt au Goia !`,
      note: () => "",
    },
    labels: { reference: "Référence", date: "Date", heure: "Heure", personnes: "Personnes", espace: "Espace", precommande: "Pré-commande", total: "Estimation (à régler sur place)" },
    footer: "Réservé aux personnes majeures (18+).",
  },
  de: {
    confirmee: {
      subject: (r) => `Le Goia — Reservierung bestätigt ${r.reference}`,
      title: (r) => `Reserviert, ${firstName(r.nom)}!`,
      intro: () => "Dein Tisch wartet auf dich. Hier ist die Zusammenfassung deiner Reservierung.",
      note: () => `Ausweiskontrolle am Eingang: Zutritt nur ab 18 Jahren. Du kannst nicht kommen? Storniere online bis ${CONFIG.reservation.cancelHoursBefore} Std. vorher oder ruf uns an.`,
      button: "Reservierung verwalten",
    },
    annulee: {
      subject: (r) => `Le Goia — Reservierung ${r.reference} storniert`,
      title: () => "Reservierung storniert",
      intro: (r) => `Hallo ${firstName(r.nom)}, es tut uns leid: Wir mussten deine Reservierung leider stornieren.`,
      note: () => "Reserviere gerne einen anderen Termin auf unserer Website oder ruf uns an – wir finden bestimmt eine Lösung.",
    },
    annulee_client: {
      subject: (r) => `Le Goia — Stornierung der Reservierung ${r.reference}`,
      title: () => "Stornierung bestätigt",
      intro: (r) => `Hallo ${firstName(r.nom)}, deine Reservierung wurde storniert. Bis bald im Goia!`,
      note: () => "",
    },
    labels: { reference: "Referenz", date: "Datum", heure: "Uhrzeit", personnes: "Personen", espace: "Bereich", precommande: "Vorbestellung", total: "Schätzung (vor Ort zu zahlen)" },
    footer: "Nur für Volljährige (18+).",
  },
};

/* ---------- Mise en page commune ---------- */
function layout({ title, intro, rows, note, footer, button }) {
  const ad = CONFIG.address;
  const rowsHtml = rows.map(([k, v]) =>
    `<tr><td style="padding:6px 12px 6px 0;color:#7a7368;vertical-align:top;width:130px">${esc(k)}</td><td style="padding:6px 0;font-weight:600;color:#1b1a1d">${esc(v)}</td></tr>`
  ).join("");
  const btn = button
    ? `<p style="margin:0 0 18px"><a href="${esc(button.url)}" style="display:inline-block;background:#c9a45c;color:#1a140a;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:999px">${esc(button.label)}</a></p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#f4f1ec;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ec;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="background:#0b0a0c;padding:22px 28px;font-family:Georgia,serif;font-size:26px;color:#eee7da">Le <i style="color:#c9a45c">Goia</i></td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 12px;font-family:Georgia,serif;font-weight:normal;font-size:24px;color:#1b1a1d">${esc(title)}</h1>
<p style="margin:0 0 18px;line-height:1.55;color:#3a3833">${esc(intro)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-top:1px solid #ece6db;border-bottom:1px solid #ece6db;margin:0 0 18px;font-size:15px">${rowsHtml}</table>
${btn}
${note ? `<p style="margin:0;line-height:1.55;color:#5b574f;font-size:14px">${esc(note)}</p>` : ""}
</td></tr>
<tr><td style="padding:18px 28px;background:#faf8f4;color:#8a8478;font-size:12px;line-height:1.6">
Le Goia · ${esc(ad.street)}, ${esc(ad.zip)} ${esc(ad.city)} · ${esc(CONFIG.phoneDisplay)}<br>${esc(footer)}
</td></tr></table></td></tr></table></body></html>`;
}

const toText = ({ title, intro, rows, note, button }) =>
  [title, "", intro, "", ...rows.map(([k, v]) => `${k} : ${v}`), "",
    button ? `${button.label} : ${button.url}` : "", note || "", "", `Le Goia · ${CONFIG.phoneDisplay}`].join("\n");

/* ---------- Envoi via l'API Resend ---------- */
async function sendEmail({ to, subject, parts, replyTo }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) {
    console.warn("[emails] RESEND_API_KEY ou EMAIL_FROM manquant : email non envoyé");
    return false;
  }
  try {
    const res = await fetch(process.env.RESEND_API_URL || "https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from, to: [to], subject,
        html: layout(parts), text: toText(parts),
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });
    if (!res.ok) {
      console.error("[emails] Resend a refusé l'envoi :", res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("[emails] Erreur d'envoi :", err.message);
    return false;
  }
}

function detailRows(r, lang) {
  const L = TEXT[lang].labels;
  const rows = [
    [L.reference, r.reference],
    [L.date, formatDate(r.date, lang)],
    [L.heure, hhmm(r.heure)],
    [L.personnes, String(r.personnes)],
  ];
  if (r.espace && zoneName(r.espace, lang)) rows.push([L.espace, zoneName(r.espace, lang)]);
  if ((r.precommande || []).length) {
    rows.push([L.precommande, preorderText(r, lang)]);
    rows.push([L.total, eur(Number(r.total_estime), lang)]);
  }
  return rows;
}

/**
 * Email au client.
 * kind : "confirmee" (avec manageUrl), "annulee" (par le bar) ou "annulee_client".
 */
function sendCustomerEmail(r, kind, manageUrl) {
  const lang = r.langue === "de" ? "de" : "fr";
  const T = TEXT[lang];
  const t = T[kind];
  return sendEmail({
    to: r.email,
    subject: t.subject(r),
    replyTo: process.env.BAR_EMAIL || CONFIG.email,
    parts: {
      title: t.title(r),
      intro: t.intro(r),
      rows: detailRows(r, lang),
      note: t.note(r),
      footer: T.footer,
      button: kind === "confirmee" && manageUrl ? { label: t.button, url: manageUrl } : null,
    },
  });
}

/** Notification au bar (toujours en français) : kind = "nouvelle" ou "annulation_client". */
function sendBarNotification(r, kind, adminUrl) {
  const to = process.env.BAR_EMAIL;
  if (!to) { console.warn("[emails] BAR_EMAIL manquant : notification non envoyée"); return Promise.resolve(false); }
  const cancel = kind === "annulation_client";
  return sendEmail({
    to,
    subject: `${cancel ? "Annulation client" : "Nouvelle réservation"} ${r.reference} : ${r.nom} — ${formatDate(r.date, "fr")} ${hhmm(r.heure)} (${r.personnes} pers.)`,
    replyTo: r.email,
    parts: {
      title: cancel ? "Un client a annulé sa réservation" : "Nouvelle réservation confirmée",
      intro: cancel
        ? "La place est de nouveau disponible pour ce créneau."
        : "La réservation est confirmée automatiquement (place disponible). Vous pouvez la modifier ou l'annuler dans le panneau admin.",
      rows: [
        ["Nom", r.nom], ["Téléphone", r.telephone], ["Email", r.email],
        ...detailRows(r, "fr"),
        ["Message", r.message || "—"], ["Langue", String(r.langue).toUpperCase()],
      ],
      note: "",
      footer: "Email automatique du site Le Goia.",
      button: { label: "Ouvrir le panneau admin", url: adminUrl },
    },
  });
}

module.exports = { sendCustomerEmail, sendBarNotification, formatDate };
