# Le Goia — Site vitrine

Site du bar à chicha **Le Goia** à Kehl. Il tient sur une seule page en français et en allemand : menu, réservation, infos pratiques, plus les pages Impressum et Datenschutz.
C'est un site statique (HTML, CSS et JavaScript simples) : pas d'installation, pas de base de données, hébergement gratuit.

## Structure

```
index.html          Page principale (accueil, menu, réservation, infos)
impressum.html      Mentions légales (obligatoire en Allemagne) — À COMPLÉTER
datenschutz.html    Politique de confidentialité DSGVO/RGPD — À COMPLÉTER
data/menu.json      ← La carte : produits et prix
js/config.js        ← Téléphone, WhatsApp, adresse, horaires, réseaux, clé du formulaire
js/i18n.js          ← Tous les textes du site en FR et DE
js/main.js          Logique du site (pas besoin d'y toucher)
css/style.css       Design (couleurs en haut du fichier, section « Palette »)
fonts/              Polices hébergées sur le site (Cormorant Garamond + Inter)
images/             Favicon, logo, image d'aperçu pour les réseaux (og-image.jpg)
robots.txt, sitemap.xml
```

En temps normal, vous ne modifiez que les **trois fichiers marqués ←**.

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

Tout se met à jour automatiquement à partir de ce fichier : le tableau des horaires (avec le badge « Ouvert maintenant »), les créneaux du formulaire, les liens d'appel et WhatsApp, et les réseaux sociaux.
Les options `reservation` règlent l'intervalle entre deux créneaux, le dernier créneau avant la fermeture, le nombre de jours à l'avance et le nombre maximum de personnes.

**Trois endroits à mettre à jour à la main** quand l'adresse, le téléphone ou les horaires changent (ce sont des informations lues par Google, elles doivent être dans le HTML) :
1. le bloc `application/ld+json` (Schema.org) dans le `<head>` de `index.html`
2. les textes de secours de la section « Infos » dans `index.html` (adresse et téléphone, utilisés si JavaScript ne se charge pas)
3. `impressum.html` et `datenschutz.html`

## 3. Modifier les textes (`js/i18n.js`)

Chaque phrase existe en `fr` et en `de` sous la même clé (par exemple `"hero.tagline"`). Modifiez-la dans les deux langues.
La langue est choisie automatiquement selon le navigateur du visiteur et peut être changée avec le bouton FR/DE. Le site accepte aussi les liens directs `?lang=de` et `?lang=fr` (pratique pour la bio Instagram).

## 4. Configurer l'envoi des réservations (Web3Forms, gratuit)

1. Allez sur <https://web3forms.com>, entrez **l'adresse email qui doit recevoir les réservations** puis cliquez sur « Create Access Key ».
2. Vous recevez une clé du type `a1b2c3d4-…` par email.
3. Dans `js/config.js`, remplacez le texte de la première ligne :
   ```js
   web3formsKey: "a1b2c3d4-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
   ```
4. Mettez le site en ligne et faites une réservation test. Vous devez recevoir un email intitulé
   « Réservation Le Goia – Nom – date heure (n pers.) ». Le bouton « Répondre » de votre messagerie répond directement au client.

Tant que la clé n'est pas configurée, le formulaire affiche un message invitant le client à réserver par WhatsApp ou par téléphone : aucune demande n'est perdue en silence.
L'offre gratuite de Web3Forms suffit largement pour un bar (250 envois par mois à ce jour).

**Alternative Formspree** : créez un formulaire sur <https://formspree.io>. Dans `js/main.js`, remplacez `WEB3FORMS_URL` par l'URL fournie (`https://formspree.io/f/xxxx`) et indiquez une valeur quelconque dans `web3formsKey`. Pensez à adapter le nom du prestataire dans `datenschutz.html`.

> Une demande envoyée par le formulaire **n'est pas une réservation confirmée** : le message au client le précise. C'est vous qui rappelez le client ou lui écrivez pour confirmer.

## 5. Tester le site sur votre ordinateur

