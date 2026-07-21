// api/fonts.js — Gestion des POLICES Al-Qalam (Admin SDK, admins seulement).
// Les polices sont stockées sous le nœud `alqalam_fonts/{id}` et consommées par
// le module Al-Qalam du hub. Le fichier de police lui-même est hébergé sur
// Cloudinary (upload signé, resource_type=raw) ; ici on ne stocke que la fiche.
const { app, verifyAdmin, audit, bearer } = require("./_lib/fb");

// family CSS unique, sûre (sans espaces/accents) dérivée du nom + suffixe court.
function toFamily(name, id) {
  const base = String(name || "police")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .slice(0, 24) || "Police";
  return base + "_" + String(id).slice(-4);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });
  const body = typeof req.body === "object" && req.body ? req.body
             : (() => { try { return JSON.parse(req.body || "{}"); } catch { return {}; } })();
  const { idToken, action } = body;

  let who;
  try { who = await verifyAdmin(bearer(req) || idToken); }
  catch (e) { return res.status(e.statusCode || 401).json({ error: e.message }); }

  const db = app().database();
  const ref = db.ref("alqalam_fonts");

  try {
    if (action === "list") {
      const snap = await ref.once("value");
      const val = snap.val() || {};
      const fonts = Object.entries(val).map(([id, f]) => ({ id, ...f }))
        .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      return res.json({ fonts });
    }

    if (action === "save") {
      const f = body.font || {};
      const name = String(f.name || "").trim();
      const url = String(f.url || "").trim();
      if (!name) return res.status(400).json({ error: "Nom de police requis." });
      if (!url) return res.status(400).json({ error: "Fichier de police (URL Cloudinary) requis." });
      if (!/^https:\/\//.test(url)) return res.status(400).json({ error: "URL de police invalide." });

      const id = f.id && String(f.id).trim() ? String(f.id).trim() : ("f" + Date.now().toString(36));
      const level = Number.isFinite(+f.level) ? Math.max(0, Math.round(+f.level)) : 45000;
      const rec = {
        name,
        family: f.family && String(f.family).trim() ? String(f.family).trim() : toFamily(name, id),
        url,
        publicId: String(f.publicId || ""),
        level,                                   // palier d'abonnement (FCFA) requis
        enabled: f.enabled === false ? false : true,
        updatedBy: who.email,
        updatedAt: Date.now()
      };
      if (!f.id) rec.createdAt = Date.now();

      await ref.child(id).update(rec);
      await audit(who, f.id ? "font_update" : "font_add", id, name + " · niveau " + level);
      return res.json({ ok: true, id, font: { id, ...rec } });
    }

    if (action === "delete") {
      const id = String(body.id || "").trim();
      if (!id) return res.status(400).json({ error: "Identifiant de police manquant." });
      const snap = await ref.child(id).once("value");
      const prev = snap.val();
      if (prev) await db.ref("trash/alqalam_fonts/" + id).set({ ...prev, deletedBy: who.email, deletedAt: Date.now() });
      await ref.child(id).remove();
      await audit(who, "font_delete", id, prev ? prev.name : "");
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: "Action inconnue" });
  } catch (e) {
    return res.status(500).json({ error: "Erreur serveur : " + e.message });
  }
};
