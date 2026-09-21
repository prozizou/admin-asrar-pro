# ASRAR PRO — Panneau d'administration

Projet **totalement dissocié** de l'application principale (**asrar-main**, app
Next.js unifiée — plus de « hub » statique séparé, voir sa migration documentée
dans son propre README/`ANALYSE.md`) : à déployer comme un **projet Vercel
séparé** (ex. `asrar-admin.vercel.app`), avec sa propre connexion Google. Il
pilote la même base Firebase (`asrar-bc059`) via le **Firebase Admin SDK**
côté serveur — aucune modification des règles de sécurité n'est requise pour
fonctionner (les nœuds sensibles restent `read/write:false` côté client).

> ℹ️ asrar-main contient encore un `pages/api/admin.js` hérité d'avant la
> dissociation des deux projets (Session 4 de son `CHANGELOG.md`) : aucune UI
> de son côté ne l'appelle (pas de route `app/admin/`). Ce panneau-ci ne s'en
> sert pas et n'en dépend pas — chaque route `api/*.js` d'ASRAR PRO parle
> directement au Firebase Admin SDK, avec ses propres conventions (ex.
> `purchased_user` pour les octrois manuels, quand l'`api/admin.js` hérité
> écrit dans `allowedUsers`) : les deux restent compatibles côté barrière
> d'accès (`server/access.js` lit les deux nœuds), mais ne partagent pas de code.

## Interface et vérification

La refonte propose une interface ivoire et vert profond, un thème sombre,
une navigation latérale sur ordinateur et une barre inférieure sur mobile.
La recherche `Ctrl/Cmd + K` ouvre les sections et les actions courantes.
Les URL `#content`, `#users`, etc. conservent la section au rechargement et
permettent de revenir en arrière avec le navigateur.

Le tableau de bord affiche les données des API existantes : indicateurs,
trafic sur 7/30/90 jours, pays et activité récente. Les fenêtres de création,
les listes, les formulaires et les confirmations partagent le même habillage.
Le clavier reste contenu dans les fenêtres ouvertes ; Échap ferme les menus
et les éditeurs. Les animations respectent la réduction des mouvements.
La police Inter est hébergée localement (licence dans `assets/fonts/OFL.txt`).

- `admin-design.css` : palette, navigation, responsive et habillage commun.
- `admin-shell.js` : recherche, navigation mobile, titres et gestion du focus.
- `admin-theme.js` : préférence de thème appliquée avant le premier affichage.
- `admin.css` : composants métier existants, complétés par le nouvel habillage.

### Tests de l'interface

```sh
npm ci
npx playwright install chromium
npm run check
npm test
```

Les tests démarrent leur serveur local et simulent Firebase et les API dans
le navigateur. Ils ne requièrent aucun secret et n'appellent pas la base de
production. Ils couvrent les sept sections à 360, 390, 768, 1024 et 1440 px,
les fenêtres d'édition, le focus clavier, la recherche, l'historique de
navigation, le thème, la déconnexion, les comptes refusés, les données vides,
le stockage local indisponible et la relance après une erreur serveur.
`UI_CHROMIUM_PATH` permet de préciser un exécutable Chromium déjà installé.
`UI_CAPTURE_DIR` active l'enregistrement des captures de vérification.

Les aperçus de `docs/previews/` utilisent uniquement des données de
démonstration. Le test de la véritable connexion Google et des écritures
Firebase nécessite un environnement de préproduction configuré.

## Déploiement (une fois)

1. Créer un **nouveau projet Vercel** et y déposer ce dossier.
2. Variables d'environnement (Settings → Environment Variables) :
   - `FIREBASE_SERVICE_ACCOUNT` : le JSON complet du compte de service
     (Console Firebase → Paramètres → Comptes de service → Générer une clé).
     ⚠️ À coller UNIQUEMENT dans Vercel. Jamais dans le code, ni dans un chat.
   - `FIREBASE_DB_URL` : `https://asrar-bc059.firebaseio.com`
   - `SITE_URL` : URL publique d'asrar-main (ex. `https://www.asrarpro.com` — même
     valeur que la variable `SITE_URL` du projet asrar-main lui-même, cf. son
     `.env.example`) — sert à construire les liens partageables 🔗 vers `/s`,
     servi par asrar-main même (plus de hub séparé). Défaut : `https://www.asrarpro.com`.
     (`HUB_URL` reste lu en repli, pour compatibilité avec un déploiement déjà
     configuré sous l'ancien nom.)
3. Console Firebase → Authentication → Settings → **Domaines autorisés** :
   ajouter le domaine du panneau (ex. `asrar-admin.vercel.app`).

## Qui a accès ?

Authentification **Google uniquement** (bouton « Se connecter avec Google »,
popup avec repli en redirection si la popup est bloquée) — aucun mot de passe
propre au panneau.

- Le **super-admin** (`prozizou298@gmail.com`) — toujours, quel que soit le
  contenu de `admins/`.
- Tout autre compte Google dont l'email est présent dans
  `admins/{email avec , à la place de .} = true`.
- N'importe quel compte Google peut ouvrir une session Firebase (rien ne
  filtre à ce stade) : c'est la vérification **côté serveur**, juste après la
  connexion (jeton + statut admin re-contrôlés à **chaque** appel API,
  `verifyAdmin` dans `api/_lib/fb.js`), qui déconnecte immédiatement tout
  compte non autorisé avant de laisser apparaître le panneau.

