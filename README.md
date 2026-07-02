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
  déconnecté partout en ≤ 1 h, reconnexion impossible), offrir/retirer un
  abonnement, VIP, promotion admin (**réservée au super-admin**).
- **Journal d'audit** : chaque action admin est tracée (`audit_log`).
- **Réglages** : mode **maintenance** + **annonce globale** (`config/`).

## À faire dans l'application principale (2 petits ajouts)

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
