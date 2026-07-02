// api/config.js — Sert la config Firebase PUBLIQUE (client) depuis les variables
// d'environnement Vercel. Renvoie du JavaScript : window.FIREBASE_CONFIG = {...}.
// (Ces valeurs ne sont pas secrètes ; elles identifient le projet côté navigateur.)
module.exports = (req, res) => {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  const cfg = {
    apiKey:      process.env.FB_API_KEY || "",
    authDomain:  process.env.FB_AUTH_DOMAIN || "",
    databaseURL: process.env.FB_DB_URL || process.env.FIREBASE_DB_URL || "",
    projectId:   process.env.FB_PROJECT_ID || ""
  };
  res.status(200).send("window.FIREBASE_CONFIG=" + JSON.stringify(cfg) + ";");
};
