// api/content.js — Gestion des contenus PAGE PAR PAGE (Admin SDK, admins seulement).
// POST { idToken, action, node, key?, value? }
//   action: "nodes" | "list" | "get" | "set" | "add" | "delete" | "export"
//
// SÉCURITÉ : liste blanche stricte des nœuds éditables. Les nœuds de droits
// (purchased_user, admins, vip_users…) ne sont PAS éditables ici : ils passent
// par /api/users.js avec leurs garde-fous dédiés.
const { app, verifyAdmin, audit } = require("./_lib/fb");

// Nœud → page de l'application concernée + groupe (affichés dans l'interface).
const NODES = {
  "db_sirr_deblocage":        { label: "Sirr — Déblocage",       page: "Secret Mystique", group: "Secrets" },
  "db_sirr_domptage":         { label: "Sirr — Domptage",        page: "Secret Mystique", group: "Secrets" },
  "db_sirr_ilham":            { label: "Sirr — Ilham",           page: "Secret Mystique", group: "Secrets" },
  "db_sirr_protection":       { label: "Sirr — Protection",      page: "Secret Mystique", group: "Secrets" },
  "db_sirr_ouverture":        { label: "Sirr — Ouverture",       page: "Secret Mystique", group: "Secrets" },
  "almaqtab":                 { label: "Almaqtab",               page: "Bibliothèque",    group: "Documents" },
  "theme_fondamental":        { label: "Thèmes fondamentaux",    page: "Bibliothèque",    group: "Documents" },
  "sourate":                  { label: "Sourates",               page: "Hub / Al-Qalam",  group: "Documents" },
  "versetRef":                { label: "Versets de référence",   page: "Rouwhanes",       group: "Documents" },
  "data/appData/asmaUlHusna": { label: "Noms d'Allah (99)",      page: "Benefits + Rouwhanes", group: "Noms d'Allah" },
  "appData":                  { label: "Données générales",      page: "Hub",             group: "Système" },
  "det_produits":             { label: "Produits (marché)",      page: "Marché mystique", group: "Marché" },
  "comments":                 { label: "Commentaires (modération)", page: "Toutes pages", group: "Modération" },
  "ratings":                  { label: "Notes (modération)",     page: "Toutes pages",    group: "Modération" },
  "config":                   { label: "Config (maintenance/annonce)", page: "Globale" }
};

// Clé RTDB valide (pas de traversée via ../ ni caractères interdits).
const SAFE_KEY = /^[^.#$\[\]\/\x00-\x1F]{1,200}(\/[^.#$\[\]\/\x00-\x1F]{1,200}){0,3}$/;

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });
  const body = typeof req.body === "object" && req.body ? req.body
             : (() => { try { return JSON.parse(req.body || "{}"); } catch { return {}; } })();
  const { idToken, action, node, key, value } = body;

  let who;
  try { who = await verifyAdmin(idToken); }
  catch (e) { return res.status(e.statusCode || 401).json({ error: e.message }); }

  if (action === "nodes") return res.json({ nodes: NODES });

  if (!NODES[node]) return res.status(400).json({ error: "Nœud non autorisé" });
  const db = app().database();
  const base = db.ref(node);

  try {
    if (action === "list") {
      // Liste des clés + aperçu court (évite de télécharger des nœuds énormes).
      const snap = await base.limitToFirst(500).once("value");
      const out = [];
      snap.forEach((c) => {
        const v = c.val();
        let preview = "", img = "";
        if (v && typeof v === "object") {
          preview = v.name || v.title || v.titre || v.label || v.verset || Object.keys(v).slice(0, 4).join(", ");
          const cand = v.image || v.img || v.url || v.imageUrl || "";
          if (typeof cand === "string" && /^https?:\/\//.test(cand)) img = cand;
        } else preview = String(v);
        out.push({ key: c.key, preview: String(preview).slice(0, 90), img });
      });
      return res.json({ items: out, count: out.length });
    }

    if (action === "get") {
      if (!SAFE_KEY.test(String(key || ""))) return res.status(400).json({ error: "Clé invalide" });
      const snap = await base.child(key).once("value");
      return res.json({ key, value: snap.val() });
    }

    if (action === "export") {
      const snap = await base.once("value");
      await audit(who, "export", node);
      return res.json({ node, value: snap.val() });
    }

    if (action === "set") {
      if (!SAFE_KEY.test(String(key || ""))) return res.status(400).json({ error: "Clé invalide" });
      if (value === undefined) return res.status(400).json({ error: "Valeur manquante" });
      await base.child(key).set(value);
      await audit(who, "set", node + "/" + key);
      return res.json({ ok: true });
    }

    if (action === "add") {
      const ref = await base.push(value === undefined ? {} : value);
      await audit(who, "add", node + "/" + ref.key);
      return res.json({ ok: true, key: ref.key });
    }

    if (action === "delete") {
      if (!SAFE_KEY.test(String(key || ""))) return res.status(400).json({ error: "Clé invalide" });
      // Filet de sécurité : copie de l'élément supprimé dans la corbeille (30 j).
      const snap = await base.child(key).once("value");
      if (snap.exists()) {
        await db.ref("trash").push({ node, key, value: snap.val(), by: who.email, at: Date.now() });
      }
      await base.child(key).remove();
      await audit(who, "delete", node + "/" + key);
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: "Action inconnue" });
  } catch (e) {
    return res.status(500).json({ error: "Erreur serveur : " + e.message });
  }
};