## Fonctionnalités

- **Tableau de bord** : quatre indicateurs, trafic (courbes et tableau de valeurs),
  utilisateurs par pays et activité récente. La **valeur des accès** additionne
  les montants associés aux paliers, y compris les octrois manuels : elle ne
  constitue pas un relevé de paiements encaissés. Les chiffres sur 30 jours sont
  des volumes sur cette période, et non des pourcentages de progression.
  Sur 30/90 jours, le graphique regroupe les jours en tranches de 7 jours et
  précise que les visiteurs uniques sont cumulés quotidiennement.
- **Contenus page par page** : liste blanche de nœuds éditables (Noms d'Allah,
  versets, sourates, bibliothèques Sirr, produits, commentaires/notes…).
  Ajouter / éditer (JSON) / supprimer / **exporter en JSON**.
  Toute suppression passe par **double confirmation** et une copie part dans
  `trash/` (corbeille) avant effacement.
- **Utilisateurs — accès premium par e-mail (avec date d'expiration)** :
  saisir un e-mail + une **date d'expiration** (ou boutons rapides +1/+3/+6
  mois, +1 an, ou « à vie ») pour accorder l'accès — **même à un e-mail
  qui n'a pas encore de compte**. L'accès est écrit dans `purchased_user/{clé}`
  avec `expiresAt`. asrar-main laisse alors passer l'utilisateur **jusqu'à cette
  date** ; passé le délai, il est **automatiquement bloqué** jusqu'à un nouvel
  accès. La liste « Accès accordés » montre le statut (actif/expiré) et permet de
  **prolonger** ou **révoquer**. (API `users` : `grant_access`, `revoke_access`,
  `list_access` — c'est tout ce que cet onglet fait : pas de liste de comptes,
  pas de bannissement, pas de promotion admin/VIP depuis cette interface.)
- **Parrainage** (onglet dédié — se conjugue avec `/api/referral` et `/s` d'asrar-main) :
  KPIs (parrains, filleuls crédités, clics, taux clic→inscription, points en
  circulation, abonnements gagnés), **classement des parrains**, **alertes
  anti-fraude** (rafale de filleuls en 24 h, conversion anormale), **liste des
  filleuls** d'un parrain, **± points** (motif obligatoire, audité),
  **suspension** d'un parrain, **régénération de code**, et **réglages du
  programme** (`config/referral` : actif, points/filleul, seuil, jours offerts,
  âge maximal du compte filleul) — asrar-main les applique immédiatement.
- **Liens partageables** : bouton **🔗** sur chaque carte de contenu (Sirr,
  Almaqtab) et sur chaque produit du Marché → copie/partage du lien
  `SITE_URL/s?k=…&c=…&i=…` (aperçu Open Graph sur WhatsApp / Facebook / TikTok).
- **Palier d'abonnement** à l'octroi d'accès : le champ `level` est désormais écrit
  dans `purchased_user` (automatique selon la durée, ou choisi). Sans lui,
  asrar-main laisserait l'utilisateur au niveau 0 → **PDF et polices Al-Qalam
  bloqués** malgré un accès valide (une fois `FREE_FOR_ALL` désactivé — voir plus
  bas). Les accès obtenus par parrainage sont marqués **🎁 parrainage**.
- **Marché (boutiques & produits)** : onglet dédié. Liste des boutiques
  (`sellers/{uid}`) avec statut (active / expirée), date d'expiration et nombre de
  produits. Actions par boutique : **Prolonger** (nouvelle date), **Renommer**,
  **Notifier** le vendeur, **Révoquer** (retire tous ses produits de la vente en
  les déplaçant vers `det_produits_bloques`), **Restaurer**, **Supprimer**
  (corbeille). Bouton **« Bloquer les boutiques expirées »** : bloque d'un coup
  toutes les boutiques dont la date de péremption est atteinte. Produits listés
  **par 50** avec blocage / déblocage / suppression à l'unité.
- **Sélection multiple (contenus)** : bouton **☑ Sélection** → cases à cocher sur
  les cartes → **supprimer** en lot ou **déplacer** vers un autre nœud RTDB.
- **Affichage par 50** : contenus et produits se chargent par pages de 50
  (bouton « Afficher 50 de plus ») pour ne pas tout charger d'un coup.
- **Interface responsive** : détection mobile / PC. Sur mobile, la liste des
  bibliothèques et la grille occupent toute la largeur (navigation liste ↔ grille
  avec bouton « ← Bibliothèques »).

## À faire dans l'application principale (asrar-main)

asrar-main a migré vers une **app Next.js unifiée** (plus de site statique
« hub » — voir son README) et versionne désormais ses règles RTDB dans
`rules/database.rules.json` (reconstituées à partir du code, cf. son
`rules/README.md` : « base de travail », à comparer avec la console Firebase
avant tout déploiement). À la date de cette revue, ce fichier **ne contient
pas encore les nœuds de parrainage** — le point ci-dessous reste donc à faire.

### Parrainage — règles RTDB

asrar-main écrit `referrals`, `referral_codes` et `referred` (Admin SDK,
`pages/api/referral.js`). À ajouter dans `rules/database.rules.json` :

```json
"referrals":      { "$uid": { ".read": "auth != null && auth.uid === $uid", ".write": false } },
"referral_codes": { ".read": false, ".write": false },
"referred":       { ".read": false, ".write": false, ".indexOn": ["by"] }
```

`.indexOn: ["by"]` est requis par l'action **children** (filleuls d'un parrain,
`api/referral.js` de ce panneau). Les réglages du programme vivent dans
`config/referral` — inutile d'ouvrir tout `config/` en lecture pour ça, une
règle ciblée suffit (écriture serveur uniquement) :

