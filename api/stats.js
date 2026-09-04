// api/stats.js — Statistiques & analytique (Admin SDK, admins seulement).
const { app, verifyAdmin, bearer, listAllAuthUsers } = require("./_lib/fb");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });
  const body = typeof req.body === "object" && req.body ? req.body
             : (() => { try { return JSON.parse(req.body || "{}"); } catch { return {}; } })();
  const { idToken, action } = body;

  let who;
  try { who = await verifyAdmin(bearer(req) || idToken); }
  catch (e) { return res.status(e.statusCode || 401).json({ error: e.message }); }

  const db = app().database();

  try {
    // ── VUE D'ENSEMBLE (dashboard d'accueil) ─────────────────────────────
    // KPIs synthétiques, tendances 30 j et sparkline — le tout à partir des
    // données réelles (aucune valeur inventée).
    if (action === "overview") {
      const now = Date.now();
      const DAY = 864e5;
      const dstr = (ms) => new Date(ms).toISOString().slice(0, 10); // AAAA-MM-JJ (UTC)
      const today = dstr(now);
      const subActive = (p) => !!p && (p.expiresAt === "lifetime" ||
        (typeof p.expiresAt === "number" && p.expiresAt > now));

      // Prix de l'abonnement (FCFA) d'après le palier : 3 mois = 15 000,
      // 6 mois = 25 000, 1 an = 45 000. Le palier (level) est fixé au moment de
      // l'octroi/achat et reste stable (contrairement à expiresAt qui décroît),
      // c'est donc lui qui détermine le revenu. À défaut de palier reconnu (ex.
      // « à vie »), on retombe sur le montant réellement enregistré.
      const PLAN_PRICES = { 15000: 15000, 25000: 25000, 45000: 45000 };
      const subPrice = (p) => {
        if (!p || typeof p !== "object") return 0;
        return PLAN_PRICES[Number(p.level)] || Number(p.amount) || 0;
      };

      const [purchSnap, visitsSnap, feedSnap, adminsSnap, vipsSnap, profSnap] = await Promise.all([
        db.ref("purchased_user").once("value"),
        db.ref("analytics/visits").once("value"),
        db.ref("activity_feed").limitToLast(40).once("value"),
        db.ref("admins").once("value"),
        db.ref("vip_users").once("value"),
        db.ref("profile_clients").once("value")
      ]);

      // Abonnements & revenus (purchased_user).
      const purch = purchSnap.val() || {};
      let activeSubs = 0, revenueTotal = 0, revenue30 = 0, sales30 = 0, salesTotal = 0;
      for (const p of Object.values(purch)) {
        if (!p || typeof p !== "object") continue;
        if (subActive(p)) activeSubs++;
        const amt = subPrice(p);
        if (amt > 0) {
          revenueTotal += amt; salesTotal++;
          if (typeof p.at === "number" && p.at >= now - 30 * DAY) { revenue30 += amt; sales30++; }
        }
      }

      // Visites : aujourd'hui, 30 j, uniques, + sparkline 14 jours.
      const visits = visitsSnap.val() || {};
      const dayTotal = {}, dayUniq = {};
      const uniq30 = new Set(), uniqAll = new Set();
      let visits30 = 0, visitsTotal = 0;
      for (const [date, users] of Object.entries(visits)) {
        let dt = 0; const set = new Set();
        for (const [uid, u] of Object.entries(users || {})) {
          const n = (u && typeof u.n === "number") ? u.n : 0;
          dt += n; set.add(uid); uniqAll.add(uid);
          if (date >= dstr(now - 30 * DAY)) uniq30.add(uid);
        }
        dayTotal[date] = dt; dayUniq[date] = set.size;
        visitsTotal += dt;
        if (date >= dstr(now - 30 * DAY)) visits30 += dt;
      }
      const spark = [];
      for (let i = 13; i >= 0; i--) {
        const d = dstr(now - i * DAY);
        spark.push({ d: d.slice(5), total: dayTotal[d] || 0, uniq: dayUniq[d] || 0 });
      }

      // Comptes Auth : total + nouveaux (7 j / 30 j) — mise en cache 30 s (voir _lib/fb).
      const authUsers = await listAllAuthUsers(app());
      let usersTotal = 0, new7 = 0, new30 = 0;
      for (const u of authUsers) {
        usersTotal++;
        const c = Date.parse(u.metadata.creationTime || "") || 0;
        if (c >= now - 7 * DAY) new7++;
        if (c >= now - 30 * DAY) new30++;
      }

      // Activité récente (journal d'événements).
      const feed = feedSnap.val() || {};
      const recent = Object.values(feed)
        .filter((e) => e && typeof e === "object")
        .map((e) => ({ at: e.at || 0, email: e.email || "", page: e.page || "?", type: e.type || "?" }))
        .sort((a, b) => b.at - a.at).slice(0, 12);

      const admins = adminsSnap.val() || {};
      const adminsCount = Object.values(admins).filter((v) => v === true).length + 1; // +super-admin

      return res.json({
        kpis: {
          revenue30, revenueTotal, sales30, salesTotal,
          activeSubs,
          usersTotal, new7, new30,
          uniqueToday: dayUniq[today] || 0, visitsToday: dayTotal[today] || 0,
          unique30: uniq30.size, uniqueAll: uniqAll.size, visits30, visitsTotal,
          boutiques: Object.keys(profSnap.val() || {}).length,
          admins: adminsCount,
          vips: Object.keys(vipsSnap.val() || {}).length
        },
        spark,
        recent
      });
    }

    // ── ANALYTIQUE & VISITES ─────────────────────────────────────────────
    // Sources : analytics/visits/{date}/{uid}={email,last,n}  (agrégé/jour)
    //           activity_feed/{push}={at,email,page,type,uid} (journal d'events)
    //           profile_clients/{id}={profile_name,img,number,follow,email,uid, <id>:true/false}
    //           det_produits/{key}={produit,Prix,Image,uid,email,...} (pour rattacher des
    //           produits à une boutique profile_clients — mêmes règles de propriété que
    //           estProprietaire() côté asrar-main, pages/api/shop.js : uid, sinon email)
    //           views/product/{key}/{uid} (vues, agrégées par produit)
    if (action === "analytics") {
      const [visitsSnap, feedSnap, profSnap, prodSnap, viewsSnap] = await Promise.all([
        db.ref("analytics/visits").once("value"),
        db.ref("activity_feed").limitToLast(5000).once("value"),
        db.ref("profile_clients").once("value"),
        db.ref("det_produits").once("value"),
        db.ref("views/product").once("value")
      ]);

      const now = Date.now();
      const DAY = 864e5;
      const dstr = (ms) => new Date(ms).toISOString().slice(0, 10);
      const visits = visitsSnap.val() || {};

      // Regroupe les visites par intervalle avec comptage d'uniques EXACT (union d'uids).
      const bucketize = (keyFn) => {
        const map = {};
        for (const [date, users] of Object.entries(visits)) {
          const b = keyFn(date);
          if (!map[b]) map[b] = { uids: new Set(), total: 0 };
          for (const [uid, u] of Object.entries(users || {})) {
            map[b].uids.add(uid);
            map[b].total += (u && typeof u.n === "number") ? u.n : 0;
          }
        }
        return Object.entries(map)
          .map(([bucket, v]) => ({ bucket, unique: v.uids.size, total: v.total }))
          .sort((a, b) => (a.bucket < b.bucket ? -1 : 1));
      };
      const isoWeek = (dateStr) => {
        const d = new Date(dateStr + "T00:00:00Z");
        const day = (d.getUTCDay() + 6) % 7;
        d.setUTCDate(d.getUTCDate() - day + 3);
        const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
        const week = 1 + Math.round(((d - firstThu) / 864e5 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
        return d.getUTCFullYear() + "-S" + String(week).padStart(2, "0");
      };
      const daily = bucketize((d) => d);
      const weekly = bucketize(isoWeek);
      const monthly = bucketize((d) => d.slice(0, 7));

      // Uniques + visites cumulées sur toute la période (source de vérité pour « Tout »).
      const allUids = new Set();
      let totalVisits = 0;
      for (const users of Object.values(visits)) {
        for (const [uid, u] of Object.entries(users || {})) {
          allUids.add(uid);
          totalVisits += (u && typeof u.n === "number") ? u.n : 0;
        }
      }

      // Fenêtres 7/30/90 j + comparaison à la période précédente de même durée
      // (ex. J-14→J-7 pour la fenêtre 7 j) — union d'uids EXACTE par fenêtre,
      // pas une somme des « uniques du jour » qui compterait deux fois un même
      // visiteur revenu plusieurs jours dans la période.
      const WINDOWS = [7, 30, 90];
      const curSet = { 7: new Set(), 30: new Set(), 90: new Set() };
      const prevSet = { 7: new Set(), 30: new Set(), 90: new Set() };
      const curTotal = { 7: 0, 30: 0, 90: 0 }, prevTotal = { 7: 0, 30: 0, 90: 0 };
      for (const w of WINDOWS) {
        const curFrom = dstr(now - w * DAY), prevFrom = dstr(now - 2 * w * DAY);
        for (const [date, users] of Object.entries(visits)) {
          if (date < prevFrom) continue; // hors des deux fenêtres, inutile d'itérer les uids
          const isCur = date >= curFrom;
          const bucket = isCur ? curSet[w] : prevSet[w];
          for (const [uid, u] of Object.entries(users || {})) {
            bucket.add(uid);
            const n = (u && typeof u.n === "number") ? u.n : 0;
            if (isCur) curTotal[w] += n; else prevTotal[w] += n;
          }
        }
      }
      const pct = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);
      const periods = { all: { unique: allUids.size, total: totalVisits, deltaUnique: null, deltaTotal: null } };
      for (const w of WINDOWS) {
        periods["d" + w] = {
          unique: curSet[w].size, total: curTotal[w],
          deltaUnique: pct(curSet[w].size, prevSet[w].size),
          deltaTotal: pct(curTotal[w], prevTotal[w])
        };
      }

      // ── Normalisation des libellés de page — l'app a changé de socle
      // (site statique .html → Next.js App Router, cf. next.config.mjs LEGACY)
      // et activity_feed porte encore les deux conventions. Fusionne les
      // variantes AVANT comptage (pas seulement à l'affichage) pour que
      // « accueil.html » et « accueil » forment une seule ligne.
      const PAGE_LABELS = {
        "/": "Accueil", "index.html": "Accueil", "accueil": "Accueil", "accueil.html": "Accueil",
        "auth/auth.html": "Accueil", "accueil/accueil.html": "Accueil",
        "asrar": "Asrar", "asrar.html": "Asrar", "asrar/asrar.html": "Asrar",
        "marche": "Marché", "marche.html": "Marché", "marche/marche.html": "Marché",
        "boutique": "Boutique", "boutique.html": "Boutique", "boutique/boutique.html": "Boutique",
        "bibliotheque": "Bibliothèque", "bibliotheque.html": "Bibliothèque", "bibliotheque/bibliotheque.html": "Bibliothèque",
        "don": "Don", "don.html": "Don", "don/don.html": "Don",
        "abajad": "Abajad", "abajad.html": "Abajad", "abajad/abajad.html": "Abajad",
        "parrainage": "Parrainage", "parrainage.html": "Parrainage", "parrainage/parrainage.html": "Parrainage",
        "combinaisons": "Combinaisons", "combinaisons.html": "Combinaisons", "combinaisons/combinaisons.html": "Combinaisons",
        "planete": "Planète", "planete.html": "Planète", "planete/planete.html": "Planète",
        "rouwhania": "Rouwhanes", "rouwhania/index.html": "Rouwhanes",
        "geomancie": "Géomancie", "geomancie/tourab.html": "Géomancie", "tourab.html": "Géomancie",
        "alqalam": "Al-Qalam", "alqalam/index.html": "Al-Qalam",
        "benefits": "Les 99 Noms", "benefits/index.html": "Les 99 Noms",
        "menu": "Menu", "zikr": "Zikr", "geomancie/index.html": "Géomancie"
      };
      function normalizePage(raw) {
        const p = String(raw == null ? "" : raw).trim();
        if (!p || p === "?" || p === "undefined" || p === "null") return "Page inconnue";
        const hit = PAGE_LABELS[p.toLowerCase()];
        if (hit) return hit;
        // Repli : nettoyage générique plutôt qu'une route technique brute.
        let clean = p.replace(/\.html?$/i, "").replace(/^\/+/, "").split("/")[0].replace(/[-_]+/g, " ").trim();
        if (!clean) return "Page inconnue";
        return clean.charAt(0).toUpperCase() + clean.slice(1);
      }

      // Journal d'activité : top pages (normalisées), flux récent.
      const feed = feedSnap.val() || {};
      const pageCount = {};
      let recent = [];
      let interactions7 = 0, interactions30 = 0, interactions90 = 0;
      for (const e of Object.values(feed)) {
        if (!e || typeof e !== "object") continue;
        const label = normalizePage(e.page);
        pageCount[label] = (pageCount[label] || 0) + 1;
        const t = e.type || "?";
        recent.push({ at: e.at || 0, email: e.email || "", page: label, type: t });
        const at = e.at || 0;
        if (at >= now - 7 * DAY) interactions7++;
        if (at >= now - 30 * DAY) interactions30++;
        if (at >= now - 90 * DAY) interactions90++;
      }
      recent.sort((a, b) => b.at - a.at);
      recent = recent.slice(0, 60);
      const pagesTotal = Object.values(pageCount).reduce((s, n) => s + n, 0);
      const topPages = Object.entries(pageCount).map(([page, count]) => ({ page, count }))
        .sort((a, b) => b.count - a.count).slice(0, 50);
      // Interactions : approximation sur les 5000 dernières entrées du journal
      // (comme l'ancien total) — exacte pour « Tout » seulement si le journal
      // compte moins de 5000 événements au total.
      periods.d7.interactions = interactions7;
      periods.d30.interactions = interactions30;
      periods.d90.interactions = interactions90;
      periods.all.interactions = Object.keys(feed).length;

      // Produits par propriétaire (uid prioritaire, e-mail en repli — même
      // logique que estProprietaire() côté asrar-main) : pour rattacher un
      // nombre de produits + un total de vues à chaque boutique profile_clients.
      const prodVal = prodSnap.val() || {};
      const viewsVal = viewsSnap.val() || {};
      const productsByOwner = {};
      for (const [pk, p] of Object.entries(prodVal)) {
        if (!p || typeof p !== "object") continue;
        const ownerKey = p.uid ? "u:" + p.uid : (p.email ? "e:" + String(p.email).toLowerCase() : null);
        if (!ownerKey) continue;
        (productsByOwner[ownerKey] = productsByOwner[ownerKey] || []).push({
          key: pk, name: p.produit || "Produit", price: p.Prix || 0, image: p.Image || "",
          views: Object.keys(viewsVal[pk] || {}).length
        });
      }
      const ownerProducts = (uid, email) =>
        (uid && productsByOwner["u:" + uid]) ||
        (email && productsByOwner["e:" + String(email).toLowerCase()]) || [];

      // Boutiques (profile_clients) + total des « aimes » (true).
      const prof = profSnap.val() || {};
      const RESERVED = new Set(["ID", "key", "img", "imageId", "number", "follow", "profile_name", "email", "createdAt", "uid"]);
      const boutiques = Object.entries(prof).map(([id, pc]) => {
        let likes = 0;
        if (pc && typeof pc === "object") {
          for (const [fk, fv] of Object.entries(pc)) {
            if (RESERVED.has(fk)) continue;
            if (fv === true || fv === "true") likes++;
          }
        }
        const products = ownerProducts(pc && pc.uid, pc && pc.email);
        return {
          id,
          name: (pc && pc.profile_name) || id,
          img: (pc && pc.img) || "",
          number: (pc && pc.number) || "",
          follow: pc && pc.follow != null ? (Number(pc.follow) || 0) : 0,
          likes,
          products: products.length,
          views: products.reduce((s, p) => s + p.views, 0),
          productList: products.slice(0, 20)
        };
      }).sort((a, b) => b.views - a.views || b.likes - a.likes || b.follow - a.follow);

      return res.json({
        daily: daily.slice(-90), weekly, monthly, topPages, recent, boutiques,
        periods,
        totals: {
          uniqueAllTime: allUids.size,
          totalVisits,
          days: daily.length,
          events: Object.keys(feed).length,
          boutiques: boutiques.length,
          likesTotal: boutiques.reduce((s, b) => s + b.likes, 0),
          pagesTotal
        }
      });
    }

    return res.status(400).json({ error: "Action inconnue" });
  } catch (e) {
    return res.status(500).json({ error: "Erreur serveur : " + e.message });
  }
};

