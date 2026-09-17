// api/content.js — Gestion des contenus PAGE PAR PAGE (Admin SDK, admins seulement).
// Firestore — mêmes collections que asrar-main (docs/FIRESTORE_SCHEMA.md) :
// une collection par nœud, SAUF theme_fondamental qui est devenu un DOC
// UNIQUE (config/geomancie_theme_fondamental) portant un champ items[] —
// pas une collection — voir les helpers themeXxx() plus bas.
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
  "profile_clients":          { label: "Boutiques (profils)",    page: "Marché",           group: "Boutiques" },
  // Schéma réel (server/sources.js → SOURCES.formation, côté asrar-main) :
  // { titre, description, attentes, duree, prix, pricePerMinute, img, meetLink }
  // — PAS title/content/images (les champs de l'éditeur générique) : utiliser
  // le créateur dédié (bouton « Formation », admin-content.js
  // openFormationCreator) pour écrire les bons noms de champs. L'éditeur
  // générique préserve les champs existants d'un enregistrement (titre/
  // description/…) même s'il ne les affiche plus individuellement — voir
  // openEditor, admin-content.js.
  // pricePerMinute (FCFA) : tarif du réservateur de minutes de visioconférence
  // (indépendant de l'abonnement — voir api/formation-access.js, formation_access/…).
  "formations":               { label: "Formations",             page: "Formation mystique", group: "Formations" }
};

// Nœud → collection Firestore (theme_fondamental exclu, voir plus haut).
const FS_COLLECTION = {
  db_sirr_deblocage: "secrets_deblocage",
  db_sirr_domptage: "secrets_domptage",
  db_sirr_ilham: "secrets_ilham",
  db_sirr_protection: "secrets_protection",
  db_sirr_ouverture: "secrets_ouverture",
  almaqtab: "books",
  sourate: "sourate",
  versetRef: "verset_refs",
  asmaUlHusna: "asma_ul_husna",
  profile_clients: "shop_profiles",
  formations: "formations"
};
const THEME_NODE = "theme_fondamental";

