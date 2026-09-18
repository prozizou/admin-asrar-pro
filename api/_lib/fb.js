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

// Liste TOUS les comptes Auth (pagination complète), avec un cache mémoire
// très court (30 s par défaut) : users.js ET stats.js paginent chacun tous les
// comptes à chaque chargement d'onglet, ce qui devient coûteux (et risque le
// timeout d'une fonction serverless) à mesure que la base d'utilisateurs
// grossit. Le cache ne profite qu'aux invocations qui retombent sur la même
// instance "chaude" (best-effort, jamais partagé entre fonctions/instances
// froides) — TTL volontairement court pour ne jamais servir des bans/inscriptions
// périmés plus d'une demi-minute.
let _usersCache = null; // { at, users }
async function listAllAuthUsers(a, ttlMs = 30000) {
  if (_usersCache && Date.now() - _usersCache.at < ttlMs) return _usersCache.users;
  const users = [];
  let pageToken;
  do {
    const page = await a.auth().listUsers(1000, pageToken);
    users.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  _usersCache = { at: Date.now(), users };
  return users;
}
// À appeler après toute mutation Auth (ban/unban) pour ne jamais servir un
// statut périmé au prochain "list" — les autres mutations (admin/VIP) touchent
// uniquement la RTDB, lue en direct par users.js, donc n'ont pas besoin d'invalider.
function invalidateUsersCache() { _usersCache = null; }

// Jeton d'accès OAuth du compte de service (pour les appels REST shallow du diagnostic).
async function accessToken() {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
  const t = await admin.credential.cert(sa).getAccessToken();
  return t.access_token;
}

// Extrait le jeton de l'en-tête « Authorization: Bearer <token> » (standard).
// Les endpoints le privilégient et retombent sur body.idToken (compat ascendante).
function bearer(req) {
  const h = (req && req.headers && (req.headers.authorization || req.headers.Authorization)) || "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : null;
}

module.exports = { app, verifyAdmin, audit, emailToKey, SUPER_ADMIN, accessToken, bearer, listAllAuthUsers, invalidateUsersCache };
