# ASRAR PRO — Panneau d'administration

Projet **totalement dissocié** de l'application principale : à déployer comme un
**projet Vercel séparé** (ex. `asrar-admin.vercel.app`), avec sa propre connexion
Google. Il pilote la même base Firebase (`asrar-bc059`) via le **Firebase Admin SDK**
côté serveur — aucune modification des règles de sécurité n'est requise pour
fonctionner (les nœuds sensibles restent `read/write:false` côté client).

## Déploiement (une fois)

1. Créer un **nouveau projet Vercel** et y déposer ce dossier.
2. Variables d'environnement (Settings → Environment Variables) :
   - `FIREBASE_SERVICE_ACCOUNT` : le JSON complet du compte de service
     (Console Firebase → Paramètres → Comptes de service → Générer une clé).
     ⚠️ À coller UNIQUEMENT dans Vercel. Jamais dans le code, ni dans un chat.
   - `FIREBASE_DB_URL` : `https://asrar-bc059.firebaseio.com`
   - `HUB_URL` : URL publique du hub (ex. `https://asrar-hub.vercel.app`) —
     sert à construire les liens partageables 🔗. Défaut : `https://asrar-hub.vercel.app`.
3. Console Firebase → Authentication → Settings → **Domaines autorisés** :
   ajouter le domaine du panneau (ex. `asrar-admin.vercel.app`).

## Qui a accès ?

- Le **super-admin** (`prozizou298@gmail.com`) — toujours.
- Tout email présent dans `admins/{email avec , à la place de .} = true`.
- Chaque appel API re-vérifie le statut **côté serveur** (jeton + `checkRevoked`).

## Fonctionnalités

- **Tableau de bord** : visites journalières & mensuelles (barres survolables),
  visiteurs uniques, revenus PayDunya (30 j / total / nb ventes), activité récente.
- **Contenus page par page** : liste blanche de nœuds éditables (Noms d'Allah,
  versets, sourates, bibliothèques Sirr, produits, commentaires/notes…).
  Ajouter / éditer (JSON) / supprimer / **exporter en JSON**.
  Toute suppression passe par **double confirmation** et une copie part dans
  `trash/` (corbeille) avant effacement.
- **Utilisateurs** : recherche, badges (admin / VIP / abonné / banni),
  **bannissement réel** (compte Firebase Auth désactivé + jetons révoqués →
  déconnecté partout en ≤ 1 h, reconnexion impossible), VIP, promotion admin
  (**réservée au super-admin**).
- **Accès premium par e-mail (avec date d'expiration)** : dans l'onglet
  Utilisateurs, saisir un e-mail + une **date d'expiration** (ou boutons rapides
  +1/+3/+6 mois, +1 an, ou « à vie ») pour accorder l'accès — **même à un e-mail
  qui n'a pas encore de compte**. L'accès est écrit dans `purchased_user/{clé}`
  avec `expiresAt`. Le hub laisse alors passer l'utilisateur **jusqu'à cette
  date** ; passé le délai, il est **automatiquement bloqué** jusqu'à un nouvel
  accès. La liste « Accès accordés » montre le statut (actif/expiré) et permet de
  **prolonger** ou **révoquer**. (API `users` : `grant_access`, `revoke_access`,
  `list_access`.)
- **Journal d'audit** : chaque action admin est tracée (`audit_log`).
- **Parrainage** (onglet dédié — se conjugue avec `/api/referral` et `/s` du hub) :
  KPIs (parrains, filleuls crédités, clics, taux clic→inscription, points en
  circulation, abonnements gagnés), **classement des parrains**, **alertes
  anti-fraude** (rafale de filleuls en 24 h, conversion anormale), **liste des
  filleuls** d'un parrain, **± points** (motif obligatoire, audité),
  **suspension** d'un parrain, **régénération de code**, et **réglages du
  programme** (`config/referral` : actif, points/filleul, seuil, jours offerts,
  âge maximal du compte filleul) — le hub les applique immédiatement.
- **Liens partageables** : bouton **🔗** sur chaque carte de contenu (Sirr,
  Almaqtab) et sur chaque produit du Marché → copie/partage du lien
  `HUB_URL/s?k=…&c=…&i=…` (aperçu Open Graph sur WhatsApp / Facebook / TikTok).
