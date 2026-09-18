// api/users.js — Accès premium par e-mail (Admin SDK, admins seulement).
const { app, verifyAdmin, audit, emailToKey, bearer } = require("./_lib/fb");
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

// Réduit un journal activity_feed brut à la dernière entrée par e-mail (clé en
// minuscules). Nettoyage minimal du libellé de page — pas la normalisation
// complète (accueil.html/accueil fusionnés, etc.) de stats.js « analytics » :
// ici on affiche UNE page pour un utilisateur donné, pas un classement agrégé.
function lastActivityByEmail(feedVal) {
  const out = {};
  for (const e of Object.values(feedVal || {})) {
    if (!e || typeof e !== "object" || !e.email) continue;
    const key = String(e.email).trim().toLowerCase();
    const at = e.at || 0;
    if (!out[key] || at > out[key].at) {
      const raw = String(e.page == null ? "" : e.page).trim();
      out[key] = { at, page: (!raw || raw === "?") ? "Page inconnue" : raw };
    }
  }
  return out;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });
  const body = typeof req.body === "object" && req.body ? req.body
             : (() => { try { return JSON.parse(req.body || "{}"); } catch { return {}; } })();
  const { idToken, action, email } = body;

  let who;
  try { who = await verifyAdmin(bearer(req) || idToken); }
  catch (e) { return res.status(e.statusCode || 401).json({ error: e.message }); }

  const db = app().database();

  try {
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

      // Un accès à vie ou de plus d'un an, gratuit et sans double validation,
      // est le vecteur de fraude interne le plus coûteux de cet endpoint (n'importe
      // quel admin — pas seulement le super-admin — pouvait sinon se l'accorder à
      // lui-même ou à un tiers). Réservé au super-admin ; les admins réguliers
      // restent limités à 1 an, ce qui couvre tous les paliers légitimes.
      const MAX_NON_SUPER_DAYS = 366;
      const isLongGrant = expiresAt === "lifetime" ||
        (typeof expiresAt === "number" && expiresAt - Date.now() > MAX_NON_SUPER_DAYS * 864e5);
      if (isLongGrant && !who.isSuper)
        return res.status(403).json({ error: "Accès à vie ou de plus d'un an : réservé au super-admin." });

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
      const [purchSnap, feedSnap] = await Promise.all([
        db.ref("purchased_user").once("value"),
        // Bornée (comme stats.js « analytics ») : juste de quoi retrouver la
        // dernière page visitée par chaque e-mail, pas un historique complet.
        db.ref("activity_feed").limitToLast(5000).once("value")
      ]);

      // Dernière activité connue par e-mail (page + horodatage) — un seul
      // passage sur le journal plutôt qu'une requête par utilisateur.
      const lastByEmail = lastActivityByEmail(feedSnap.val());

      const items = [];
      purchSnap.forEach((c) => {
        const p = c.val() || {};
        const email = String(c.key).replace(/,/g, ".");
        const last = lastByEmail[email.toLowerCase()];
        items.push({
          email,
          expiresAt: p.expiresAt ?? null,
          active: subActive(p),
          level: p.level ?? null,
          source: p.source || p.productId || "",
          label: p.label || "",
          grantedBy: p.grantedBy || "",
          at: p.at || null,
          lastPage: last ? last.page : null,
          lastActiveAt: last ? last.at : null
        });
      });
      // Actifs d'abord, puis par date d'expiration décroissante.
      items.sort((x, y) => (y.active - x.active) ||
        ((y.expiresAt === "lifetime" ? Infinity : y.expiresAt || 0) -
         (x.expiresAt === "lifetime" ? Infinity : x.expiresAt || 0)));
      return res.json({ items, total: items.length });
    }

    // ── Navigation d'un utilisateur (fiche détaillée) ────────────────────
    // Rejoue son passage dans l'app à partir du journal d'activité — même
    // source que Analytique « Flux d'activité récent », filtrée sur son e-mail.
    if (action === "activity_by_email") {
      const em = normEmail(email);
      if (!em) return res.status(400).json({ error: "Email invalide." });
      const feedSnap = await db.ref("activity_feed").limitToLast(5000).once("value");
      const feed = feedSnap.val() || {};
      const rows = Object.values(feed)
        .filter((e) => e && typeof e === "object" && String(e.email || "").toLowerCase() === em)
        .map((e) => ({ at: e.at || 0, page: e.page || "?", type: e.type || "?" }))
        .sort((a, b) => b.at - a.at)
        .slice(0, 30);
      return res.json({ email: em, rows });
    }

    return res.status(400).json({ error: "Action inconnue" });
  } catch (e) {
    return res.status(500).json({ error: "Erreur serveur : " + e.message });
  }
};

