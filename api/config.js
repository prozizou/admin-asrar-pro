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

  res.status(200).send("window.FIREBASE_CONFIG=" + JSON.stringify(cfg) + ";");
};

