// _lib/fb.js — Init Firebase Admin + vérification ADMIN (cœur sécurité du panneau).
// Env requis (Vercel) : FIREBASE_SERVICE_ACCOUNT (JSON), FIREBASE_DB_URL.
const admin = require("firebase-admin");

const SUPER_ADMIN = "prozizou298@gmail.com";
const emailToKey = (e) => (e ? e.replace(/\./g, ",") : null);

function app() {
  if (!admin.apps.length) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
    admin.initializeApp({
      credential: admin.credential.cert(sa),
      databaseURL: process.env.FIREBASE_DB_URL
    });
  }
  return admin;
}

// Vérifie le jeton ET le statut admin (checkRevoked → un banni est rejeté immédiatement).
async function verifyAdmin(idToken) {
  if (!idToken) { const e = new Error("Jeton manquant"); e.statusCode = 401; throw e; }
  const a = app();
  let decoded;
  try { decoded = await a.auth().verifyIdToken(idToken, true); }
  catch { const e = new Error("Session invalide ou révoquée"); e.statusCode = 401; throw e; }
  const email = decoded.email;
  if (!email) { const e = new Error("Email requis"); e.statusCode = 403; throw e; }
  const isSuper = email === SUPER_ADMIN;
  if (!isSuper) {
    const snap = await a.database().ref("admins/" + emailToKey(email)).once("value");
    if (snap.val() !== true) { const e = new Error("Accès administrateur refusé"); e.statusCode = 403; throw e; }
  }
  return { uid: decoded.uid, email, isSuper };
}

// Journal d'audit : trace chaque action admin.
async function audit(by, action, target, details) {
  try {
    await app().database().ref("audit_log").push({
      by: by.email, action, target: target || null,
      details: details || null, at: Date.now()
    });
  } catch (e) { /* l'audit ne doit jamais bloquer l'action */ }
}

// Jeton d'accès OAuth du compte de service (pour les appels REST shallow du diagnostic).
async function accessToken() {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
  const t = await admin.credential.cert(sa).getAccessToken();
  return t.access_token;
}

module.exports = { app, verifyAdmin, audit, emailToKey, SUPER_ADMIN, accessToken };
