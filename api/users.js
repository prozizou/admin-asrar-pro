// api/users.js — Gestion des utilisateurs (Admin SDK, admins seulement).
const { app, verifyAdmin, audit, emailToKey, SUPER_ADMIN } = require("./_lib/fb");
const crypto = require("crypto");

// Email valide + normalisé (minuscules) — la clé RTDB doit correspondre à celle
// que le hub calcule à partir de l'email Google (toujours en minuscules).
const normEmail = (v) => {
  const e = String(v || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : "";
};
// Un abonnement est ACTIF si "lifetime" ou si sa date d'expiration est dans le futur.
const subActive = (p) =>
  !!p && (p.expiresAt === "lifetime" ||
          (typeof p.expiresAt === "number" && p.expiresAt > Date.now()));

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
      const [admins, vips, purchased] = await Promise.all([
        db.ref("admins").once("value").then((s) => s.val() || {}),
        db.ref("vip_users").once("value").then((s) => s.val() || {}),
        db.ref("purchased_user").once("value").then((s) => s.val() || {})
      ]);
      const users = page.users.map((u) => {
        const k = emailToKey((u.email || "").toLowerCase());
        const p = purchased[k];
        const active = subActive(p);
        return {
          uid: u.uid, email: u.email || "(sans email)",
          created: u.metadata.creationTime, lastSeen: u.metadata.lastSignInTime,
          banned: !!u.disabled,
          isAdmin: u.email === SUPER_ADMIN || admins[k] === true,
          isSuper: u.email === SUPER_ADMIN,
          isVip: !!vips[u.uid],
          subActive: active,
          subExpiresAt: p ? p.expiresAt : null,
          sub: active ? (p.expiresAt === "lifetime" ? "À vie"
                        : new Date(p.expiresAt).toLocaleDateString("fr-FR"))
                      : (p ? "expiré" : null)
        };
      });
      return res.json({ users, total: users.length });
    }

    // ── ACCÈS PAR E-MAIL (abonnement manuel) ─────────────────────────────
    // Fonctionne même si l'utilisateur n'a PAS encore de compte : on écrit
    // directement purchased_user/{cléEmail}. Quand il se connectera avec cet
    // email, le hub lira cet accès. Passé expiresAt, le hub le rejette.
    if (action === "grant_access") {
      const em = normEmail(email);
      if (!em) return res.status(400).json({ error: "Email invalide." });

      let expiresAt, label;
      if (body.lifetime === true || body.expiresAt === "lifetime") {
        expiresAt = "lifetime"; label = "Accès à vie (admin)";
      } else if (typeof body.expiresAt === "number" && body.expiresAt > Date.now()) {
        expiresAt = body.expiresAt;
        label = "Accès jusqu'au " + new Date(expiresAt).toLocaleDateString("fr-FR");
      } else if (typeof body.days === "number" && body.days > 0) {
        expiresAt = Date.now() + body.days * 864e5;
        label = "Accès " + body.days + " jours (admin)";
      } else {
        return res.status(400).json({ error: "Date d'expiration (future) ou durée requise." });
      }

      await db.ref("purchased_user/" + emailToKey(em)).set({
        token: crypto.randomBytes(16).toString("hex"),
        productId: "admin_grant", label, amount: 0,
        grantedBy: who.email, at: Date.now(), expiresAt
      });
      await audit(who, "grant_access", em, label);
      return res.json({ ok: true, email: em, expiresAt });
    }

    if (action === "revoke_access") {
      const em = normEmail(email);
      if (!em) return res.status(400).json({ error: "Email invalide." });
      await db.ref("purchased_user/" + emailToKey(em)).remove();
      await audit(who, "revoke_access", em);
      return res.json({ ok: true, email: em });
    }

    if (action === "list_access") {
      const snap = await db.ref("purchased_user").once("value");
      const items = [];
      snap.forEach((c) => {
        const p = c.val() || {};
        items.push({
          email: String(c.key).replace(/,/g, "."),
          expiresAt: p.expiresAt ?? null,
          active: subActive(p),
          label: p.label || "",
          grantedBy: p.grantedBy || "",
          at: p.at || null
        });
      });
      // Actifs d'abord, puis par date d'expiration décroissante.
      items.sort((x, y) => (y.active - x.active) ||
        ((y.expiresAt === "lifetime" ? Infinity : y.expiresAt || 0) -
         (x.expiresAt === "lifetime" ? Infinity : x.expiresAt || 0)));
      return res.json({ items, total: items.length });
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

