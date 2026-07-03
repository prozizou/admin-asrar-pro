// api/market.js — Gestion du MARCHÉ (boutiques & produits) — admins seulement.
// Boutiques : sellers/{uid} = { shopActive, expiresAt, shop:{name}, email }.
// Produits  : det_produits/{key} = { produit, Prix, devise, Image, uid, vendeur }.
// « Révoquer » met la boutique inactive ET déplace ses produits vers
// det_produits_bloques/{key} (donc invisibles/invendables sur le hub, qui lit
// det_produits). « Restaurer » les remet en ligne. Rien n'est perdu.
const { app, verifyAdmin, audit } = require("./_lib/fb");

const LIVE = "det_produits";
const BLOCKED = "det_produits_bloques";

const shopName = (s) => (s && s.shop && s.shop.name) || (s && s.vendeur) || (s && s.name) || "Boutique";
const isActive = (s) => !!(s && s.shopActive &&
  (s.expiresAt === "lifetime" || (typeof s.expiresAt === "number" && s.expiresAt > Date.now())));
const isExpired = (s) => !!(s && typeof s.expiresAt === "number" && s.expiresAt <= Date.now());

// Déplace tous les produits d'un vendeur d'un nœud vers un autre. Renvoie le nombre.
async function moveProducts(db, uid, fromNode, toNode) {
  const snap = await db.ref(fromNode).once("value");
  const updates = {};
  let n = 0;
  snap.forEach((c) => {
    const p = c.val();
    if (p && p.uid === uid) {
      updates[fromNode + "/" + c.key] = null;         // retire de la source
      updates[toNode + "/" + c.key] = p;              // ajoute à la cible (même clé)
      n++;
    }
  });
  if (n) await db.ref().update(updates);
  return n;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });
  const body = typeof req.body === "object" && req.body ? req.body
             : (() => { try { return JSON.parse(req.body || "{}"); } catch { return {}; } })();
  const { idToken, action, uid } = body;

  let who;
  try { who = await verifyAdmin(idToken); }
  catch (e) { return res.status(e.statusCode || 401).json({ error: e.message }); }

  const db = app().database();

  try {
    if (action === "list") {
      const [sellersSnap, liveSnap, blockedSnap] = await Promise.all([
        db.ref("sellers").once("value"),
        db.ref(LIVE).once("value"),
        db.ref(BLOCKED).once("value")
      ]);
      const sellers = sellersSnap.val() || {};

      const liveCount = {}, blockedCount = {};
      const products = [];
      liveSnap.forEach((c) => {
        const p = c.val() || {};
        liveCount[p.uid] = (liveCount[p.uid] || 0) + 1;
        products.push({ key: c.key, name: p.produit || "Produit", price: p.Prix || 0,
          devise: p.devise || "FCFA", image: p.Image || "", uid: p.uid || "", vendeur: p.vendeur || "", blocked: false });
      });
      blockedSnap.forEach((c) => {
        const p = c.val() || {};
        blockedCount[p.uid] = (blockedCount[p.uid] || 0) + 1;
        products.push({ key: c.key, name: p.produit || "Produit", price: p.Prix || 0,
          devise: p.devise || "FCFA", image: p.Image || "", uid: p.uid || "", vendeur: p.vendeur || "", blocked: true });
      });

      const shops = Object.entries(sellers).map(([id, s]) => ({
        uid: id, name: shopName(s), email: s.email || "",
        expiresAt: s.expiresAt ?? null, active: isActive(s), expired: isExpired(s),
        products: liveCount[id] || 0, blockedProducts: blockedCount[id] || 0
      }));
      shops.sort((a, b) => (a.expired - b.expired) || a.name.localeCompare(b.name));

      return res.json({ shops, products, totalShops: shops.length, totalProducts: products.length });
    }

    // ── Opérations sur un PRODUIT (par clé) ──
    if (action === "product_delete") {
      const key = String(body.key || "");
      const from = body.blocked ? BLOCKED : LIVE;
      if (!key) return res.status(400).json({ error: "Clé produit requise" });
      const snap = await db.ref(from + "/" + key).once("value");
      if (snap.exists()) {
        await db.ref("trash").push({ node: from, key, value: snap.val(), by: who.email, at: Date.now() });
        await db.ref(from + "/" + key).remove();
      }
      await audit(who, "product_delete", from + "/" + key);
      return res.json({ ok: true });
    }
    if (action === "product_block" || action === "product_unblock") {
      const key = String(body.key || "");
      if (!key) return res.status(400).json({ error: "Clé produit requise" });
      const from = action === "product_block" ? LIVE : BLOCKED;
      const to = action === "product_block" ? BLOCKED : LIVE;
      const snap = await db.ref(from + "/" + key).once("value");
      if (!snap.exists()) return res.status(404).json({ error: "Produit introuvable" });
      await db.ref().update({ [from + "/" + key]: null, [to + "/" + key]: snap.val() });
      await audit(who, action, key);
      return res.json({ ok: true });
    }

    if (!uid) return res.status(400).json({ error: "uid de la boutique requis" });
    const sref = db.ref("sellers/" + uid);

    if (action === "shop_update") {
      const upd = {};
      if (typeof body.name === "string" && body.name.trim()) upd["shop/name"] = body.name.trim().slice(0, 120);
      if (body.expiresAt === "lifetime" || typeof body.expiresAt === "number") upd["expiresAt"] = body.expiresAt;
      if (typeof body.active === "boolean") upd["shopActive"] = body.active;
      if (!Object.keys(upd).length) return res.status(400).json({ error: "Rien à modifier" });
      upd["updatedBy"] = who.email; upd["updatedAt"] = Date.now();
      await sref.update(upd);
      await audit(who, "shop_update", uid, JSON.stringify(body).slice(0, 120));
      return res.json({ ok: true });
    }

    if (action === "shop_notify") {
      const message = String(body.message || "").trim().slice(0, 500);
      if (!message) return res.status(400).json({ error: "Message vide" });
      await db.ref("notifications/" + uid).push({ message, by: who.email, at: Date.now(), read: false });
      await audit(who, "shop_notify", uid, message.slice(0, 80));
      return res.json({ ok: true });
    }

    if (action === "shop_revoke") {
      await sref.update({ shopActive: false, expiresAt: Date.now() - 1, updatedBy: who.email, updatedAt: Date.now() });
      const n = await moveProducts(db, uid, LIVE, BLOCKED);
      await audit(who, "shop_revoke", uid, n + " produit(s) bloqué(s)");
      return res.json({ ok: true, blocked: n });
    }

    if (action === "shop_restore") {
      const upd = { shopActive: true, updatedBy: who.email, updatedAt: Date.now() };
      if (body.expiresAt === "lifetime" || typeof body.expiresAt === "number") upd.expiresAt = body.expiresAt;
      await sref.update(upd);
      const n = await moveProducts(db, uid, BLOCKED, LIVE);
      await audit(who, "shop_restore", uid, n + " produit(s) rétabli(s)");
      return res.json({ ok: true, restored: n });
    }

    if (action === "shop_delete") {
      // Archive la boutique + ses produits (live et bloqués) dans la corbeille.
      const [s, liveN, blockedN] = await Promise.all([
        sref.once("value"),
        db.ref(LIVE).once("value"),
        db.ref(BLOCKED).once("value")
      ]);
      const updates = {};
      if (s.exists()) {
        await db.ref("trash").push({ node: "sellers", key: uid, value: s.val(), by: who.email, at: Date.now() });
        updates["sellers/" + uid] = null;
      }
      [ [LIVE, liveN], [BLOCKED, blockedN] ].forEach(([nodeName, snap]) => {
        snap.forEach((c) => { const p = c.val(); if (p && p.uid === uid) updates[nodeName + "/" + c.key] = null; });
      });
      await db.ref().update(updates);
      await audit(who, "shop_delete", uid);
      return res.json({ ok: true });
    }

    if (action === "block_expired") {
      const sellersSnap = await db.ref("sellers").once("value");
      const targets = [];
      sellersSnap.forEach((c) => { const s = c.val(); if (s && s.shopActive && isExpired(s)) targets.push(c.key); });
      let shopsBlocked = 0, productsBlocked = 0;
      for (const id of targets) {
        await db.ref("sellers/" + id).update({ shopActive: false, updatedBy: who.email, updatedAt: Date.now() });
        productsBlocked += await moveProducts(db, id, LIVE, BLOCKED);
        shopsBlocked++;
      }
      await audit(who, "block_expired", null, shopsBlocked + " boutique(s), " + productsBlocked + " produit(s)");
      return res.json({ ok: true, shopsBlocked, productsBlocked });
    }

    return res.status(400).json({ error: "Action inconnue" });
  } catch (e) {
    return res.status(500).json({ error: "Erreur serveur : " + e.message });
  }
};
