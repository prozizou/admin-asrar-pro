// api/content.js — Gestion des contenus PAGE PAR PAGE (Admin SDK, admins seulement).
const { app, verifyAdmin, audit, bearer } = require("./_lib/fb");

const NODES = {
  "db_sirr_deblocage":        { label: "Sirr — Déblocage",       page: "Secret Mystique", group: "Secrets" },
  "db_sirr_domptage":         { label: "Sirr — Domptage",        page: "Secret Mystique", group: "Secrets" },
  "db_sirr_ilham":            { label: "Sirr — Ilham",           page: "Secret Mystique", group: "Secrets" },
  "db_sirr_protection":       { label: "Sirr — Protection",      page: "Secret Mystique", group: "Secrets" },
  "db_sirr_ouverture":        { label: "Sirr — Ouverture",       page: "Secret Mystique", group: "Secrets" },
  "almaqtab":                 { label: "Almaqtab",               page: "Bibliothèque",     group: "Lettres" },
  "theme_fondamental":        { label: "Thème Fondamental",      page: "Calcul Numérique", group: "Calculs" },
  "sourate":                  { label: "Sourates & Propriétés",  page: "Coran",            group: "Coran" },
  "versetRef":                { label: "Versets Références",     page: "Coran",            group: "Coran" },
  "asmaUlHusna":              { label: "Noms Divins",            page: "Les 99 Noms",      group: "Coran" },
  "profile_clients":          { label: "Boutiques (profils)",    page: "Marché",           group: "Boutiques" }
};

// Clé Firebase valide : on accepte TOUT (espaces, accents, arabe, apostrophes…)
// SAUF les caractères réellement interdits par RTDB ( . # $ [ ] / ) et les
// caractères de contrôle. C'est ce qui débloque l'édition des clés héritées.
const BAD_KEY = /[.#$\[\]\/\u0000-\u001F\u007F]/;
const validKey = (k) => { const s = String(k ?? ""); return s.length > 0 && s.length <= 768 && !BAD_KEY.test(s); };

// Champs rendus tels quels comme URL (image <img src>, ou <a href> pour pdfUrl)
// par le panneau : un schéma non-http(s) (ex. javascript:) y serait exécuté au
// clic/affichage par un autre admin qui ouvre la fiche. On rejette tout ce qui
// n'est pas http(s) — même logique que pour les liens de groupe du planificateur.
const URLISH_FIELDS = ["image", "img", "imageUrl", "pdfUrl", "url"];
function unsafeUrlField(value) {
  if (!value || typeof value !== "object") return null;
  for (const f of URLISH_FIELDS) {
    const v = value[f];
    if (typeof v === "string" && v.trim() && !/^https?:\/\//i.test(v.trim())) return f;
  }
  return null;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });
  const body = typeof req.body === "object" && req.body ? req.body
             : (() => { try { return JSON.parse(req.body || "{}"); } catch { return {}; } })();
  const { idToken, action, node, key, value } = body;

  let who;
  try { who = await verifyAdmin(bearer(req) || idToken); }
  catch (e) { return res.status(e.statusCode || 401).json({ error: e.message }); }

  if (action === "nodes") return res.json({ nodes: NODES });

  if (!NODES[node]) return res.status(400).json({ error: "Nœud interdit ou inconnu" });

  const db = app().database();
  const base = db.ref(node);

  try {
    if (action === "list") {
      const snap = await base.once("value");
      return res.json({ node, value: snap.val() });
    }

    if (action === "get") {
      if (!validKey(key)) return res.status(400).json({ error: "Clé invalide" });
      const snap = await base.child(key).once("value");
      return res.json({ key, value: snap.val() });
    }

    if (action === "export") {
      const snap = await base.once("value");
      await audit(who, "export", node);
      return res.json({ node, value: snap.val() });
    }

    if (action === "set") {
      if (!validKey(key)) return res.status(400).json({ error: "Clé invalide" });
      if (value === undefined) return res.status(400).json({ error: "Valeur manquante" });
      const badField = unsafeUrlField(value);
      if (badField) return res.status(400).json({ error: `Champ « ${badField} » : lien invalide (doit commencer par http:// ou https://)` });
      await base.child(key).set(value);
      await audit(who, "set", node + "/" + key);
      return res.json({ ok: true });
    }

    if (action === "add") {
      const badField = unsafeUrlField(value);
      if (badField) return res.status(400).json({ error: `Champ « ${badField} » : lien invalide (doit commencer par http:// ou https://)` });
      const ref = await base.push(value === undefined ? {} : value);
      await audit(who, "add", node + "/" + ref.key);
      return res.json({ ok: true, key: ref.key });
    }

    if (action === "delete") {
      if (!validKey(key)) return res.status(400).json({ error: "Clé invalide" });
      const snap = await base.child(key).once("value");
      if (snap.exists()) {
        await db.ref("trash").push({ node, key, value: snap.val(), by: who.email, at: Date.now() });
      }
      await base.child(key).remove();
      await audit(who, "delete", node + "/" + key);
      return res.json({ ok: true });
    }

    if (action === "bulk_delete") {
      const keys = Array.isArray(body.keys) ? body.keys : [];
      if (!keys.length) return res.status(400).json({ error: "Aucun élément sélectionné" });
      let n = 0;
      for (const k of keys) {
        if (!validKey(k)) continue;
        const snap = await base.child(k).once("value");
        if (!snap.exists()) continue;
        await db.ref("trash").push({ node, key: k, value: snap.val(), by: who.email, at: Date.now() });
        await base.child(k).remove();
        n++;
      }
      await audit(who, "bulk_delete", node, n + " élément(s)");
      return res.json({ ok: true, count: n });
    }

    if (action === "move") {
      const keys = Array.isArray(body.keys) ? body.keys : [];
      const target = String(body.targetNode || "");
      if (!NODES[target]) return res.status(400).json({ error: "Nœud cible non autorisé" });
      if (target === node) return res.status(400).json({ error: "Le nœud cible doit être différent du nœud source" });
      if (!keys.length) return res.status(400).json({ error: "Aucun élément sélectionné" });
      const tref = db.ref(target);
      let n = 0;
      for (const k of keys) {
        if (!validKey(k)) continue;
        const snap = await base.child(k).once("value");
        if (!snap.exists()) continue;
        // Conserve la clé si elle est libre dans la cible, sinon en génère une nouvelle.
        let dest = k;
        if ((await tref.child(k).once("value")).exists()) dest = tref.push().key;
        await tref.child(dest).set(snap.val());
        await base.child(k).remove();
        n++;
      }
      await audit(who, "move", node + " → " + target, n + " élément(s)");
      return res.json({ ok: true, count: n });
    }

    return res.status(400).json({ error: "Action inconnue" });
  } catch (e) {
    return res.status(500).json({ error: "Erreur serveur : " + e.message });
  }
};

