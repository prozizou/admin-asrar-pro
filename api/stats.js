// api/stats.js — Réglages et Logs d'audits (Admin SDK, admins seulement).
const { app, verifyAdmin, audit } = require("./_lib/fb");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });
  const body = typeof req.body === "object" && req.body ? req.body
             : (() => { try { return JSON.parse(req.body || "{}"); } catch { return {}; } })();
  const { idToken, action } = body;

  let who;
  try { who = await verifyAdmin(idToken); }
  catch (e) { return res.status(e.statusCode || 401).json({ error: e.message }); }

  const db = app().database();

  try {
    if (action === "audit") {
      const snap = await db.ref("audit_log").limitToLast(100).once("value");
      const rows = [];
      snap.forEach((c) => rows.push(c.val()));
      rows.reverse();
      return res.json({ rows });
    }

    if (action === "config_get") {
      const snap = await db.ref("config").once("value");
      return res.json({ config: snap.val() || {} });
    }

    if (action === "config_set") {
      const c = body.config || {};
      await db.ref("config").update({
        maintenance: !!c.maintenance,
        announcement: String(c.announcement || "").slice(0, 300),
        updatedBy: who.email, updatedAt: Date.now()
      });
      await audit(who, "config_set", null, JSON.stringify(c).slice(0, 200));
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: "Action inconnue" });
  } catch (e) {
    return res.status(500).json({ error: "Erreur serveur : " + e.message });
  }
};

