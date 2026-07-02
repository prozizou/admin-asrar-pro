// api/users.js — Gestion des utilisateurs (Admin SDK, admins seulement).
// POST { idToken, action, uid?, email?, productId? }
//   list        → comptes Firebase Auth + statuts (admin/vip/abonné/banni)
//   ban / unban → désactive le COMPTE Auth + révoque les jetons (bannissement réel)
//   grant       → offre un abonnement (sub_3m/sub_6m/sub_1y/sub_life)
//   revoke      → retire l'abonnement
//   admin_on / admin_off  → SUPER-ADMIN uniquement
//   vip_on / vip_off
const { app, verifyAdmin, audit, emailToKey, SUPER_ADMIN } = require("./_lib/fb");
const crypto = require("crypto");

const DUR_MS = { sub_3m: 92 * 864e5, sub_6m: 183 * 864e5, sub_1y: 366 * 864e5 };
const LABELS = { sub_3m: "3 Mois (offert)", sub_6m: "6 Mois (offert)", sub_1y: "1 An (offert)", sub_life: "À vie (offert)" };

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });
  const body = typeof req.body === "object" && req.body ? req.body
             : (() => { try { return JSON.parse(req.body || "{}"); } catch { return {}; } })();
  const { idToken, action, uid, email, productId } = body;

  let who;
  try { who = await verifyAdmin(idToken); }
  catch (e) { return res.status(e.statusCode || 401).json({ error: e.message }); }

  const a = app(); const db = a.database();

  try {
    if (action === "list") {
      // Comptes Auth (jusqu'à 1000 ; pagination possible plus tard).
      const page = await a.auth().listUsers(1000);
      const [admins, vips, purchased] = await Promise.all([
        db.ref("admins").once("value").then((s) => s.val() || {}),
        db.ref("vip_users").once("value").then((s) => s.val() || {}),
        db.ref("purchased_user").once("value").then((s) => s.val() || {})
      ]);
      const users = page.users.map((u) => {
        const k = emailToKey(u.email || "");
        const p = purchased[k];
        const active = !!p && (p.expiresAt === "lifetime" || p.expiresAt == null ||
                       (typeof p.expiresAt === "number" && p.expiresAt > Date.now()));
        return {
          uid: u.uid, email: u.email || "(sans email)",
          created: u.metadata.creationTime, lastSeen: u.metadata.lastSignInTime,
          banned: !!u.disabled,
          isAdmin: u.email === SUPER_ADMIN || admins[k] === true,
          isSuper: u.email === SUPER_ADMIN,
          isVip: !!vips[u.uid],
          sub: active ? (p.expiresAt === "lifetime" ? "À vie" : new Date(p.expiresAt).toLocaleDateString("fr-FR")) : null
        };
      });
      return res.json({ users, total: users.length });
    }

    // Toutes les actions suivantes ciblent un utilisateur.
    if (!uid && !email) return res.status(400).json({ error: "uid ou email requis" });
    const target = uid ? await a.auth().getUser(uid) : await a.auth().getUserByEmail(email);
    const tEmail = target.email || "";
    const tKey = emailToKey(tEmail);

    // Garde-fous : jamais contre le super-admin ; pas d'auto-bannissement.
    if (tEmail === SUPER_ADMIN && ["ban", "admin_off", "revoke"].includes(action))
      return res.status(403).json({ error: "Action impossible sur le super-admin" });
    if (action === "ban" && target.uid === who.uid)
      return res.status(403).json({ error: "Vous ne pouvez pas vous bannir vous-même" });

    if (action === "ban" || action === "unban") {
      const disabled = action === "ban";
      await a.auth().updateUser(target.uid, { disabled });
      if (disabled) await a.auth().revokeRefreshTokens(target.uid); // déconnexion ≤ 1 h partout
      await db.ref("banned/" + tKey).set(disabled ? { by: who.email, at: Date.now() } : null);
      await audit(who, action, tEmail);
      return res.json({ ok: true });
    }

    if (action === "grant") {
      if (!LABELS[productId]) return res.status(400).json({ error: "Offre inconnue" });
      const expiresAt = productId === "sub_life" ? "lifetime" : Date.now() + DUR_MS[productId];
      await db.ref("purchased_user/" + tKey).set({
        token: crypto.randomBytes(16).toString("hex"),
        productId, label: LABELS[productId], amount: 0,
        grantedBy: who.email, at: Date.now(), expiresAt
      });
      await audit(who, "grant", tEmail, LABELS[productId]);
      return res.json({ ok: true });
    }

    if (action === "revoke") {
      await db.ref("purchased_user/" + tKey).remove();
      await audit(who, "revoke", tEmail);
      return res.json({ ok: true });
    }

    if (action === "admin_on" || action === "admin_off") {
      if (!who.isSuper) return res.status(403).json({ error: "Réservé au super-admin" });
      await db.ref("admins/" + tKey).set(action === "admin_on" ? true : null);
      await audit(who, action, tEmail);
      return res.json({ ok: true });
    }

    if (action === "vip_on" || action === "vip_off") {
      await db.ref("vip_users/" + target.uid)
        .set(action === "vip_on" ? { email: tEmail, by: who.email, at: Date.now() } : null);
      await audit(who, action, tEmail);
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: "Action inconnue" });
  } catch (e) {
    return res.status(500).json({ error: "Erreur serveur : " + e.message });
  }
};
