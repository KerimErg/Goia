# Le Goia — Site + réservations en ligne

Site du bar à chicha **Le Goia** à Kehl, en français et en allemand : menu, réservation en ligne, infos pratiques, pages Impressum et Datenschutz, et un **panneau admin** pour gérer les réservations depuis le téléphone.

**Comment ça marche :**

```
Client ──► section « Réserver » de l'accueil
              1. nombre de personnes  2. jour (calendrier des 30 prochains jours)
              3. créneau (places restantes en temps réel)  4. coordonnées
       ──► /api/reservations (Vercel) : revérifie tout, contrôle les places dans la base
              ├─► Supabase : enregistre la réservation, CONFIRMÉE immédiatement (référence GO-XXXXXX)
              └─► Resend   : email de confirmation au client + notification au bar
       ──► confirmation à l'écran ; lien « Gérer ma réservation » pour annuler (jusqu'à 2 h avant)
Vous   ──► /admin : vue par jour, personnes par créneau, annuler, bloquer, ajouter (téléphone), capacité
Chaque nuit ──► /api/cron/cleanup : supprime les réservations de plus de 6 mois (RGPD)
```

Tout fonctionne sur les **plans gratuits** de Vercel, Supabase et Resend.

## Structure

```
index.html            Page principale (accueil, menu, réservation, infos)
reservation/confirmation/  Page « Gérer ma réservation » (lien envoyé par email)
admin/                Panneau admin (/admin) : vue par jour, blocages, ajout manuel, capacité
impressum.html        Mentions légales (obligatoire en Allemagne) — À COMPLÉTER
datenschutz.html      Politique de confidentialité DSGVO/RGPD — À COMPLÉTER
data/menu.json        ← La carte : produits et prix
js/config.js          ← Téléphone, adresse, horaires, règles de réservation (capacité, durée…), réseaux
js/i18n.js            ← Tous les textes du site en FR et DE
js/rules.js           Calcul des créneaux (partagé entre le site et le serveur)
js/main.js            Logique de la page d'accueil
js/booking.js         Réservation en direct (personnes, calendrier, créneaux, formulaire)
js/lang.js            Gestion de la langue FR / DE
js/confirmation.js    Page « Gérer ma réservation » (annulation)
api/                  Fonctions serveur Vercel (réservations, admin, nettoyage)
api/_lib/emails.js    Textes des emails automatiques (FR / DE)
supabase/schema.sql   Base de données : à exécuter dans Supabase (et à relancer après chaque mise à jour)
vercel.json           Tâche planifiée de nettoyage + en-têtes de sécurité
.env.example          Liste des variables d'environnement à créer dans Vercel
css/, fonts/, images/ Design, polices, images
```

En temps normal, vous ne modifiez que les **fichiers marqués ←**. Les mots de passe et clés secrètes ne sont **jamais** dans le code : ils sont dans les variables d'environnement de Vercel.

---

## 1. Modifier le menu (`data/menu.json`)

Chaque produit ressemble à ceci :

```json
{ "name": { "fr": "Double Pomme", "de": "Doppelapfel" },
  "desc": { "fr": "L'incontournable", "de": "Der Klassiker" },
  "price": 16,
  "tag": "popular" }
```

- **price** : un nombre, avec un **point** pour les centimes (`4.5`, pas `4,50`). Le site l'affiche au bon format (« 4,50 € »).
- **desc** est optionnel : supprimez la ligne si vous n'en voulez pas.
- **tag** est optionnel : `"signature"`, `"new"` (Nouveau) ou `"popular"` (Populaire).
- Pour **ajouter un produit**, copiez un bloc `{ … }` et mettez une virgule entre deux blocs (jamais après le dernier).
- Pour **ajouter une catégorie** (un nouvel onglet), copiez un bloc de catégorie entier avec un `"id"` unique.

Après chaque modification, collez le contenu du fichier sur <https://jsonlint.com> pour vérifier qu'il n'y a pas d'erreur de virgule ou de guillemet. S'il y a une erreur, le site affiche « Le menu n'a pas pu être chargé ».

## 2. Changer les horaires, le téléphone, l'adresse (`js/config.js`)

```js
hours: {
  1: { open: "17:00", close: "01:00" }, // lundi
  …
  0: { open: "16:00", close: "01:00" }, // dimanche
},
```

