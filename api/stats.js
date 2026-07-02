// api/stats.js — Tableau de bord (Admin SDK, admins seulement).
// POST { idToken, action, days?, config? }
//   overview → visites (journalier + mensuel), revenus, activité récente
//   audit    → journal des actions admin
//   config_get / config_set → maintenance + annonce globale
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
    if (action === "overview") {
      const days = Math.min(Math.max(parseInt(body.days) || 30, 7), 120);

      const [visitsSnap, feedSnap, purchasesSnap, vendorSnap] = await Promise.all([
        db.ref("analytics/visits").limitToLast(days).once("value"),
        db.ref("activity_feed").orderByChild("at").limitToLast(40).once("value"),
        db.ref("purchases").once("value"),
        db.ref("vendor_sales").once("value")
      ]);

      // — Visites : par jour (visites + visiteurs uniques), puis regroupement mensuel —
      const daily = [];
      const uniqueSet = new Set();     // visiteurs uniques distincts sur la période
      let totalVisits = 0;
      visitsSnap.forEach((day) => {
        let visits = 0, users = 0;
        day.forEach((u) => { visits += (u.val() && u.val().n) || 0; users++; uniqueSet.add(u.key); });
        totalVisits += visits;
        daily.push({ date: day.key, visits, users });
      });
      daily.sort((x, y) => x.date.localeCompare(y.date));
      const monthly = {};
      daily.forEach((d) => {
        const m = d.date.slice(0, 7);
        monthly[m] = monthly[m] || { visits: 0, users: 0 };
        monthly[m].visits += d.visits;
        monthly[m].users += d.users; // uniques/jour cumulés (approximation mensuelle)
      });

      // — Revenus (achats de contenu + ventes boutique) —
      let revenue = 0, sales = 0, revenue30 = 0;
      const cutoff = Date.now() - 30 * 864e5;
      const addSale = (v) => {
        const amt = Number(v && (v.amount || v.montant)) || 0;
        const at = Number(v && (v.at || v.date || v.timestamp)) || 0;
        revenue += amt; sales++;
        if (at >= cutoff) revenue30 += amt;
      };
      const pv = purchasesSnap.val() || {};
      Object.values(pv).forEach((byUser) => {
        if (byUser && typeof byUser === "object") Object.values(byUser).forEach(addSale);
      });
      const vv = vendorSnap.val() || {};
      Object.values(vv).forEach((v) => {
        if (v && typeof v === "object" && !("amount" in v) && !("montant" in v))
          Object.values(v).forEach(addSale);
        else addSale(v);
      });

      // — Activité récente —
      const feed = [];
      feedSnap.forEach((c) => feed.push(c.val()));
      feed.reverse();

      // — Nombre total de comptes (Firebase Auth) —
      let accounts = 0;
      try { accounts = (await app().auth().listUsers(1000)).users.length; } catch (e) {}

      return res.json({
        daily, monthly, revenue, revenue30, sales, feed, me: who,
        uniquePeriod: uniqueSet.size, totalVisits, accounts
      });
    }

    if (action === "market") {
      const [prodSnap, sellSnap, orderSnap, vendorSnap] = await Promise.all([
        db.ref("det_produits").limitToFirst(500).once("value"),
        db.ref("sellers").once("value"),
        db.ref("orders").once("value"),
        db.ref("vendor_sales").once("value")
      ]);

      const products = [];
      prodSnap.forEach((c) => {
        const v = c.val() || {};
        products.push({
          key: c.key,
          name: v.name || v.nom || v.title || v.titre || "(sans nom)",
          price: Number(v.price || v.prix || v.amount || 0),
          seller: v.sellerEmail || v.vendeur || v.uid || "—",
          active: v.active !== false && v.disponible !== false,
          stock: v.stock,
          img: (typeof (v.image || v.img || v.url) === "string" && /^https?:\/\//.test(v.image || v.img || v.url)) ? (v.image || v.img || v.url) : ""
        });
      });

      const sellers = [];
      const sv = sellSnap.val() || {};
      Object.entries(sv).forEach(([uid, v]) => sellers.push({
        uid,
        email: (v && (v.email || v.shopEmail)) || "—",
        shop: (v && (v.shopName || v.boutique || v.name)) || "—",
        tier: (v && (v.tier || v.plan)) || "—"
      }));

      // Commandes + ventes (revenu marché)
      let orders = 0, marketRevenue = 0;
      const ov = orderSnap.val() || {};
      Object.values(ov).forEach((byUser) => {
        if (byUser && typeof byUser === "object") Object.values(byUser).forEach((o) => {
          orders++; marketRevenue += Number(o && (o.amount || o.montant || o.total)) || 0;
        });
      });
      let vendorRevenue = 0;
      const vv = vendorSnap.val() || {};
      const walk = (x) => {
        if (!x || typeof x !== "object") return;
        if ("amount" in x || "montant" in x) vendorRevenue += Number(x.amount || x.montant) || 0;
        else Object.values(x).forEach(walk);
      };
      walk(vv);

      return res.json({
        products, sellers,
        summary: {
          products: products.length,
          activeProducts: products.filter((p) => p.active).length,
          sellers: sellers.length,
          orders, marketRevenue, vendorRevenue
        }
      });
    }

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
