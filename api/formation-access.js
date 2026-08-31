// api/formation-access.js — Minutes de visioconférence "Formation mystique"
// par formation + e-mail (Admin SDK, admins seulement).
//
// INDÉPENDANT de l'accès premium général (api/users.js, purchased_user) :
// décision explicite — abonné ou non, chacun paie séparément ses minutes de
// visioconférence pour CHAQUE formation. L'utilisateur réserve via WhatsApp
// (asrar-main, lib/whatsapp.js openFormationBooking) puis l'admin accorde
// manuellement le crédit ici. Stockage : formation_access/{formationKey}/
// {emailKey} = { minutes, email, grantedBy, grantedAt } — même clé e-mail
// (emailToKey, '.'→',') que purchased_user, lue côté asrar-main par
// pages/api/formation-access.js ("check"/"join", qui consomme le crédit à la
// connexion — usage unique par réservation, l'admin recrédite ensuite pour
// la session suivante).
const { app, verifyAdmin, audit, emailToKey, bearer } = require("./_lib/fb");

const normEmail = (v) => {
  const e = String(v || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : "";
};

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });
  const body = typeof req.body === "object" && req.body ? req.body
             : (() => { try { return JSON.parse(req.body || "{}"); } catch { return {}; } })();
  const { idToken, action, formationKey, email, minutes } = body;

  let who;
  try { who = await verifyAdmin(bearer(req) || idToken); }
  catch (e) { return res.status(e.statusCode || 401).json({ error: e.message }); }

  const db = app().database();

  try {
    if (action === "grant_minutes") {
      const em = normEmail(email);
      if (!em) return res.status(400).json({ error: "E-mail invalide" });
      if (!formationKey) return res.status(400).json({ error: "Formation non précisée" });
      const m = Number(minutes);
      if (!(m > 0)) return res.status(400).json({ error: "Nombre de minutes invalide" });
      await db.ref("formation_access/" + formationKey + "/" + emailToKey(em)).set({
        minutes: m, email: em, grantedBy: who.email, grantedAt: Date.now()
      });
      await audit(who, "grant_formation_minutes", formationKey + " / " + em, m + " min");
      return res.json({ ok: true });
    }

    if (action === "revoke_minutes") {
      const em = normEmail(email);
      if (!em) return res.status(400).json({ error: "E-mail invalide" });
      if (!formationKey) return res.status(400).json({ error: "Formation non précisée" });
      await db.ref("formation_access/" + formationKey + "/" + emailToKey(em)).remove();
      await audit(who, "revoke_formation_minutes", formationKey + " / " + em);
      return res.json({ ok: true });
    }

    if (action === "list_minutes") {
      const snap = await db.ref("formation_access" + (formationKey ? "/" + formationKey : "")).once("value");
      const val = snap.val() || {};
      const items = [];
      if (formationKey) {
        for (const ek in val) items.push({ formationKey, ...val[ek] });
      } else {
        for (const fk in val) for (const ek in val[fk]) items.push({ formationKey: fk, ...val[fk][ek] });
      }
      items.sort((a, b) => (b.grantedAt || 0) - (a.grantedAt || 0));
      return res.json({ items, total: items.length });
    }

    return res.status(400).json({ error: "Action inconnue" });
  } catch (e) {
    return res.status(500).json({ error: "Erreur serveur : " + e.message });
  }
};