- `0` = dimanche, `1` = lundi … `6` = samedi.
- Une fermeture après minuit s'écrit simplement `"02:00"` : le site comprend que c'est la nuit suivante.
- Pour un jour de fermeture, écrivez `3: null,`.

Tout se met à jour automatiquement à partir de ce fichier : le tableau des horaires (avec le badge « Ouvert maintenant »), les créneaux du formulaire (côté site **et** côté serveur), les liens d'appel et WhatsApp, et les réseaux sociaux.

Les options `reservation` règlent la réservation en ligne :

| Réglage | Par défaut | Rôle |
|---|---|---|
| `slotMinutes` | 30 | un créneau toutes les 30 minutes |
| `lastSlotBeforeClose` | 60 | dernier créneau 1 h avant la fermeture |
| `maxDaysAhead` | 30 | réservation sur les 30 prochains jours |
| `maxPersons` | 10 | maximum de personnes par réservation en ligne |
| `maxPersonsPerSlot` | 40 | **capacité** : personnes présentes en même temps. Elle se règle aussi dans l'admin (bouton « Capacité »), qui a priorité. |
| `durationMinutes` | 120 | une réservation occupe sa place pendant 2 h (elle compte sur tous les créneaux qu'elle chevauche) |
| `minLeadMinutes` | 60 | pas de réservation à moins d'1 h à l'avance |
| `fewSeatsThreshold` | 8 | « Plus que X places » s'affiche à partir de ce nombre |
| `cancelHoursBefore` | 2 | le client peut annuler en ligne jusqu'à 2 h avant |

**Exemple :** avec une capacité de 40, si 40 personnes ont réservé à 21:00, les créneaux de 19:30 à 22:30 sont complets : une réservation à 19:30 serait encore là à 21:00. 23:00 est de nouveau libre.

> Ce fichier est public (il est lu par le navigateur) : n'y mettez **jamais** de mot de passe ni de clé.

**Trois endroits à mettre à jour à la main** quand l'adresse, le téléphone ou les horaires changent (ce sont des informations lues par Google, elles doivent être dans le HTML) :
1. le bloc `application/ld+json` (Schema.org) dans le `<head>` de `index.html`
2. les textes de secours de la section « Infos » dans `index.html` (adresse et téléphone, utilisés si JavaScript ne se charge pas)
3. `impressum.html` et `datenschutz.html`

## 3. Modifier les textes (`js/i18n.js`)

Chaque phrase existe en `fr` et en `de` sous la même clé (par exemple `"hero.tagline"`). Modifiez-la dans les deux langues.
La langue est choisie automatiquement selon le navigateur du visiteur et peut être changée avec le bouton FR/DE. Le site accepte aussi les liens directs `?lang=de` et `?lang=fr` (pratique pour la bio Instagram).

## 4. Mise en place des réservations, pas à pas (≈ 30 minutes)

Vous allez créer 3 comptes gratuits : **Supabase** (la base de données), **Resend** (les emails) et **Vercel** (l'hébergement). Gardez un fichier texte ouvert pour noter les valeurs à copier.

### Étape 1 — Supabase (base de données)

1. Allez sur <https://supabase.com> → **Start your project** → connectez-vous avec GitHub (le plus simple) ou un email.
2. **New project** :
   - *Name* : `le-goia`
   - *Database Password* : cliquez sur **Generate a password** et notez-le (vous n'en aurez normalement pas besoin, mais gardez-le).
   - *Region* : **Central EU (Frankfurt)**, important pour le RGPD.
   - Cliquez sur **Create new project** et attendez 1 à 2 minutes.
3. Dans le menu de gauche, ouvrez **SQL Editor** → **New query**. Ouvrez le fichier `supabase/schema.sql` de ce projet, copiez **tout** son contenu, collez-le, puis cliquez sur **Run**. Le message « Success. No rows returned » doit s'afficher.
   Vous pouvez vérifier dans **Table Editor** : la table `reservations` apparaît.
4. Récupérez deux valeurs :
   - **L'URL du projet** : bouton **Connect** en haut de la page (ou *Project Settings → Data API*). Elle ressemble à `https://abcdefghijkl.supabase.co`. → ce sera `SUPABASE_URL`.
   - **La clé secrète** : *Project Settings → API Keys*. Copiez la **Secret key** (elle commence par `sb_secret_…`, cliquez sur l'œil pour l'afficher). Si votre projet affiche seulement l'onglet *Legacy API keys*, prenez la clé **service_role**. → ce sera `SUPABASE_SERVICE_ROLE_KEY`.

> ⚠️ Cette clé secrète donne un accès complet à la base. Ne la collez **que** dans Vercel, jamais dans un fichier du site, un email ou un message.
> La clé « anon / publishable » n'est pas utilisée : la base est fermée à tout accès public.

À savoir : sur le plan gratuit, Supabase met en pause un projet **sans aucune activité pendant 7 jours**. Le nettoyage automatique quotidien (étape 3) interroge la base chaque nuit, ce qui la garde normalement active. Si le projet est un jour en pause, cliquez sur **Restore** dans Supabase.

### Étape 2 — Resend (emails automatiques)

1. Allez sur <https://resend.com> → **Get started** → créez un compte.
2. **Vérifiez votre nom de domaine.** C'est indispensable pour envoyer des emails à vos clients : sans domaine vérifié, Resend n'envoie qu'à votre propre adresse, ce qui est pratique pour un premier test.
   - Menu **Domains** → **Add Domain** → entrez votre domaine (ex. `le-goia.de`) et choisissez la région **Ireland (eu-west-1)**.
   - Resend affiche 3 ou 4 enregistrements DNS (TXT, MX). Ajoutez-les chez votre registraire de domaine (IONOS, Strato, OVH…, rubrique « DNS »), puis cliquez sur **Verify DNS Records**. La vérification prend de quelques minutes à quelques heures.
3. Menu **API Keys** → **Create API Key** → *Name* : `le-goia`, *Permission* : **Sending access** → **Add**. Copiez la clé (elle commence par `re_…`, elle n'est affichée qu'une fois). → ce sera `RESEND_API_KEY`.
4. Choisissez l'adresse d'expédition, sur votre domaine vérifié, par exemple `Le Goia <reservation@le-goia.de>`. → ce sera `EMAIL_FROM`.

Le plan gratuit de Resend (à ce jour : 3 000 emails par mois, 100 par jour) suffit largement : chaque réservation génère 2 emails (confirmation au client, notification au bar), plus 2 en cas d'annulation.

### Étape 3 — Vercel (hébergement + variables d'environnement)

1. Allez sur <https://vercel.com> → **Sign Up** avec votre compte GitHub.
2. **Add New… → Project** → importez le dépôt GitHub du site → *Framework Preset* : **Other**. Ne changez rien d'autre, puis cliquez sur **Deploy**.
3. Ouvrez le projet → **Settings → Environment Variables**. Ajoutez les variables suivantes une par une (*Key* puis *Value*), en laissant cochés les 3 environnements (Production, Preview, Development) :

| Key | Valeur à mettre | Exemple |
|---|---|---|
| `SUPABASE_URL` | URL du projet Supabase (étape 1) | `https://abcdefghijkl.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé secrète Supabase (étape 1) | `sb_secret_…` |
| `RESEND_API_KEY` | Clé API Resend (étape 2) | `re_…` |
| `EMAIL_FROM` | Expéditeur des emails, sur votre domaine vérifié | `Le Goia <reservation@le-goia.de>` |
| `BAR_EMAIL` | Votre adresse, qui reçoit les nouvelles réservations (les clients qui répondent à un email vous écrivent aussi ici) | `contact@le-goia.de` |
| `ADMIN_PASSWORD` | Mot de passe du panneau `/admin` : **long**, au moins 12 caractères, inventé pour l'occasion | `Chicha-Kehl-2026!Lune` |
| `CRON_SECRET` | Une longue suite de caractères au hasard, protège le nettoyage automatique. Générez-la sur <https://generate-secret.vercel.app/32> | `k3J9…` |
| `SITE_URL` | *(facultatif)* adresse publique du site, utilisée pour le lien vers l'admin dans l'email au bar | `https://www.le-goia.de` |

4. **Important :** les variables ne s'appliquent qu'aux nouveaux déploiements. Allez dans **Deployments** → menu **⋯** du dernier déploiement → **Redeploy**.
5. Vérifiez dans **Settings → Cron Jobs** que la tâche `/api/cron/cleanup` apparaît : elle tourne chaque nuit vers 3 h (heure UTC) et supprime les réservations de plus de 6 mois.
6. *(Optionnel)* **Settings → Domains** : ajoutez votre nom de domaine.

### Étape 4 — Tester

1. Ouvrez votre site, section **Réserver** → faites une réservation avec votre propre email. Le message « C'est réservé ! » s'affiche et vous recevez **deux emails** (la confirmation avec le bouton « Gérer ma réservation », et la notification au bar).
2. Ouvrez `https://votre-site/admin` → entrez `ADMIN_PASSWORD` → la réservation apparaît « Confirmée ».
3. Depuis l'email, cliquez sur « Gérer ma réservation » puis **Annuler la réservation** : vous recevez l'email d'annulation et le bar est prévenu.
4. En cas de souci : Vercel → votre projet → **Logs**. Les erreurs y sont expliquées en clair (« RESEND_API_KEY manquant », « Resend a refusé l'envoi »…).

> **Contrats RGPD (DPA).** Vercel, Supabase et Resend proposent un contrat de sous-traitance (Data Processing Agreement / Addendum) dans leurs pages légales ou leurs paramètres de compte. Acceptez-le pour chacun : c'est une obligation DSGVO.

## 5. Le parcours client

Tout se passe dans la section **Réserver** de l'accueil, sans changer de page :

1. **Combien êtes-vous ?** de 1 à 10. Au-delà, le client est invité à appeler.
2. **Calendrier des 30 prochains jours** :
   - jours fermés grisés ;
   - jours sans aucune place pour ce nombre de personnes marqués **Complet** ;
   - les autres jours sont cliquables.
3. **Créneaux du jour** sous forme de boutons :
   - « Plus que X places » quand il en reste peu ;
   - grisés et non cliquables s'ils sont complets, passés (moins d'1 h à l'avance) ou bloqués ;
   - seuls les créneaux avec assez de places pour le groupe sont cliquables ;
   - les disponibilités se rafraîchissent toutes seules toutes les 30 secondes (indicateur « En temps réel »).
4. **Coordonnées** : nom, téléphone, email, message facultatif, cases 18+ et confidentialité, puis **Confirmer la réservation**.
5. **Confirmation immédiate** s'il reste de la place : message à l'écran avec la référence (ex. `GO-7KQ2MX`) et email de confirmation automatique.
6. **Si quelqu'un a pris la place entre-temps** (le serveur revérifie au moment de l'envoi, deux personnes ne peuvent jamais prendre la dernière place) : message clair, créneaux rafraîchis, et le formulaire garde ce que le client a déjà saisi.

Le lien **« Gérer ma réservation »** (à l'écran et dans l'email) permet d'annuler gratuitement jusqu'à `cancelHoursBefore` heures avant ; ensuite, il faut appeler. Une réservation annulée libère sa place immédiatement.

## 6. Utiliser le panneau admin (`/admin`)

- **Vue par jour** : flèches ‹ › pour changer de jour, bouton « Ce soir », ou une date au calendrier. En tête de page : nombre de réservations, de personnes et pic de personnes présentes.
- **Personnes par créneau** : pour chaque créneau, les personnes présentes (en tenant compte des 2 h), le remplissage par rapport à la capacité et les arrivées.
- **Liste des réservations** triée par heure, avec téléphone (cliquable), email, message. Les réservations prises dans l'admin portent l'étiquette « Téléphone ».
- **Annuler** : le client reçoit automatiquement un email d'annulation dans sa langue, et la place est libérée. Le menu de statut permet aussi de suivre la soirée (En cours, Terminée).
- **+ Ajouter une réservation** (prise par téléphone) : heure, personnes, nom, téléphone, email facultatif (avec ou sans email de confirmation). Elle compte dans les disponibilités. Si le créneau est complet ou bloqué, l'admin demande s'il faut l'ajouter quand même.
- **Bloquer** une journée entière (fermeture exceptionnelle) ou une plage horaire (soirée privée), avec un motif. Les créneaux bloqués ne sont plus proposés en ligne ; « Débloquer » les rouvre. Les réservations déjà prises ne sont pas annulées automatiquement.
- **Capacité** : nombre de personnes présentes en même temps. Le changement s'applique immédiatement au site.
- La page se met à jour toute seule chaque minute. Astuce : sur téléphone, « Ajouter à l'écran d'accueil » pour l'avoir comme une appli.
- La session dure 12 h. Pour déconnecter tout le monde, changez `ADMIN_PASSWORD` dans Vercel puis redéployez.

## 7. Protection anti-spam

- **Champ piège invisible** : un robot qui le remplit reçoit un faux « OK », et rien n'est enregistré.
- Un formulaire envoyé en **moins de 3 secondes** est ignoré de la même façon.
- **Limitation** : au maximum 3 réservations par heure depuis une même connexion, et 3 par jour pour une même adresse email.
- La fonction `/api/disponibilites` ne renvoie que des horaires et des nombres de places, **jamais** de nom, téléphone ou email.
- Connexion admin : au maximum 10 tentatives par quart d'heure.
- Tous les champs sont **revérifiés par le serveur** (date passée, créneau inexistant ou à moins d'1 h, case 18+ non cochée…), et la capacité est contrôlée **dans la base de données**. Même deux clients qui valident exactement en même temps ne peuvent pas dépasser la capacité.

Pour modifier ces limites : `LIMITS` dans `api/reservations.js`.

## 8. Modifier les emails

Les textes des emails (FR et DE) se trouvent en haut de `api/_lib/emails.js`, dans l'objet `TEXT`. Modifiez les phrases entre guillemets, puis enregistrez : Vercel redéploie automatiquement.

## 9. Tester en local (optionnel, pour un développeur)

```bash
npm i -g vercel
vercel link          # relie le dossier au projet Vercel
vercel env pull      # récupère les variables dans .env.local (fichier ignoré par git)
vercel dev           # http://localhost:3000
```

Sans les fonctions serveur (par exemple avec `python3 -m http.server`), le site s'affiche mais les réservations ne partent pas.

## 10. Nom de domaine et SEO

Achetez un domaine (ex. `le-goia.de`), ajoutez-le dans Vercel (**Settings → Domains**) puis **remplacez `https://www.le-goia.de`** par votre domaine dans `index.html` (balises canonical et Open Graph, Schema.org), `robots.txt` et `sitemap.xml`.

> Netlify ou GitHub Pages ne conviennent plus : les réservations reposent sur les fonctions serveur de Vercel (dossier `api/`).

## 11. Avant la mise en ligne : checklist

- [ ] Supabase : projet créé (région Frankfurt), `supabase/schema.sql` exécuté **en entier** (à relancer après chaque mise à jour du site : il met la base à jour sans perte)
- [ ] Resend : domaine vérifié, clé API créée
- [ ] Vercel : les 7 variables d'environnement ajoutées, puis **Redeploy**
- [ ] `js/config.js` : vrai téléphone, WhatsApp, email, adresse, horaires, règles de réservation, liens Instagram et TikTok
- [ ] `/admin` : vérifier la **capacité** par créneau
- [ ] `index.html` : bloc Schema.org et nom de domaine
- [ ] `impressum.html` et `datenschutz.html` : tous les champs `[ … ]` surlignés en doré (dont la région Supabase)
- [ ] DPA acceptés chez Vercel, Supabase et Resend
- [ ] `data/menu.json` : vrais produits et prix
- [ ] Remplacer le logo et les images provisoires (`images/`)
- [ ] Faire une réservation test, puis la confirmer depuis `/admin`
- [ ] Mettre à jour la fiche **Google Business Profile** avec le lien du site

## Ajouter une photo d'ambiance

Le fond de l'accueil est un dégradé avec un effet de fumée animé en CSS. Pour ajouter une vraie photo, placez `images/hero.webp` dans le dossier (environ 1600 px de large, moins de 250 Ko, compressée avec <https://squoosh.app>), puis décommentez la ligne indiquée dans `css/style.css`, section « Hero ».
Pour toute image ajoutée dans la page, utilisez `<img src="…" loading="lazy" width="…" height="…" alt="…">`.

## Respect du RGPD / DSGVO

- **Aucun cookie** de suivi ni outil de statistiques pour les visiteurs. Seul le panneau admin utilise un cookie de session, strictement nécessaire et réservé à l'équipe.
- Les **polices sont hébergées sur le site**, sans appel à Google Fonts.
- **Google Maps** se charge uniquement après un clic sur « Afficher la carte ».
- Les réservations sont stockées dans l'UE (Supabase Frankfurt) et **supprimées automatiquement 6 mois après la date réservée**. Le journal anti-spam, qui ne contient que des empreintes chiffrées, est vidé après 2 jours.
- Les textes légaux fournis sont des **modèles** : faites-les vérifier par un professionnel (avocat, IHK ou expert-comptable).