- **Palier d'abonnement** à l'octroi d'accès : le champ `level` est désormais écrit
  dans `purchased_user` (automatique selon la durée, ou choisi). Sans lui, le hub
  laissait l'utilisateur au niveau 0 → **PDF et polices Al-Qalam bloqués** malgré
  un accès valide. Les accès obtenus par parrainage sont marqués **🎁 parrainage**.
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
- **Affichage par 50** : contenus, utilisateurs et produits se chargent par pages
  de 50 (bouton « Afficher 50 de plus ») pour ne pas tout charger d'un coup.
- **Interface responsive** : détection mobile / PC. Sur mobile, la liste des
  bibliothèques et la grille occupent toute la largeur (navigation liste ↔ grille
  avec bouton « ← Bibliothèques »).
- **Réglages** : mode **maintenance** + **annonce globale** (`config/`).
- **Planificateur** (onglet dédié, nœud `planner/`) : prépare à l'avance des textes
  (secrets, documents, produits) avec **plusieurs variantes** par contenu, pour vos
  groupes Facebook cibles. Chaque **groupe** a son **propre lien Facebook** (requis à
  la création) : le bouton **« Copier & ouvrir le groupe »** copie le texte dans le
  presse-papiers puis ouvre le groupe dans un nouvel onglet — il ne reste qu'à coller
  (Ctrl/Cmd+V) dans le champ de publication du groupe. **Checklist du jour** : un
  groupe par ligne, texte prêt à copier-coller, statut publié / à publier — vous
  publiez vous-même sur Facebook, le panneau ne poste jamais rien automatiquement
  (zéro automatisation détectable).
  **Générer un planning** répartit un contenu sur plusieurs jours × groupes en
  choisissant, pour chaque groupe, la variante la moins récemment utilisée (rotation
  anti-répétition). **Historique** : quel groupe a reçu quelle variante, et quand.
  Un **rappel** (heure réglable) affiche un bandeau — et une notification navigateur
  si autorisée — quand des groupes restent à publier ; c'est un rappel côté client
  (utile pendant que le panneau est ouvert), pas une notification push serveur.

## À faire dans l'application principale

### 0. Parrainage — règles RTDB

Le hub écrit `referrals`, `referral_codes` et `referred` (Admin SDK). À fusionner :

```json
"referrals":      { "$uid": { ".read": "auth != null && auth.uid === $uid", ".write": false } },
"referral_codes": { ".read": false, ".write": false },
"referred":       { ".read": false, ".write": false, ".indexOn": ["by"] }
```

`.indexOn: ["by"]` est requis par l'action **children** (filleuls d'un parrain).
Les réglages du programme vivent dans `config/referral` — la règle `config`
ci-dessous suffit (écriture serveur uniquement).

### 1. Règles Firebase — rendre `config` lisible par les utilisateurs
Pour que l'app affiche l'annonce / l'écran de maintenance, ajoutez :

```json
"config": {
  ".read": "auth != null",
  ".write": false
}
```

(`audit_log`, `trash` et `banned` n'apparaissent pas dans les règles → refusés
par défaut côté client : c'est voulu, ils sont serveur-only.)

### 2. Snippet maintenance + annonce (dans `js/firebase-config.js` du hub)

```js
// Maintenance + annonce pilotées par le panneau admin (nœud config/).
db.ref('config').on('value', (s) => {
  const c = s.val() || {};
  if (c.maintenance && auth.currentUser?.email !== 'prozizou298@gmail.com') {
    document.body.innerHTML =
      '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;' +
      'text-align:center;padding:24px;font-family:system-ui"><div>' +
      '<h1>🛠️ Maintenance en cours</h1><p>ASRAR PRO revient très vite, in shâ Allah.</p></div></div>';
    return;
  }
  let b = document.getElementById('asrar-announce');
  if (c.announcement) {
    if (!b) {
      b = document.createElement('div');
      b.id = 'asrar-announce';
      b.style.cssText = 'background:#3b2f0e;color:#f0d878;padding:10px 14px;' +
        'text-align:center;font-size:.9rem;position:sticky;top:0;z-index:9999';
      document.body.prepend(b);
    }
    b.textContent = '📢 ' + c.announcement;
  } else if (b) b.remove();
});
```

## Notes de sécurité

- Le panneau est en `noindex` + `Cache-Control: no-store` + `X-Frame-Options: DENY`.
- Un admin banni est rejeté dès son prochain appel (`checkRevoked: true`).
- Le super-admin ne peut être ni banni ni rétrogradé depuis l'interface.
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
