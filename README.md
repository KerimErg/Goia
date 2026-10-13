# Le Goia — Site + réservations en ligne

Site du bar à chicha **Le Goia** à Kehl, en français et en allemand : menu, réservation en ligne, infos pratiques, pages Impressum et Datenschutz, et un **panneau admin** pour gérer les réservations depuis le téléphone.

**Comment ça marche :**

```
Client ──► formulaire (index.html) ──► /api/reservations (Vercel)
                                            │  vérifie les champs, l'anti-spam et la capacité du créneau
                                            ├─► Supabase : enregistre la réservation (statut « en attente »)
                                            └─► Resend   : email au client + notification au bar
Vous ──► /admin ──► Confirmer / Refuser ──► Supabase mis à jour + email au client (FR ou DE)
Chaque nuit ──► /api/cron/cleanup ──► supprime les réservations de plus de 6 mois (RGPD)
```

Tout fonctionne sur les **plans gratuits** de Vercel, Supabase et Resend.

## Structure

```
index.html            Page principale (accueil, menu, réservation, infos)
admin/                Panneau admin (/admin) : liste, Confirmer / Refuser
impressum.html        Mentions légales (obligatoire en Allemagne) — À COMPLÉTER
datenschutz.html      Politique de confidentialité DSGVO/RGPD — À COMPLÉTER
data/menu.json        ← La carte : produits et prix
js/config.js          ← Téléphone, adresse, horaires, CAPACITÉ par créneau, réseaux
js/i18n.js            ← Tous les textes du site en FR et DE
js/rules.js           Calcul des créneaux (partagé entre le site et le serveur)
js/main.js            Logique du site
api/                  Fonctions serveur Vercel (réservations, admin, nettoyage)
api/_lib/emails.js    Textes des emails automatiques (FR / DE)
supabase/schema.sql   Création de la base de données (à exécuter une fois dans Supabase)
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

Les options `reservation` règlent :
- `slotMinutes` : l'intervalle entre deux créneaux (30 min) ;
- `lastSlotBeforeClose` : le dernier créneau avant la fermeture ;
- `maxDaysAhead` : jusqu'à combien de jours à l'avance on peut réserver ;
- `maxPersons` : le maximum de personnes **par réservation** ;
- `maxPersonsPerSlot` : la **capacité**, c'est-à-dire le total de personnes acceptées **par créneau horaire** (demandes en attente + confirmées). Quand un créneau est plein, il apparaît « complet » dans le formulaire et le client se voit proposer les horaires libres les plus proches.

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

Le plan gratuit de Resend (à ce jour : 3 000 emails par mois, 100 par jour) suffit largement : chaque réservation génère 3 emails (accusé de réception, notification au bar, confirmation ou refus).

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

1. Ouvrez votre site → faites une réservation avec votre propre email. Vous devez voir « Votre demande est enregistrée… » et recevoir **deux emails** (l'accusé de réception et la notification au bar).
2. Ouvrez `https://votre-site/admin` → entrez `ADMIN_PASSWORD` → la réservation apparaît « En attente ».
3. Cliquez sur **Confirmer** : le client (vous) reçoit l'email de confirmation.
4. En cas de souci : Vercel → votre projet → **Logs**. Les erreurs y sont expliquées en clair (« RESEND_API_KEY manquant », « Resend a refusé l'envoi »…).

> **Contrats RGPD (DPA).** Vercel, Supabase et Resend proposent un contrat de sous-traitance (Data Processing Agreement / Addendum) dans leurs pages légales ou leurs paramètres de compte. Acceptez-le pour chacun : c'est une obligation DSGVO.

## 5. Utiliser le panneau admin (`/admin`)

- **Ce soir / Demain / À venir**, ou une date précise avec le calendrier.
- Chaque soirée affiche le **compteur de personnes** (confirmées + en attente).
- **Confirmer** ou **Refuser** : le statut change et le client reçoit automatiquement l'email correspondant, dans sa langue. Une réservation confirmée peut encore être annulée (« Annuler / refuser »).
- Les réservations refusées sont masquées par défaut (case « Afficher les refusées »).
- La liste se met à jour toute seule toutes les 2 minutes.
- Astuce : sur iPhone ou Android, ouvrez `/admin` puis « Ajouter à l'écran d'accueil » pour l'avoir comme une appli.
- La session dure 12 h. Pour déconnecter tout le monde, changez `ADMIN_PASSWORD` dans Vercel puis redéployez.

Vous pouvez aussi consulter ou modifier les données directement dans Supabase → **Table Editor → reservations**. Les statuts possibles sont `en_attente`, `confirmee` et `refusee`.

## 6. Protection anti-spam

- **Champ piège invisible** : un robot qui le remplit reçoit un faux « OK », et rien n'est enregistré.
- Un formulaire envoyé en **moins de 3 secondes** est ignoré de la même façon.
- **Limitation** : au maximum 3 demandes par heure depuis une même connexion, et 3 par jour pour une même adresse email.
- Connexion admin : au maximum 10 tentatives par quart d'heure.
- Tous les champs sont **revérifiés par le serveur** (date passée, créneau inexistant, case 18+ non cochée…), et la capacité est contrôlée **dans la base de données**. Même deux clients qui valident exactement en même temps ne peuvent pas dépasser la capacité.

Pour modifier ces limites : `LIMITS` dans `api/reservations.js`.

## 7. Modifier les emails

Les textes des emails (FR et DE) se trouvent en haut de `api/_lib/emails.js`, dans l'objet `TEXT`. Modifiez les phrases entre guillemets, puis enregistrez : Vercel redéploie automatiquement.

## 8. Tester en local (optionnel, pour un développeur)

```bash
npm i -g vercel
vercel link          # relie le dossier au projet Vercel
vercel env pull      # récupère les variables dans .env.local (fichier ignoré par git)
vercel dev           # http://localhost:3000
```

Sans les fonctions serveur (par exemple avec `python3 -m http.server`), le site s'affiche mais les réservations ne partent pas.

## 9. Nom de domaine et SEO

Achetez un domaine (ex. `le-goia.de`), ajoutez-le dans Vercel (**Settings → Domains**) puis **remplacez `https://www.le-goia.de`** par votre domaine dans `index.html` (balises canonical et Open Graph, Schema.org), `robots.txt` et `sitemap.xml`.

> Netlify ou GitHub Pages ne conviennent plus : les réservations reposent sur les fonctions serveur de Vercel (dossier `api/`).

## 10. Avant la mise en ligne : checklist

- [ ] Supabase : projet créé (région Frankfurt), `supabase/schema.sql` exécuté
- [ ] Resend : domaine vérifié, clé API créée
- [ ] Vercel : les 7 variables d'environnement ajoutées, puis **Redeploy**
- [ ] `js/config.js` : vrai téléphone, WhatsApp, email, adresse, horaires, **capacité par créneau** (`maxPersonsPerSlot`), liens Instagram et TikTok
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