// Clé Firebase valide : on accepte TOUT (espaces, accents, arabe, apostrophes…)
// SAUF les caractères réellement interdits par RTDB ( . # $ [ ] / ) et les
// caractères de contrôle — un sur-ensemble strictement plus restrictif que ce
// qu'exige un ID de document Firestore (qui n'interdit que "/" et quelques cas
// réservés), donc toute ancienne clé héritée de la RTDB reste valide ici.
const BAD_KEY = /[.#$\[\]\/\u0000-\u001F\u007F]/;
const validKey = (k) => { const s = String(k ?? ""); return s.length > 0 && s.length <= 768 && !BAD_KEY.test(s); };

// Champs rendus tels quels comme URL (image <img src>, ou <a href> pour pdfUrl)
// par le panneau : un schéma non-http(s) (ex. javascript:) y serait exécuté au
// clic/affichage par un autre admin qui ouvre la fiche. On rejette tout ce qui
// n'est pas http(s) — même logique que pour les liens de groupe du planificateur.
const URLISH_FIELDS = ["image", "img", "imageUrl", "pdfUrl", "url", "meetLink"];
function unsafeUrlField(value) {
  if (!value || typeof value !== "object") return null;
  for (const f of URLISH_FIELDS) {
    const v = value[f];
    if (typeof v === "string" && v.trim() && !/^https?:\/\//i.test(v.trim())) return f;
  }
  return null;
}

// ── theme_fondamental : doc unique config/geomancie_theme_fondamental,
// champ items[] — les actions génériques (list/get/set/add/delete/…)
// retombent sur ces helpers au lieu d'une collection.
function themeRef(firestore) { return firestore.collection("config").doc("geomancie_theme_fondamental"); }
async function themeItems(firestore) {
  const snap = await themeRef(firestore).get();
  const items = snap.exists && Array.isArray(snap.data().items) ? snap.data().items : [];
  return items;
}
function themeIndex(key) {
  const n = Number(key);
  return Number.isInteger(n) && n >= 0 ? n : null;
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

  const firestore = app().firestore();
  const isTheme = node === THEME_NODE;
  const col = isTheme ? null : firestore.collection(FS_COLLECTION[node]);

  try {
    if (action === "list") {
      if (isTheme) return res.json({ node, value: await themeItems(firestore) });
      const snap = await col.get();
      const out = {};
      snap.forEach((d) => { out[d.id] = d.data(); });
      return res.json({ node, value: out });
    }

    if (action === "get") {
      if (!validKey(key)) return res.status(400).json({ error: "Clé invalide" });
      if (isTheme) {
        const idx = themeIndex(key);
        const items = await themeItems(firestore);
        return res.json({ key, value: idx != null ? (items[idx] ?? null) : null });
      }
      const snap = await col.doc(key).get();
      return res.json({ key, value: snap.exists ? snap.data() : null });
    }

    if (action === "export") {
      let value;
      if (isTheme) {
        value = await themeItems(firestore);
      } else {
        const snap = await col.get();
        value = {};
        snap.forEach((d) => { value[d.id] = d.data(); });
      }
      await audit(who, "export", node);
      return res.json({ node, value });
    }

    if (action === "set") {
      if (!validKey(key)) return res.status(400).json({ error: "Clé invalide" });
      if (value === undefined) return res.status(400).json({ error: "Valeur manquante" });
      const badField = unsafeUrlField(value);
      if (badField) return res.status(400).json({ error: `Champ « ${badField} » : lien invalide (doit commencer par http:// ou https://)` });
      if (isTheme) {
        const idx = themeIndex(key);
        if (idx == null) return res.status(400).json({ error: "Index invalide" });
        const items = await themeItems(firestore);
        if (idx > items.length) return res.status(400).json({ error: "Index hors limites" });
        items[idx] = value;
        await themeRef(firestore).set({ items }, { merge: true });
      } else {
        await col.doc(key).set(value);
      }
      await audit(who, "set", node + "/" + key);
      return res.json({ ok: true });
    }

    if (action === "add") {
      const badField = unsafeUrlField(value);
      if (badField) return res.status(400).json({ error: `Champ « ${badField} » : lien invalide (doit commencer par http:// ou https://)` });
      if (isTheme) {
        const items = await themeItems(firestore);
        items.push(value === undefined ? {} : value);
        await themeRef(firestore).set({ items }, { merge: true });
        const newKey = String(items.length - 1);
        await audit(who, "add", node + "/" + newKey);
        return res.json({ ok: true, key: newKey });
      }
      const ref = col.doc();
      await ref.set(value === undefined ? {} : value);
      await audit(who, "add", node + "/" + ref.id);
      return res.json({ ok: true, key: ref.id });
    }

    if (action === "delete") {
      if (!validKey(key)) return res.status(400).json({ error: "Clé invalide" });
      if (isTheme) {
        const idx = themeIndex(key);
        const items = await themeItems(firestore);
        if (idx != null && idx < items.length) {
          await firestore.collection("trash").add({ node, key, value: items[idx], by: who.email, at: Date.now() });
          items.splice(idx, 1);
          await themeRef(firestore).set({ items }, { merge: true });
        }
        await audit(who, "delete", node + "/" + key);
        return res.json({ ok: true });
      }
      const ref = col.doc(key);
      const snap = await ref.get();
      if (snap.exists) {
        await firestore.collection("trash").add({ node, key, value: snap.data(), by: who.email, at: Date.now() });
      }
      await ref.delete();
      await audit(who, "delete", node + "/" + key);
      return res.json({ ok: true });
    }

    if (action === "bulk_delete") {
      const keys = Array.isArray(body.keys) ? body.keys : [];
      if (!keys.length) return res.status(400).json({ error: "Aucun élément sélectionné" });
      let n = 0;
      if (isTheme) {
        const items = await themeItems(firestore);
        // Indices triés décroissants : on retire de la fin vers le début pour
        // ne pas décaler les index restant à traiter dans la même passe.
        const idxs = keys.map(themeIndex).filter((i) => i != null && i < items.length).sort((a, b) => b - a);
        for (const idx of idxs) {
          await firestore.collection("trash").add({ node, key: String(idx), value: items[idx], by: who.email, at: Date.now() });
          items.splice(idx, 1);
          n++;
        }
        if (n) await themeRef(firestore).set({ items }, { merge: true });
      } else {
        for (const k of keys) {
          if (!validKey(k)) continue;
          const ref = col.doc(k);
          const snap = await ref.get();
          if (!snap.exists) continue;
          await firestore.collection("trash").add({ node, key: k, value: snap.data(), by: who.email, at: Date.now() });
          await ref.delete();
          n++;
        }
      }
      await audit(who, "bulk_delete", node, n + " élément(s)");
      return res.json({ ok: true, count: n });
    }

    if (action === "move") {
      if (isTheme) return res.status(400).json({ error: "Ce nœud ne peut pas être déplacé." });
      const keys = Array.isArray(body.keys) ? body.keys : [];
      const target = String(body.targetNode || "");
      if (!NODES[target]) return res.status(400).json({ error: "Nœud cible non autorisé" });
      if (target === node) return res.status(400).json({ error: "Le nœud cible doit être différent du nœud source" });
      if (target === THEME_NODE) return res.status(400).json({ error: "Ce nœud cible ne peut pas recevoir d'éléments déplacés." });
      if (!keys.length) return res.status(400).json({ error: "Aucun élément sélectionné" });
      const tcol = firestore.collection(FS_COLLECTION[target]);
      let n = 0;
      for (const k of keys) {
        if (!validKey(k)) continue;
        const ref = col.doc(k);
        const snap = await ref.get();
        if (!snap.exists) continue;
        // Conserve la clé si elle est libre dans la cible, sinon en génère une nouvelle.
        let dest = k;
        if ((await tcol.doc(k).get()).exists) dest = tcol.doc().id;
        await tcol.doc(dest).set(snap.data());
        await ref.delete();
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
