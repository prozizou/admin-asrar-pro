// api/users.js — Gestion des utilisateurs (Admin SDK, admins seulement).
const { app, verifyAdmin, audit, emailToKey, SUPER_ADMIN } = require("./_lib/fb");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });
  const body = typeof req.body === "object" && req.body ? req.body
             : (() => { try { return JSON.parse(req.body || "{}"); } catch { return {}; } })();
  const { idToken, action, uid, email } = body;

  let who;
  try { who = await verifyAdmin(idToken); }
  catch (e) { return res.status(e.statusCode || 401).json({ error: e.message }); }

  const a = app(); 
  const db = a.database();

  try {
    if (action === "list") {
      const page = await a.auth().listUsers(1000);
      const [admins, vips] = await Promise.all([
        db.ref("admins").once("value").then((s) => s.val() || {}),
        db.ref("vip_users").once("value").then((s) => s.val() || {})
      ]);
      const users = page.users.map((u) => {
        const k = emailToKey(u.email || "");
        return {
          uid: u.uid, email: u.email || "(sans email)",
          created: u.metadata.creationTime, lastSeen: u.metadata.lastSignInTime,
          banned: !!u.disabled,
          isAdmin: u.email === SUPER_ADMIN || admins[k] === true,
          isSuper: u.email === SUPER_ADMIN,
          isVip: !!vips[u.uid]
        };
      });
      return res.json({ users, total: users.length });
    }

    if (!uid && !email) return res.status(400).json({ error: "uid ou email requis" });
    const target = uid ? await a.auth().getUser(uid) : await a.auth().getUserByEmail(email);
    const tEmail = target.email || "";
    const tKey = emailToKey(tEmail);

    if (tEmail === SUPER_ADMIN && ["ban", "admin_off"].includes(action))
      return res.status(403).json({ error: "Action impossible sur le super-admin" });
    if (action === "ban" && target.uid === who.uid)
      return res.status(403).json({ error: "Vous ne pouvez pas vous bannir vous-même" });

    if (action === "ban" || action === "unban") {
      const disabled = action === "ban";
      await a.auth().updateUser(target.uid, { disabled });
      if (disabled) await a.auth().revokeRefreshTokens(target.uid);
      await db.ref("banned/" + tKey).set(disabled ? { by: who.email, at: Date.now() } : null);
      await audit(who, action, tEmail);
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

