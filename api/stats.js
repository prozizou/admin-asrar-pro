// api/stats.js — Statistiques & analytique (Admin SDK, admins seulement).
// Firestore — mêmes collections que asrar-main (docs/FIRESTORE_SCHEMA.md) :
// access_purchases, analytics_visits, activity_feed, shop_profiles, products,
// product_views, likes, comments, access_admins, access_vip, user_sessions
// (nouveau, pays/connexions — voir pages/api/track.js côté asrar-main).
const { app, verifyAdmin, bearer, listAllAuthUsers, cached } = require("./_lib/fb");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });
  const body = typeof req.body === "object" && req.body ? req.body
             : (() => { try { return JSON.parse(req.body || "{}"); } catch { return {}; } })();
  const { idToken, action } = body;

  let who;
  try { who = await verifyAdmin(bearer(req) || idToken); }
  catch (e) { return res.status(e.statusCode || 401).json({ error: e.message }); }

  // Vérification de session admin (admin-core.js → verifyAdminOrSignOut,
  // appelée à CHAQUE chargement de page) : verifyAdmin() ci-dessus a déjà
  // fait tout le travail (1 lecture Firestore sur access_admins, ou 0 pour
  // le super-admin) — inutile de lancer toute l'agrégation « overview »
  // (plusieurs balayages de collections) juste pour confirmer un accès.
  if (action === "ping") return res.json({ ok: true });

  const firestore = app().firestore();

  try {
    // ── VUE D'ENSEMBLE (dashboard d'accueil) ─────────────────────────────
    // KPIs synthétiques, tendances 30 j et sparkline — le tout à partir des
    // données réelles (aucune valeur inventée).
    if (action === "overview") {
      const result = await cached("stats:overview", 20000, async () => {
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

      const [purchSnap, visitsSnap, adminsCountSnap, vipsCountSnap, boutiquesCountSnap, sessionsSnap] = await Promise.all([
        firestore.collection("access_purchases").get(),
        // Bornée aux 90 derniers jours (portée du graphique de trafic) — pas
        // besoin de tout l'historique pour la vue d'ensemble (contrairement à
        // l'onglet Analytique, qui garde un fetch complet pour « Tout »).
        firestore.collection("analytics_visits").where("date", ">=", dstr(now - 90 * DAY)).get(),
        firestore.collection("access_admins").count().get(),
        firestore.collection("access_vip").count().get(),
        firestore.collection("shop_profiles").count().get(),
        firestore.collection("user_sessions").get()
      ]);

      // Abonnements & revenus (access_purchases) + événements « achat/abonnement »
      // pour le flux d'activité récente (cf. plus bas) : un octroi manuel
      // (productId === "admin_grant") est un abonnement OFFERT, tout autre
      // productId est un ACHAT réel — même enregistrement, deux libellés.
      let activeSubs = 0, revenueTotal = 0, revenue30 = 0, revenue7 = 0, sales30 = 0, sales7 = 0, salesTotal = 0;
      let newSubs7 = 0, newSubs30 = 0;
      const subEvents = [];
      purchSnap.forEach((doc) => {
        const p = doc.data();
        if (!p || typeof p !== "object") return;
        if (subActive(p)) activeSubs++;
        const amt = subPrice(p);
        if (amt > 0) {
          revenueTotal += amt; salesTotal++;
          if (typeof p.at === "number" && p.at >= now - 30 * DAY) { revenue30 += amt; sales30++; }
          if (typeof p.at === "number" && p.at >= now - 7 * DAY) { revenue7 += amt; sales7++; }
        }
        if (typeof p.at === "number") {
          if (p.at >= now - 7 * DAY) newSubs7++;
          if (p.at >= now - 30 * DAY) newSubs30++;
          subEvents.push({
            at: p.at,
            type: p.productId === "admin_grant" ? "grant" : "purchase",
            email: String(doc.id).replace(/,/g, "."),
            amount: amt
          });
        }
      });

      // Visites : aujourd'hui, 30 j, uniques, + graphique (90 jours).
      const dayTotal = {}, dayUniqSets = {};
      const uniq30 = new Set();
      let visits30 = 0;
      visitsSnap.forEach((doc) => {
        const v = doc.data();
        if (!v || !v.date || !v.uid) return;
        const n = typeof v.n === "number" ? v.n : 0;
        dayTotal[v.date] = (dayTotal[v.date] || 0) + n;
        (dayUniqSets[v.date] = dayUniqSets[v.date] || new Set()).add(v.uid);
        if (v.date >= dstr(now - 30 * DAY)) { uniq30.add(v.uid); visits30 += n; }
      });
      const dayUniq = {};
      for (const d of Object.keys(dayUniqSets)) dayUniq[d] = dayUniqSets[d].size;

      // 90 jours : le client choisit 7/30/90 j sans re-requête (sélecteur de
      // période du graphique, cf. admin-dashboard.js).
      const spark = [];
      for (let i = 89; i >= 0; i--) {
        const d = dstr(now - i * DAY);
        // bucket en date complète (pas pré-tronquée) : le client formate
        // l'affichage (dates françaises, cf. window.frDate, admin-core.js).
        spark.push({ bucket: d, total: dayTotal[d] || 0, unique: dayUniq[d] || 0 });
      }

      // Comptes Auth : total + nouveaux (7 j / 30 j) — mise en cache 30 s (voir _lib/fb).
      const authUsers = await listAllAuthUsers(app());
      let usersTotal = 0, new7 = 0, new30 = 0;
      const signupEvents = [];
      for (const u of authUsers) {
        usersTotal++;
        const c = Date.parse(u.metadata.creationTime || "") || 0;
        if (c >= now - 7 * DAY) new7++;
        if (c >= now - 30 * DAY) new30++;
        if (c >= now - 30 * DAY) signupEvents.push({ at: c, type: "signup", email: u.email || "" });
      }

      // Répartition par pays (user_sessions, un doc par utilisateur — voir
      // pages/api/track.js côté asrar-main) : classement des pays qui
      // utilisent le plus ASRAR PRO (nombre d'utilisateurs + pourcentage),
      // et événements de connexion récents (flag + pays) pour le flux
      // d'activité ci-dessous.
      const countryCounts = {}; // countryCode ("" = inconnu) → { country, users }
      const connectionEvents = [];
      let sessionsWithCountry = 0;
      sessionsSnap.forEach((doc) => {
        const s = doc.data();
        if (!s) return;
        const code = s.countryCode || "";
        if (code) sessionsWithCountry++;
        if (!countryCounts[code]) countryCounts[code] = { country: s.country || "Inconnu", countryCode: code, users: 0 };
        countryCounts[code].users++;
        if (typeof s.lastLoginAt === "number") {
          connectionEvents.push({
            at: s.lastLoginAt, type: "connection", email: s.email || "",
            country: s.country || "", countryCode: code
          });
        }
      });
      const sessionsTotal = sessionsSnap.size;
      const countryBreakdown = Object.values(countryCounts)
        .filter((c) => c.countryCode) // le pays inconnu n'entre pas dans le classement…
        .sort((a, b) => b.users - a.users)
        .map((c) => ({ ...c, pct: sessionsTotal ? Math.round((c.users / sessionsTotal) * 1000) / 10 : 0 }));
      const unknownCountry = countryCounts[""]; // …mais reste visible séparément si non vide.

      // Activité récente — événements métier compréhensibles (connexion,
      // inscription, achat, abonnement offert) plutôt que le journal brut de
      // navigation (activity_feed), qui n'était qu'une suite de pages/e-mails
      // répétés.
      const recent = [...connectionEvents, ...signupEvents, ...subEvents]
        .sort((a, b) => b.at - a.at)
        .slice(0, 12);

      return {
        kpis: {
          revenue30, revenueTotal, revenue7, sales30, sales7, salesTotal,
          activeSubs, newSubs7, newSubs30,
          usersTotal, new7, new30,
          uniqueToday: dayUniq[today] || 0, visitsToday: dayTotal[today] || 0,
          unique30: uniq30.size, visits30,
          boutiques: boutiquesCountSnap.data().count,
          admins: adminsCountSnap.data().count + 1, // +super-admin
          vips: vipsCountSnap.data().count
        },
        spark,
        recent,
        countryBreakdown,
        unknownCountry: unknownCountry ? { users: unknownCountry.users, pct: sessionsTotal ? Math.round((unknownCountry.users / sessionsTotal) * 1000) / 10 : 0 } : null
      };
      });
      return res.json(result);
    }

    // ── ANALYTIQUE & VISITES ─────────────────────────────────────────────
    // Sources (Firestore) : analytics_visits/{date}_{uid}={date,uid,email,n,last}
    //           activity_feed/{id}={at,email,page,type,uid}   (journal d'events)
    //           shop_profiles/{id}={profile_name,img,number,follow,email,uid}
    //           products/{key}={produit,Prix,Image,uid,email,...} (pour rattacher des
    //           produits à une boutique shop_profiles — mêmes règles de propriété que
    //           estProprietaire() côté asrar-main, server/access.js)
    //           product_views/{key}_{uid}={productKey,uid,viewedAt}
    //           likes/{cat}:{itemKey}={cat,itemKey,uids:{uid:valeur},count}
    //           comments/{id}={cat,itemKey,uid,text,timestamp,...}
    if (action === "analytics") {
      const result = await cached("stats:analytics", 30000, async () => {
      const [visitsSnap, feedSnap, profSnap, prodSnap, viewsSnap, likesSnap, vendorCommentsSnap] = await Promise.all([
        firestore.collection("analytics_visits").get(),
        firestore.collection("activity_feed").orderBy("at", "desc").limit(5000).get(),
        firestore.collection("shop_profiles").get(),
        firestore.collection("products").get(),
        firestore.collection("product_views").get(),
        // Les avis/notes boutiques (plus bas) se limitaient jusqu'ici à 2-4
        // requêtes PAR boutique (jusqu'à 4×N lectures) — une requête par
        // PRÉFIXE d'ID ("vendor:…", via une plage sur l'ID de document, qui
        // ne lit QUE les docs vendor — pas tout `likes`, qui contient aussi
        // les avis produits) ramène ça à 2 lectures de collection au total,
        // quel que soit le nombre de boutiques.
        firestore.collection("likes")
          .where(app().firestore.FieldPath.documentId(), ">=", "vendor:")
          .where(app().firestore.FieldPath.documentId(), "<", "vendor:")
          .get(),
        firestore.collection("comments").where("cat", "==", "vendor").get()
      ]);

      const now = Date.now();
      const DAY = 864e5;
      const dstr = (ms) => new Date(ms).toISOString().slice(0, 10);
      // Liste plate {date, uid, n} — équivalent du nœud imbriqué RTDB
      // analytics/visits/{date}/{uid}, aplati par la migration Firestore.
      const visits = visitsSnap.docs.map((d) => d.data()).filter((v) => v && v.date && v.uid);

      // Regroupe les visites par intervalle avec comptage d'uniques EXACT (union d'uids).
      const bucketize = (keyFn) => {
        const map = {};
        for (const v of visits) {
          const b = keyFn(v.date);
          if (!map[b]) map[b] = { uids: new Set(), total: 0 };
          map[b].uids.add(v.uid);
          map[b].total += (typeof v.n === "number") ? v.n : 0;
        }
        return Object.entries(map)
          .map(([bucket, val]) => ({ bucket, unique: val.uids.size, total: val.total }))
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
      for (const v of visits) { allUids.add(v.uid); totalVisits += (typeof v.n === "number") ? v.n : 0; }

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
        for (const v of visits) {
          if (v.date < prevFrom) continue; // hors des deux fenêtres, inutile
          const isCur = v.date >= curFrom;
          const bucket = isCur ? curSet[w] : prevSet[w];
          bucket.add(v.uid);
          const n = (typeof v.n === "number") ? v.n : 0;
          if (isCur) curTotal[w] += n; else prevTotal[w] += n;
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
      const feedDocs = feedSnap.docs.map((d) => d.data());
      const pageCount = {};
      let recent = [];
      let interactions7 = 0, interactions30 = 0, interactions90 = 0;
      for (const e of feedDocs) {
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
      periods.all.interactions = feedDocs.length;

      // Produits par propriétaire (uid prioritaire, e-mail en repli — même
      // logique que estProprietaire() côté asrar-main) : pour rattacher un
      // nombre de produits + un total de vues à chaque boutique shop_profiles.
      const viewsCountByProduct = {};
      viewsSnap.forEach((doc) => {
        const v = doc.data();
        if (v && v.productKey) viewsCountByProduct[v.productKey] = (viewsCountByProduct[v.productKey] || 0) + 1;
      });
      const productsByOwner = {};
      prodSnap.forEach((doc) => {
        const p = doc.data();
        if (!p || typeof p !== "object") return;
        const ownerKey = p.uid ? "u:" + p.uid : (p.email ? "e:" + String(p.email).toLowerCase() : null);
        if (!ownerKey) return;
        (productsByOwner[ownerKey] = productsByOwner[ownerKey] || []).push({
          key: doc.id, name: p.produit || "Produit", price: p.Prix || 0, image: p.Image || "",
          views: viewsCountByProduct[doc.id] || 0
        });
      });
      const ownerProducts = (uid, email) =>
        (uid && productsByOwner["u:" + uid]) ||
        (email && productsByOwner["e:" + String(email).toLowerCase()]) || [];

      // Boutiques (shop_profiles). Les avis/notes réels vivent dans
      // likes/vendor:{clé} = { uids: {uid: note 1-5}, count } (même schéma que
      // likes/product, cf. pages/api/shop.js côté asrar-main) et comments (cat
      // "vendor", itemKey = clé) ; { clé } = uid vendeur classique OU id de la
      // fiche shop_profiles selon ce que le Marché écrit côté client.
      // ⚠️ La clé exacte utilisée pour une boutique « profil » (id vs uid une
      // fois liée) n'a pas pu être revérifiée sur asrar-main depuis cette
      // session — repli id puis uid préservé tel quel (incertitude déjà
      // présente avant la migration Firestore).
      // likes/vendor:{clé} → Map(clé → uids{uid:valeur}) ; comments (cat=vendor)
      // → Map(itemKey → nombre) — regroupés une fois en mémoire, plutôt que
      // requêtés boutique par boutique (voir la requête groupée ci-dessus).
      const likesByKey = new Map();
      likesSnap.forEach((doc) => {
        const key = doc.id.slice("vendor:".length);
        likesByKey.set(key, doc.data().uids || {});
      });
      const commentCountByKey = new Map();
      vendorCommentsSnap.forEach((doc) => {
        const key = doc.data().itemKey;
        if (key) commentCountByKey.set(key, (commentCountByKey.get(key) || 0) + 1);
      });

      const boutiques = [];
      profSnap.forEach((doc) => {
        const id = doc.id, pc = doc.data();
        const products = ownerProducts(pc && pc.uid, pc && pc.email);
        const uidsMap = likesByKey.get(id) || (pc && pc.uid && likesByKey.get(pc.uid)) || {};
        const ratingValues = Object.values(uidsMap).map(Number).filter((n) => n >= 1 && n <= 5);
        const rating = ratingValues.length
          ? Math.round((ratingValues.reduce((s, n) => s + n, 0) / ratingValues.length) * 10) / 10
          : 0;
        const comments = commentCountByKey.get(id) || (pc && pc.uid && commentCountByKey.get(pc.uid)) || 0;

        boutiques.push({
          id,
          name: (pc && pc.profile_name) || id,
          img: (pc && pc.img) || "",
          number: (pc && pc.number) || "",
          follow: pc && pc.follow != null ? (Number(pc.follow) || 0) : 0,
          rating, ratingsCount: ratingValues.length,
          comments,
          products: products.length,
          views: products.reduce((s, p) => s + p.views, 0),
          productList: products.slice(0, 20)
        });
      });
      boutiques.sort((a, b) => b.views - a.views || b.ratingsCount - a.ratingsCount || b.follow - a.follow);

      return {
        daily: daily.slice(-90), weekly, monthly, topPages, recent, boutiques,
        periods,
        totals: {
          uniqueAllTime: allUids.size,
          totalVisits,
          days: daily.length,
          events: feedDocs.length,
          boutiques: boutiques.length,
          avisTotal: boutiques.reduce((s, b) => s + b.ratingsCount, 0),
          pagesTotal
        }
      };
      });
      return res.json(result);
    }

    return res.status(400).json({ error: "Action inconnue" });
  } catch (e) {
    return res.status(500).json({ error: "Erreur serveur : " + e.message });
  }
};
