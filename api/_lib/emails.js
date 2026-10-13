/* Emails automatiques envoyés avec Resend (https://resend.com).
   - au client : réception de la demande, puis confirmation ou refus (FR ou DE)
   - au bar : notification à chaque nouvelle demande
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

const hhmm = (t) => String(t).slice(0, 5);
const firstName = (nom) => String(nom).trim().split(/\s+/)[0];

/* ---------- Textes FR / DE ---------- */
const TEXT = {
  fr: {
    received: {
      subject: "Le Goia — Demande de réservation reçue",
      title: "Demande bien reçue",
      intro: (r) => `Bonjour ${firstName(r.nom)}, merci pour votre demande ! Nous l'examinons et vous envoyons très vite un email de confirmation.`,
      note: "Votre table n'est pas encore confirmée.",
    },
    confirmee: {
      subject: "Le Goia — Votre réservation est confirmée ✔",
      title: "Réservation confirmée",
      intro: (r) => `Bonjour ${firstName(r.nom)}, bonne nouvelle : votre table est réservée. Nous avons hâte de vous accueillir !`,
      note: "Un empêchement ? Merci de nous prévenir par téléphone. L'accès est réservé aux personnes majeures (pièce d'identité possible à l'entrée).",
    },
    refusee: {
      subject: "Le Goia — Votre demande de réservation",
      title: "Réservation impossible",
      intro: (r) => `Bonjour ${firstName(r.nom)}, nous sommes désolés : nous ne pouvons malheureusement pas accepter votre demande pour ce créneau.`,
      note: "N'hésitez pas à choisir un autre horaire sur notre site ou à nous appeler, nous ferons notre possible.",
    },
    labels: { date: "Date", heure: "Heure", personnes: "Personnes", status: "Statut" },
    pending: "En attente de confirmation",
    footer: "Réservé aux personnes majeures (18+).",
  },
  de: {
    received: {
      subject: "Le Goia — Reservierungsanfrage erhalten",
      title: "Anfrage erhalten",
      intro: (r) => `Hallo ${firstName(r.nom)}, danke für deine Anfrage! Wir prüfen sie und schicken dir in Kürze eine Bestätigung per E-Mail.`,
      note: "Dein Tisch ist noch nicht bestätigt.",
    },
    confirmee: {
      subject: "Le Goia — Deine Reservierung ist bestätigt ✔",
      title: "Reservierung bestätigt",
      intro: (r) => `Hallo ${firstName(r.nom)}, gute Nachrichten: Dein Tisch ist reserviert. Wir freuen uns auf dich!`,
      note: "Du kannst nicht kommen? Bitte sag uns telefonisch Bescheid. Zutritt nur ab 18 Jahren (Ausweiskontrolle möglich).",
    },
    refusee: {
      subject: "Le Goia — Deine Reservierungsanfrage",
      title: "Reservierung leider nicht möglich",
      intro: (r) => `Hallo ${firstName(r.nom)}, es tut uns leid: Für diesen Zeitpunkt können wir deine Anfrage leider nicht annehmen.`,
      note: "Wähle gerne eine andere Uhrzeit auf unserer Website oder ruf uns an – wir finden bestimmt eine Lösung.",
    },
    labels: { date: "Datum", heure: "Uhrzeit", personnes: "Personen", status: "Status" },
    pending: "Wartet auf Bestätigung",
    footer: "Nur für Volljährige (18+).",
  },
};

/* ---------- Mise en page commune ---------- */
function layout({ title, intro, rows, note, footer }) {
  const ad = CONFIG.address;
  const rowsHtml = rows.map(([k, v]) =>
    `<tr><td style="padding:6px 0;color:#7a7368;width:120px">${esc(k)}</td><td style="padding:6px 0;font-weight:600;color:#1b1a1d">${esc(v)}</td></tr>`
  ).join("");
  return `<!doctype html><html><body style="margin:0;background:#f4f1ec;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ec;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="background:#0b0a0c;padding:22px 28px;font-family:Georgia,serif;font-size:26px;color:#eee7da">Le <i style="color:#c9a45c">Goia</i></td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 12px;font-family:Georgia,serif;font-weight:normal;font-size:24px;color:#1b1a1d">${esc(title)}</h1>
<p style="margin:0 0 18px;line-height:1.55;color:#3a3833">${esc(intro)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-top:1px solid #ece6db;border-bottom:1px solid #ece6db;margin:0 0 18px;font-size:15px">${rowsHtml}</table>
${note ? `<p style="margin:0;line-height:1.55;color:#5b574f;font-size:14px">${esc(note)}</p>` : ""}
</td></tr>
<tr><td style="padding:18px 28px;background:#faf8f4;color:#8a8478;font-size:12px;line-height:1.6">
Le Goia · ${esc(ad.street)}, ${esc(ad.zip)} ${esc(ad.city)} · ${esc(CONFIG.phoneDisplay)}<br>${esc(footer)}
</td></tr></table></td></tr></table></body></html>`;
}

const toText = ({ title, intro, rows, note }) =>
  [title, "", intro, "", ...rows.map(([k, v]) => `${k} : ${v}`), "", note || "", "", `Le Goia · ${CONFIG.phoneDisplay}`].join("\n");

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

function detailRows(r, lang, statusLabel) {
  const L = TEXT[lang].labels;
  const rows = [[L.date, formatDate(r.date, lang)], [L.heure, hhmm(r.heure)], [L.personnes, String(r.personnes)]];
  if (statusLabel) rows.push([L.status, statusLabel]);
  return rows;
}

/** Email au client : « demande reçue » (kind = "received") ou décision ("confirmee" / "refusee"). */
function sendCustomerEmail(r, kind) {
  const lang = r.langue === "de" ? "de" : "fr";
  const T = TEXT[lang];
  const t = T[kind];
  return sendEmail({
    to: r.email,
    subject: t.subject,
    replyTo: process.env.BAR_EMAIL || CONFIG.email,
    parts: {
      title: t.title,
      intro: t.intro(r),
      rows: detailRows(r, lang, kind === "received" ? T.pending : null),
      note: t.note,
      footer: T.footer,
    },
  });
}

/** Notification au bar à chaque nouvelle demande (toujours en français). */
function sendBarNotification(r, adminUrl) {
  const to = process.env.BAR_EMAIL;
  if (!to) { console.warn("[emails] BAR_EMAIL manquant : notification non envoyée"); return Promise.resolve(false); }
  return sendEmail({
    to,
    subject: `Nouvelle réservation : ${r.nom} — ${formatDate(r.date, "fr")} ${hhmm(r.heure)} (${r.personnes} pers.)`,
    replyTo: r.email,
    parts: {
      title: "Nouvelle demande de réservation",
      intro: `À confirmer ou refuser dans le panneau admin : ${adminUrl}`,
      rows: [
        ["Nom", r.nom], ["Téléphone", r.telephone], ["Email", r.email],
        ...detailRows(r, "fr"),
        ["Message", r.message || "—"], ["Langue", String(r.langue).toUpperCase()],
      ],
      note: "Le client a reçu un email l'informant que sa demande est en attente.",
      footer: "Email automatique du site Le Goia.",
    },
  });
}

module.exports = { sendCustomerEmail, sendBarNotification, formatDate };
