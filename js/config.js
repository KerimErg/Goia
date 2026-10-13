/* ==========================================================================
   LE GOIA — CONFIGURATION
   --------------------------------------------------------------------------
   Toutes les informations pratiques du bar sont ici, en un seul endroit.
   Modifiez les valeurs entre guillemets, enregistrez, c'est tout.
   Ce fichier est lu à la fois par le site ET par le serveur de réservation
   (créneaux, capacité) : il ne doit contenir AUCUN mot de passe ni clé secrète.
   Les secrets vont dans Vercel → Settings → Environment Variables (voir README).
   (Pensez aussi à mettre à jour le bloc "Schema.org" en bas de index.html
   et les pages impressum.html / datenschutz.html si l'adresse change.)
   ========================================================================== */

(function (root) {
const GOIA_CONFIG = {
  /* ---- Contact ---------------------------------------------------------- */
  phone: "+4978510000000",          // format international, sans espaces (lien tel:)
  phoneDisplay: "+49 7851 000 0000", // tel qu'affiché sur le site
  whatsapp: "4978510000000",        // format international SANS le "+" (lien wa.me)
  email: "kontakt@le-goia.de",

  /* ---- Adresse ---------------------------------------------------------- */
  address: {
    street: "Hauptstraße 1",        // [à compléter]
    zip: "77694",
    city: "Kehl",
    country: "Deutschland",
  },
  // Texte recherché dans Google Maps (adresse complète ou nom de l'établissement)
  mapsQuery: "Le Goia, Hauptstraße 1, 77694 Kehl",

  /* ---- Réseaux sociaux (laisser "" pour masquer une icône) -------------- */
  instagram: "https://www.instagram.com/legoia.kehl",
  tiktok: "https://www.tiktok.com/@legoia.kehl",

  /* ---- Horaires d'ouverture ---------------------------------------------
     0 = dimanche, 1 = lundi, … 6 = samedi.
     Format "HH:MM". Une fermeture après minuit s'écrit simplement "02:00".
     Jour de fermeture : null                                               */
  hours: {
    1: { open: "17:00", close: "01:00" }, // lundi
    2: { open: "17:00", close: "01:00" }, // mardi
    3: { open: "17:00", close: "01:00" }, // mercredi
    4: { open: "17:00", close: "01:00" }, // jeudi
    5: { open: "17:00", close: "03:00" }, // vendredi
    6: { open: "16:00", close: "03:00" }, // samedi
    0: { open: "16:00", close: "01:00" }, // dimanche
  },

  /* ---- Réservations ----------------------------------------------------- */
  reservation: {
    slotMinutes: 30,          // intervalle entre deux créneaux proposés
    lastSlotBeforeClose: 90,  // dernier créneau X minutes avant la fermeture
    maxDaysAhead: 60,         // réservation possible jusqu'à X jours à l'avance
    maxPersons: 12,           // maximum par réservation (au-delà : on invite à appeler)
    maxPersonsPerSlot: 20,    // CAPACITÉ : nombre total de personnes par créneau horaire
  },
};

// Rend la configuration disponible pour le navigateur et pour le serveur (Vercel)
if (typeof module !== "undefined" && module.exports) module.exports = GOIA_CONFIG;
else root.GOIA_CONFIG = GOIA_CONFIG;
})(typeof window !== "undefined" ? window : globalThis);
