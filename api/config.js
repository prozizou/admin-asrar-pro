// api/config.js — Sert la config Firebase PUBLIQUE (client).
module.exports = (req, res) => {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  
  const cfg = {
    apiKey:      process.env.FB_API_KEY || process.env.FIREBASE_API_KEY || "AIzaSyC4Y2pbLhGmT2nNJ5bxLdWG2AoBecpvzLg",
    authDomain:  process.env.FB_AUTH_DOMAIN || process.env.FIREBASE_AUTH_DOMAIN || "asrar-bc059.firebaseapp.com",
    databaseURL: process.env.FB_DB_URL || process.env.FIREBASE_DB_URL || "https://asrar-bc059.firebaseio.com",
    projectId:   process.env.FB_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || "asrar-bc059",
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "asrar-bc059.appspot.com",
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "199810893447",
    appId:       process.env.FIREBASE_APP_ID || "1:199810893447:web:165ed3d51093d83c68da22"
  };

  // URL publique du site (asrar-main) : sert à construire les liens partageables
  // /s?k=…&i=… depuis le panneau (onglet Contenus → bouton 🔗). asrar-main est
  // désormais une app Next.js unifiée (plus de "hub" séparé) qui sert elle-même
  // /s (rewrite → api/share, cf. next.config.mjs) — même variable d'env que
  // l'app (`SITE_URL`, .env.example) et même valeur par défaut (lib/firebase.js
  // → ASRAR_CONFIG.siteUrl). Définir SITE_URL sur Vercel (l'ancien nom HUB_URL
  // reste lu en repli pour ne pas casser un déploiement déjà configuré).
  const site = String(process.env.SITE_URL || process.env.HUB_URL || "https://www.asrarpro.com").replace(/\/+$/, "");

  res.status(200).send(
    "window.FIREBASE_CONFIG=" + JSON.stringify(cfg) + ";" +
    "window.SITE_URL=" + JSON.stringify(site) + ";" +
    "window.HUB_URL=" + JSON.stringify(site) + ";" // alias historique — cf. admin-core.js
  );
};

