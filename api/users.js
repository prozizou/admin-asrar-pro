// api/users.js — Gestion des utilisateurs (Admin SDK, admins seulement).
const { app, verifyAdmin, audit, emailToKey, SUPER_ADMIN, bearer } = require("./_lib/fb");
const crypto = require("crypto");

// Email valide + normalisé (minuscules) — la clé RTDB doit correspondre à celle
// que le hub calcule à partir de l'email Google (toujours en minuscules).
const normEmail = (v) => {
  const e = String(v || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : "";
};
// Palier (FCFA) écrit dans purchased_user.level : le hub s'en sert pour les
// fonctionnalités gatées (téléchargement PDF ≥ 45 000, polices Al-Qalam).
// Sans ce champ, un accès accordé ici resterait au niveau 0 → PDF/polices bloqués.
const LEVELS = [15000, 25000, 45000, 999999];
const levelFor = (expiresAt) => {
  if (expiresAt === "lifetime") return 999999;
  const days = Math.round((expiresAt - Date.now()) / 864e5);
  if (days >= 365) return 45000;
  if (days >= 180) return 25000;
  return 15000;
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
  try { who = await verifyAdmin(bearer(req) || idToken); }
  catch (e) { return res.status(e.statusCode || 401).json({ error: e.message }); }

  const a = app(); 
  const db = a.database();

  try {
    if (action === "list") {
      const [admins, vips, purchased] = await Promise.all([
        db.ref("admins").once("value").then((s) => s.val() || {}),
        db.ref("vip_users").once("value").then((s) => s.val() || {}),
        db.ref("purchased_user").once("value").then((s) => s.val() || {})
      ]);
      // Pagination Auth : couvre TOUS les comptes, pas seulement les 1000 premiers.
      const users = [];
      let pageToken;
      do {
        const page = await a.auth().listUsers(1000, pageToken);
        for (const u of page.users) {
          const k = emailToKey((u.email || "").toLowerCase());
          const p = purchased[k];
          const active = subActive(p);
          users.push({
            uid: u.uid, email: u.email || "(sans email)",
            created: u.metadata.creationTime, lastSeen: u.metadata.lastSignInTime,
            banned: !!u.disabled,
            isAdmin: u.email === SUPER_ADMIN || admins[k] === true,
            isSuper: u.email === SUPER_ADMIN,
            isVip: !!vips[u.uid],
            subActive: active,
            subExpiresAt: p ? p.expiresAt : null,
            subLevel: p ? (p.level ?? null) : null,
            subSource: p ? (p.source || p.productId || "") : "",
            sub: active ? (p.expiresAt === "lifetime" ? "À vie"
                          : new Date(p.expiresAt).toLocaleDateString("fr-FR"))
                        : (p ? "expiré" : null)
          });
        }
        pageToken = page.pageToken;
      } while (pageToken);
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

      // MERGE (update) au lieu d'écraser : si un vrai achat existe déjà pour cet
      // e-mail, on préserve ses champs (token/productId/amount) et on ne modifie
      // que l'expiration + la traçabilité de l'octroi.
      // Palier : explicite (body.level) ou déduit de la durée accordée.
      const asked = Number(body.level);
      const level = LEVELS.includes(asked) ? asked : levelFor(expiresAt);

      const pref = db.ref("purchased_user/" + emailToKey(em));
      const cur = (await pref.once("value")).val() || {};
      await pref.update({
        token: cur.token || crypto.randomBytes(16).toString("hex"),
        productId: cur.productId || "admin_grant",
        amount: cur.amount ?? 0,
        level,
        label, grantedBy: who.email, at: Date.now(), expiresAt
      });
      await audit(who, "grant_access", em, label + " · palier " + level);
      return res.json({ ok: true, email: em, expiresAt, level });
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
          level: p.level ?? null,
          source: p.source || p.productId || "",
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