Le menu est chargé depuis `menu.json`. Pour des raisons de sécurité, les navigateurs bloquent ce chargement si vous ouvrez `index.html` par un simple double-clic. Lancez plutôt un petit serveur local :

- **VS Code** : installez l'extension « Live Server », faites un clic droit sur `index.html`, puis « Open with Live Server ».
- **Ou dans un terminal**, depuis le dossier du site : `python3 -m http.server 8000`, puis ouvrez <http://localhost:8000>.

Pour revoir la fenêtre de vérification d'âge, videz les données du site dans votre navigateur ou testez en navigation privée.

## 6. Mettre le site en ligne gratuitement

### Netlify (le plus simple)
1. Créez un compte sur <https://app.netlify.com>.
2. Menu « Add new site », puis « Deploy manually » : **glissez-déposez le dossier du site**. C'est en ligne.
3. Pour les mises à jour, redéposez le dossier, ou reliez le dépôt GitHub (« Import from Git ») pour que chaque modification soit publiée automatiquement.

### GitHub Pages
1. Sur GitHub, dans le dépôt : Settings, puis Pages.
2. Source : « Deploy from a branch », choisissez la branche `main` et le dossier `/ (root)`, puis enregistrez.
3. Le site est disponible après une minute environ à l'adresse `https://<utilisateur>.github.io/<depot>/`.

### Vercel
Sur <https://vercel.com>, cliquez sur « Add New », puis « Project », importez le dépôt GitHub et laissez tous les réglages par défaut (pas de build).

### Nom de domaine
Achetez un domaine (par exemple `le-goia.de` chez IONOS, Strato ou OVH, quelques euros par an) et reliez-le dans les réglages de votre hébergeur (rubrique « Domain »). Ensuite, **remplacez `https://www.le-goia.de`** par votre vrai domaine dans `index.html` (balises canonical et Open Graph, Schema.org), `robots.txt` et `sitemap.xml`.

## 7. Avant la mise en ligne : checklist

- [ ] `js/config.js` : vrai téléphone, numéro WhatsApp, email, adresse, horaires, liens Instagram et TikTok, clé Web3Forms
- [ ] `index.html` : bloc Schema.org et nom de domaine
- [ ] `impressum.html` : tous les champs `[ … ]` surlignés en doré
- [ ] `datenschutz.html` : champs `[ … ]` et nom de l'hébergeur choisi
- [ ] `data/menu.json` : vrais produits et vrais prix
- [ ] Remplacer `images/logo.svg`, `images/favicon.svg`, `images/apple-touch-icon.png` et `images/og-image.jpg` (1200 × 630 px) par vos visuels
- [ ] Faire une réservation test
- [ ] Créer ou mettre à jour la fiche **Google Business Profile** avec le lien du site (c'est elle qui apparaît sur Google Maps)

## Ajouter une photo d'ambiance

Le fond de l'accueil est un dégradé avec un effet de fumée animé en CSS. Pour ajouter une vraie photo, placez `images/hero.webp` dans le dossier (environ 1600 px de large, moins de 250 Ko, compressée avec <https://squoosh.app>), puis décommentez la ligne indiquée dans `css/style.css`, section « Hero ».
Pour toute image ajoutée dans la page, utilisez `<img src="…" loading="lazy" width="…" height="…" alt="…">` afin qu'elle se charge seulement quand le visiteur fait défiler jusqu'à elle.

## Respect du RGPD / DSGVO

- **Aucun cookie** de suivi et aucun outil de statistiques.
- Les **polices sont hébergées sur le site**, pas chargées depuis Google Fonts. En Allemagne, un tribunal (LG München, 2022) a jugé illégal de charger Google Fonts à distance sans consentement.
- **Google Maps** se charge uniquement après un clic sur « Afficher la carte ».
- La vérification d'âge et le choix de la langue sont mémorisés dans le navigateur du visiteur (localStorage). Ce sont des données techniques nécessaires, qui ne quittent pas son appareil.
- Les textes légaux fournis sont des **modèles** : faites-les vérifier par un professionnel (avocat, IHK ou expert-comptable).
