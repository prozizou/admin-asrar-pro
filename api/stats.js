// api/stats.js — Statistiques & analytique (Admin SDK, admins seulement).
const { app, verifyAdmin, bearer, listAllAuthUsers } = require("./_lib/fb");

// Compteurs d'audience ANONYMES écrits par asrar-main pour TOUS les comptes
// (pages/api/track.js, countAudience) : analytics/daily/{jour} =
// { visits, unique, platforms: {catégorie: n}, countries: {CODE: n} } et
// analytics/geo/{AAAA-MM}/{CODE} = utilisateurs distincts du mois (« XX » =
// pays inconnu). Le journal détaillé analytics/visits/{jour}/{uid}, lui, ne
// couvre que les comptes ayant coché la mesure détaillée (décochée par
// défaut) : c'est pourquoi les statistiques restaient à 0.
const DAY_MS = 864e5;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
async function loadAudience(db, now, days) {
  const snap = await db.ref("analytics/daily").orderByKey().startAt(isoDay(now - (days - 1) * DAY_MS)).once("value");
  return snap.val() || {};
}
let regionNames = null;
try { regionNames = new Intl.DisplayNames(["fr"], { type: "region" }); } catch { /* ICU réduit */ }
const countryName = (code) => {
  try { return (regionNames && regionNames.of(code)) || code; } catch { return code; }
};
async function loadGeo(db, now) {
  const month = isoDay(now).slice(0, 7);
  const prev = new Date(now); prev.setUTCDate(1); prev.setUTCMonth(prev.getUTCMonth() - 1);
  const prevMonth = isoDay(prev.getTime()).slice(0, 7);
  const [cur, old] = await Promise.all([db.ref("analytics/geo/" + month).once("value"), db.ref("analytics/geo/" + prevMonth).once("value")]);
  const has = (v) => v && Object.values(v).some((n) => Number(n) > 0);
  if (has(cur.val())) return { month, counts: cur.val() };
  if (has(old.val())) return { month: prevMonth, counts: old.val() };
  return null;
}
const num = (v) => Math.max(0, Number(v) || 0);

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

      const [purchSnap, visitsSnap, adminsSnap, vipsSnap, profSnap, sessionsSnap, settingsSnap] = await Promise.all([
        db.ref("purchased_user").once("value"),
        db.ref("analytics/visits").once("value"),
        db.ref("admins").once("value"),
        db.ref("vip_users").once("value"),
        db.ref("profile_clients").once("value"),
        db.ref("user_sessions").once("value"),
        db.ref("account_settings").once("value")
      ]);

      // Abonnements & revenus (purchased_user) + événements « achat/abonnement »
      // pour le flux d'activité récente (cf. plus bas) : un octroi manuel
      // (productId === "admin_grant") est un abonnement OFFERT, tout autre
      // productId est un ACHAT réel — même enregistrement, deux libellés.
      const purch = purchSnap.val() || {};
      let activeSubs = 0, revenueTotal = 0, revenue30 = 0, revenue7 = 0, sales30 = 0, sales7 = 0, salesTotal = 0;
      let newSubs7 = 0, newSubs30 = 0;
      const subEvents = [];
      for (const [key, p] of Object.entries(purch)) {
        if (!p || typeof p !== "object") continue;
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
            email: String(key).replace(/,/g, "."),
            amount: amt
          });
        }
      }

      // Visites : aujourd'hui, 30 j, uniques, + graphique (jusqu'à 90 jours).
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
      // 90 jours (au lieu de 14) : le client choisit 7/30/90 j sans re-requête
      // (sélecteur de période du graphique, cf. admin-dashboard.js).
      // Chaque jour : le plus grand des deux relevés (compteurs anonymes de
      // tous les comptes / journal détaillé des comptes consentants) — les
      // jours antérieurs aux compteurs anonymes gardent le journal détaillé.
      const audience = await loadAudience(db, now, 90);
      const spark = [];
      for (let i = 89; i >= 0; i--) {
        const d = dstr(now - i * DAY);
        const a = audience[d] || {};
        dayTotal[d] = Math.max(dayTotal[d] || 0, num(a.visits));
        dayUniq[d] = Math.max(dayUniq[d] || 0, num(a.unique));
        // bucket en date complète (pas pré-tronquée) : le client formate
        // l'affichage (dates françaises, cf. window.frDate, admin-core.js).
        spark.push({ bucket: d, total: dayTotal[d], unique: dayUniq[d] });
      }
      const sparkVisits30 = spark.slice(-30).reduce((sum, r) => sum + r.total, 0);
      visits30 = Math.max(visits30, sparkVisits30);
      visitsTotal = Math.max(visitsTotal, spark.reduce((sum, r) => sum + r.total, 0));

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

      // Répartition par pays (user_sessions/{uid} — voir pages/api/track.js
      // côté asrar-main) : classement des pays qui utilisent le plus ASRAR
      // PRO (nombre d'utilisateurs + pourcentage), et événements de
      // connexion récents (flag + pays) pour le flux d'activité ci-dessous.
      const sessions = sessionsSnap.val() || {};
      const countryCounts = {}; // countryCode ("" = inconnu) → { country, users }
      const connectionEvents = [];
      for (const s of Object.values(sessions)) {
        if (!s || typeof s !== "object") continue;
        const code = s.countryCode || "";
        if (!countryCounts[code]) countryCounts[code] = { country: s.country || "Inconnu", countryCode: code, users: 0 };
        countryCounts[code].users++;
        if (typeof s.lastLoginAt === "number") {
          connectionEvents.push({
            at: s.lastLoginAt, type: "connection", email: s.email || "",
            country: s.country || "", countryCode: code
          });
        }
      }
      const sessionsTotal = Object.keys(sessions).length;

      // Utilisateurs actifs — source fiable pour TOUS les utilisateurs.
      // asrar-main (pages/api/track.js) met à jour user_sessions/{uid}
      // (lastLoginAt / lastActivityAt) à chaque ouverture de l'app, que
      // l'utilisateur ait ou non autorisé la mesure détaillée ; au contraire,
      // analytics/visits (graphique de trafic) et le pays n'existent que pour
      // les comptes ayant coché « Autoriser la mesure des visites » dans leur
      // page Compte (account_settings/{uid}/analytics === true, décoché par
      // défaut). Fenêtres glissantes : 24 h, 7 j, 30 j.
      let active1 = 0, active7 = 0, active30 = 0;
      for (const s of Object.values(sessions)) {
        if (!s || typeof s !== "object") continue;
        const last = Math.max(Number(s.lastActivityAt) || 0, Number(s.lastLoginAt) || 0);
        if (last >= now - DAY) active1++;
        if (last >= now - 7 * DAY) active7++;
        if (last >= now - 30 * DAY) active30++;
      }
      // Nombre de comptes ayant autorisé la mesure détaillée (visites, pays).
      const analyticsOptIn = Object.values(settingsSnap.val() || {})
        .filter((st) => st && typeof st === "object" && st.analytics === true).length;
      // Pays : compteurs anonymes du mois (tous les comptes) dès qu'ils
      // existent ; sinon, repli sur les pays des comptes consentants.
      const geo = await loadGeo(db, now);
      let countryBase = sessionsTotal, countryPeriod = null;
      if (geo) {
        for (const key of Object.keys(countryCounts)) delete countryCounts[key];
        countryBase = 0;
        for (const [code, n] of Object.entries(geo.counts)) {
          const users = num(n);
          if (!users) continue;
          countryBase += users;
          const known = /^[A-Z]{2}$/.test(code) && code !== "XX";
          const key = known ? code : "";
          if (!countryCounts[key]) countryCounts[key] = { country: known ? countryName(code) : "Inconnu", countryCode: key, users: 0 };
          countryCounts[key].users += users;
        }
        countryPeriod = geo.month;
      }
      const countryBreakdown = Object.values(countryCounts)
        .filter((c) => c.countryCode) // le pays inconnu n'entre pas dans le classement…
        .sort((a, b) => b.users - a.users)
        .map((c) => ({ ...c, pct: countryBase ? Math.round((c.users / countryBase) * 1000) / 10 : 0 }));
      const unknownCountry = countryCounts[""]; // …mais reste visible séparément si non vide.

      // Activité récente — événements métier compréhensibles (connexion,
      // inscription, achat, abonnement offert) plutôt que le journal brut de
      // navigation (activity_feed), qui n'était qu'une suite de pages/e-mails
      // répétés.
      const recent = [...connectionEvents, ...signupEvents, ...subEvents]
        .sort((a, b) => b.at - a.at)
        .slice(0, 12);

      const admins = adminsSnap.val() || {};
      const adminsCount = Object.values(admins).filter((v) => v === true).length + 1; // +super-admin

      return res.json({
        kpis: {
          revenue30, revenueTotal, revenue7, sales30, sales7, salesTotal,
          activeSubs, newSubs7, newSubs30,
          usersTotal, new7, new30,
          uniqueToday: dayUniq[today] || 0, visitsToday: dayTotal[today] || 0,
          unique30: Math.max(uniq30.size, active30), uniqueAll: Math.max(uniqAll.size, sessionsTotal), visits30, visitsTotal,
          boutiques: Object.keys(profSnap.val() || {}).length,
          admins: adminsCount,
          vips: Object.keys(vipsSnap.val() || {}).length,
          active1, active7, active30, sessionsTotal, analyticsOptIn
        },
        spark,
        recent,
        countryBreakdown,
        countryPeriod,
        audienceAnonymous: Object.keys(audience).length > 0,
        unknownCountry: unknownCountry ? { users: unknownCountry.users, pct: countryBase ? Math.round((unknownCountry.users / countryBase) * 1000) / 10 : 0 } : null
      });
    }

    // ── ACTIVITÉ DES UTILISATEURS ────────────────────────────────────────
    // Écrit par asrar-main (pages/api/track.js) pour CHAQUE utilisateur connecté :
    //   user_sessions/{uid} = { email, country, countryCode, platform,
    //     lastLoginAt, lastActivityAt, lastPage, lastAction, lastActionAt }
    //   activity_feed/{push} = { email, type (visit|page|click|product_view…),
    //     page, label, country, countryCode, platform, at }
    // body.email (facultatif) : les actions d'un seul utilisateur.
    if (action === "activity") {
      const wanted = String(body.email || "").trim().toLowerCase();
      const [sessionsSnap, feedSnap] = await Promise.all([
        db.ref("user_sessions").once("value"),
        db.ref("activity_feed").limitToLast(wanted ? 5000 : 1000).once("value")
      ]);
      const sessions = Object.values(sessionsSnap.val() || {})
        .filter((s) => s && typeof s === "object" && s.email)
        .map((s) => ({
          email: String(s.email), country: s.country || "", countryCode: s.countryCode || "",
          platform: s.platform || "", loginAt: Number(s.lastLoginAt) || 0,
          activeAt: Math.max(Number(s.lastActivityAt) || 0, Number(s.lastActionAt) || 0),
          lastPage: s.lastPage || "", lastAction: s.lastAction || ""
        }))
        .sort((a, b) => (b.activeAt || b.loginAt) - (a.activeAt || a.loginAt))
        .slice(0, 500);
      const actions = Object.values(feedSnap.val() || {})
        .filter((e) => e && typeof e === "object" && (!wanted || String(e.email || "").toLowerCase() === wanted))
        .map((e) => ({
          at: Number(e.at) || 0, email: e.email || "", type: e.type || "", page: e.page || "",
          label: e.label || "", country: e.country || "", countryCode: e.countryCode || "", platform: e.platform || ""
        }))
        .sort((a, b) => b.at - a.at)
        .slice(0, wanted ? 300 : 200);
      return res.json({ sessions, actions, email: wanted || null });
    }

    // ── PUBLICITÉS AU CLIC ───────────────────────────────────────────────
    // Source : analytics/ads/{AAAA-MM-JJ}={opened,quick,closed,open}, écrit par
    // asrar-main (pages/api/track.js, type « ad_stats ») : onglet de pub fermé
    // en < 2 s (quick), avant la fin de l'attente de 5 s (closed), ou encore
    // ouvert (open). Seuls les comptes ayant activé les statistiques comptent.
    if (action === "ads") {
      const DAY = 864e5, SPAN = 90;
      const dstr = (ms) => new Date(ms).toISOString().slice(0, 10);
      const now = Date.now();
      const snap = await db.ref("analytics/ads").orderByKey().startAt(dstr(now - (SPAN - 1) * DAY)).once("value");
      const byDay = snap.val() || {};
      const n = (v) => Math.max(0, Number(v) || 0);
      const daily = [];
      for (let i = SPAN - 1; i >= 0; i--) {
        const date = dstr(now - i * DAY), d = byDay[date] || {};
        daily.push({ bucket: date, opened: n(d.opened), quick: n(d.quick), closed: n(d.closed), open: n(d.open) });
      }
      const pct = (part, whole) => (whole > 0 ? Math.round(part / whole * 1000) / 10 : null);
      const periods = {};
      for (const w of [7, 30, 90]) {
        const t = daily.slice(-w).reduce((a, r) => ({
          opened: a.opened + r.opened, quick: a.quick + r.quick, closed: a.closed + r.closed, open: a.open + r.open
        }), { opened: 0, quick: 0, closed: 0, open: 0 });
        periods["d" + w] = { ...t, quickRate: pct(t.quick, t.opened), closedRate: pct(t.closed, t.opened), openRate: pct(t.open, t.opened) };
      }
      // Domaines bloqués par la politique de sécurité du site (CSP) chez les
      // visiteurs, sur 7 jours : analytics/csp/{jour}/{directive}/{domaine}=n,
      // écrit par asrar-main (pages/api/csp-report.js ; « . » codé « , »).
      const cspSnap = await db.ref("analytics/csp").orderByKey().startAt(dstr(now - 6 * DAY)).once("value");
      const blockedMap = new Map();
      for (const day of Object.values(cspSnap.val() || {})) {
        for (const [directive, hosts] of Object.entries(day || {})) {
          if (directive === "_n" || !hosts || typeof hosts !== "object") continue;
          for (const [hostKey, count] of Object.entries(hosts)) {
            const id = directive + "|" + hostKey;
            blockedMap.set(id, (blockedMap.get(id) || 0) + n(count));
          }
        }
      }
      const blocked = [...blockedMap]
        .map(([id, count]) => { const [directive, hostKey] = id.split("|"); return { directive, host: hostKey.replace(/,/g, "."), count }; })
        .filter((b) => b.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 40);
      return res.status(200).json({ daily, periods, blocked });
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
      const [visitsSnap, feedSnap, profSnap, prodSnap, viewsSnap, ratingsSnap, commentsSnap] = await Promise.all([
        db.ref("analytics/visits").once("value"),
        db.ref("activity_feed").limitToLast(5000).once("value"),
        db.ref("profile_clients").once("value"),
        db.ref("det_produits").once("value"),
        db.ref("views/product").once("value"),
        db.ref("ratings/vendor").once("value"),
        db.ref("comments/vendor").once("value")
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
      // Compteurs anonymes (tous les comptes) : par jour, on garde le plus
      // grand des deux relevés ; semaines et mois additionnent les visites
      // et, pour les uniques, au moins le meilleur jour de la période (les
      // compteurs anonymes ne permettent pas d'union exacte sur plusieurs jours).
      const audience = await loadAudience(db, now, 400);
      const mergeAudience = (rows, keyFn) => {
        const map = new Map(rows.map((r) => [r.bucket, { ...r }]));
        const anon = {};
        for (const [date, a] of Object.entries(audience)) {
          const b = keyFn(date);
          const cur = anon[b] || (anon[b] = { total: 0, uniqueMax: 0 });
          cur.total += num(a && a.visits);
          cur.uniqueMax = Math.max(cur.uniqueMax, num(a && a.unique));
        }
        for (const [bucket, a] of Object.entries(anon)) {
          const r = map.get(bucket) || { bucket, unique: 0, total: 0 };
          r.total = Math.max(r.total, a.total);
          r.unique = Math.max(r.unique, a.uniqueMax);
          map.set(bucket, r);
        }
        return [...map.values()].sort((a, b) => (a.bucket < b.bucket ? -1 : 1));
      };
      const daily = mergeAudience(bucketize((d) => d), (d) => d);
      const weekly = mergeAudience(bucketize(isoWeek), isoWeek);
      const monthly = mergeAudience(bucketize((d) => d.slice(0, 7)), (d) => d.slice(0, 7));

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
      // Mêmes fenêtres d'après les jours fusionnés (compteurs anonymes
      // compris) : visites additionnées ; uniques = au moins le meilleur jour.
      const byDay = new Map(daily.map((r) => [r.bucket, r]));
      const windowFrom = (w, back) => {
        let total = 0, uniqueMax = 0;
        for (let i = back; i < back + w; i++) {
          const r = byDay.get(dstr(now - i * DAY));
          if (r) { total += r.total; uniqueMax = Math.max(uniqueMax, r.unique); }
        }
        return { total, uniqueMax };
      };
      const pct = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);
      const mergedTotal = daily.reduce((sum, r) => sum + r.total, 0);
      const periods = { all: { unique: allUids.size, total: Math.max(totalVisits, mergedTotal), deltaUnique: null, deltaTotal: null } };
      for (const w of WINDOWS) {
        const cur = windowFrom(w, 0), prev = windowFrom(w, w);
        const unique = Math.max(curSet[w].size, cur.uniqueMax), prevUnique = Math.max(prevSet[w].size, prev.uniqueMax);
        const total = Math.max(curTotal[w], cur.total), prevTot = Math.max(prevTotal[w], prev.total);
        periods["d" + w] = {
          unique, total,
          deltaUnique: pct(unique, prevUnique),
          deltaTotal: pct(total, prevTot)
        };
      }
      periods.all.unique = Math.max(periods.all.unique, ...WINDOWS.map((w) => periods["d" + w].unique));

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

      // Boutiques (profile_clients). La première version de « J'aime » comptait
      // les champs booléens écrits DIRECTEMENT sur profile_clients/{id} —
      // toujours à 0 en pratique, alors que le Marché affiche de vrais avis.
      // Les avis/notes réels vivent dans ratings/vendor/{clé}/{uid} = note 1-5
      // (même schéma que ratings/product, cf. pages/api/shop.js « stats ») et
      // comments/vendor/{clé}/{commentId} ; { clé } = uid vendeur classique OU
      // id de la fiche profile_clients selon ce que le Marché écrit côté client.
      // ⚠️ La clé exacte utilisée pour une boutique « profil » (id vs uid une
      // fois liée) n'a pas pu être revérifiée sur le dépôt asrar-main depuis
      // cette session — à confirmer avec de vraies données une fois déployé.
      // Remplace « J'aime » (mécanisme non retrouvé, jamais alimenté) par une
      // vraie note + un vrai compte d'avis/commentaires.
      const ratingsVal = ratingsSnap.val() || {};
      const commentsVal = commentsSnap.val() || {};
      const vendorEntries = (all, id, uid) => all[id] || (uid && all[uid]) || {};

      const prof = profSnap.val() || {};
      const boutiques = Object.entries(prof).map(([id, pc]) => {
        const products = ownerProducts(pc && pc.uid, pc && pc.email);
        const ratings = vendorEntries(ratingsVal, id, pc && pc.uid);
        const ratingValues = Object.values(ratings).map(Number).filter((n) => n >= 1 && n <= 5);
        const rating = ratingValues.length
          ? Math.round((ratingValues.reduce((s, n) => s + n, 0) / ratingValues.length) * 10) / 10
          : 0;
        return {
          id,
          name: (pc && pc.profile_name) || id,
          img: (pc && pc.img) || "",
          number: (pc && pc.number) || "",
          follow: pc && pc.follow != null ? (Number(pc.follow) || 0) : 0,
          rating, ratingsCount: ratingValues.length,
          comments: Object.keys(vendorEntries(commentsVal, id, pc && pc.uid)).length,
          products: products.length,
          views: products.reduce((s, p) => s + p.views, 0),
          productList: products.slice(0, 20)
        };
      }).sort((a, b) => b.views - a.views || b.ratingsCount - a.ratingsCount || b.follow - a.follow);

      // Répartition par appareil (visiteurs uniques sur 30 jours) : catégorie
      // écrite par asrar-main à chaque visite (analytics/visits/{jour}/{uid}/
      // platform, lib/platform.js) — application Android, site Android, iPhone,
      // ordinateur. Un visiteur est compté dans sa catégorie la plus récente.
      // « inconnu » : visites d'avant l'ajout de ce relevé.
      const PLATFORM_IDS = ["android_app", "android_web", "ios", "desktop"];
      const latest = new Map();
      const from30 = dstr(now - 30 * DAY);
      for (const [date, users] of Object.entries(visits).sort()) {
        if (date < from30) continue;
        for (const [uid, u] of Object.entries(users || {})) latest.set(uid, u && u.platform);
      }
      const platforms = { android_app: 0, android_web: 0, ios: 0, desktop: 0, inconnu: 0 };
      for (const p of latest.values()) platforms[PLATFORM_IDS.includes(p) ? p : "inconnu"]++;
      // Compteurs anonymes (tous les comptes) sur 30 jours : visiteurs
      // uniques par jour additionnés — retenus s'ils couvrent plus de monde.
      const anonPlatforms = { android_app: 0, android_web: 0, ios: 0, desktop: 0, inconnu: 0 };
      for (const [date, a] of Object.entries(audience)) {
        if (date < from30) continue;
        for (const [p, n] of Object.entries((a && a.platforms) || {})) anonPlatforms[PLATFORM_IDS.includes(p) ? p : "inconnu"] += num(n);
      }
      const sumOf = (o) => Object.values(o).reduce((x, y) => x + y, 0);
      if (sumOf(anonPlatforms) > sumOf(platforms)) Object.assign(platforms, anonPlatforms);

      return res.json({
        daily: daily.slice(-90), weekly, monthly, topPages, recent, boutiques,
        periods, platforms,
        totals: {
          uniqueAllTime: periods.all.unique,
          totalVisits: periods.all.total,
          days: daily.length,
          events: Object.keys(feed).length,
          boutiques: boutiques.length,
          avisTotal: boutiques.reduce((s, b) => s + b.ratingsCount, 0),
          pagesTotal
        }
      });
    }

    return res.status(400).json({ error: "Action inconnue" });
  } catch (e) {
    return res.status(500).json({ error: "Erreur serveur : " + e.message });
  }
};