```json
"config": {
  "referral": { ".read": false, ".write": false }
}
```

(`audit_log`, `trash` et `banned` n'apparaissent pas dans les règles → refusés
par défaut côté client : c'est voulu, ils sont serveur-only.)

## ⚠️ Paywall actuellement désactivé côté asrar-main (`FREE_FOR_ALL`)

`lib/plans.js` d'asrar-main déclare `export const FREE_FOR_ALL = true;` : tant
que ce drapeau reste actif, `hasActiveAccess` / `getAccessLevel` /
`getAccessStatus` (`server/access.js`) court-circuitent leurs lectures RTDB et
répondent « accès total » à **tout le monde**, y compris pour les modules
premium (Al Qalam, Géomancie). Conséquence pour ce panneau : les octrois et
révocations d'accès (onglet Utilisateurs) sont **bien enregistrés** dans
`purchased_user`/`allowedUsers` (rien n'est cassé ni perdu) mais **n'ont
aucun effet visible** pour les utilisateurs tant que ce drapeau n'est pas
repassé à `false` dans le code d'asrar-main — c'est le seul geste nécessaire
pour réactiver le paywall, tout le reste (achats, grants, code du paywall)
reste intact. Cette configuration se vérifie dans le dépôt de l'application principale ;
elle n'est pas affichée comme bannière dans le tableau de bord.

## Notes de sécurité

- Le panneau est en `noindex` + `Cache-Control: no-store` + `X-Frame-Options: DENY`.
- Authentification **Google uniquement** ; tout compte non admin est déconnecté
  automatiquement dès la première vérification serveur post-connexion (voir
  « Qui a accès ? »).
- Ce panneau ne bannit plus de compte Firebase Auth ni ne promeut d'admin/VIP
  depuis son interface (fonctionnalité retirée) — reste possible depuis la
  console Firebase si nécessaire.
- La liste blanche de `api/content.js` empêche d'éditer les nœuds de droits
  (`purchased_user`, `admins`, `vip_users`) hors des routes dédiées et auditées.

## Images (Cloudinary) — upload signé

Le bouton **Ajouter** (Contenus) et le clic sur une carte ouvrent la **grande vue** :
on y choisit une image depuis le téléphone → elle est envoyée sur Cloudinary et son
URL est enregistrée dans le nœud RTDB interrogé (l'app crée la clé automatiquement ;
pour un ajout, seuls **Titre** + **Faida** + **image** sont demandés).

L'upload est **signé côté serveur** (`/api/cloudinary-sign`) : le secret ne quitte
jamais Vercel. Variables d'env à ajouter :

```
CLOUDINARY_CLOUD_NAME=dqixuyqqh
CLOUDINARY_API_KEY=...        (Cloudinary → Settings → API Keys)
CLOUDINARY_API_SECRET=...     (idem — SECRET, ne jamais exposer)
```

Le champ image écrit dans RTDB s'appelle `image` (URL) + `imageId` (public_id, pour
suppression ultérieure). Si un enregistrement utilise déjà `img`/`url`, ce nom est conservé.

## PWA (panneau installable, cache dynamique)

`manifest.json` + `sw.js` + `pwa.js` : le panneau est installable et fonctionne avec
un **cache dynamique network-first**. À chaque déploiement, incrémente `SW_VERSION`
dans `sw.js` → l'ancien cache est purgé et la page se recharge sur la nouvelle version.
L'API et Cloudinary ne sont jamais mis en cache.
