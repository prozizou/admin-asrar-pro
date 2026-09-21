// Synthetic browser fixtures only. Never loaded by the application.
const DAY = 86400000;
const now = Date.now();
const daily = Array.from({ length: 90 }, (_, index) => ({
  bucket: new Date(now - (89 - index) * DAY).toISOString().slice(0, 10),
  total: [240, 318, 265, 390, 350, 470, 410][index % 7] + Math.floor(index / 10) * 7,
  unique: [145, 198, 170, 230, 210, 290, 256][index % 7]
}));
const overview = {
  kpis: { revenueTotal: 2475000, revenue30: 385000, revenue7: 95000, salesTotal: 124, sales30: 18, sales7: 4, activeSubs: 98, newSubs30: 23, newSubs7: 7, usersTotal: 1284, new30: 156, new7: 37, unique30: 842, visits30: 9648, boutiques: 12, admins: 2, vips: 8 },
  spark: daily,
  countryBreakdown: [
    { country: 'Sénégal', countryCode: 'SN', users: 742, pct: 57.8 },
    { country: 'Côte d’Ivoire', countryCode: 'CI', users: 218, pct: 17 },
    { country: 'France', countryCode: 'FR', users: 154, pct: 12 },
    { country: 'Mali', countryCode: 'ML', users: 96, pct: 7.5 },
    { country: 'Guinée', countryCode: 'GN', users: 74, pct: 5.7 }
  ],
  recent: [
    { type: 'connection', email: 'amina@example.com', countryCode: 'SN', country: 'Sénégal', at: now - 60000 },
    { type: 'signup', email: 'moussa@example.com', at: now - 360000 },
    { type: 'grant', email: 'fatou@example.com', at: now - 540000 },
    { type: 'connection', email: 'ibrahima@example.com', countryCode: 'CI', country: 'Côte d’Ivoire', at: now - 1200000 },
    { type: 'purchase', email: 'aissatou@example.com', amount: 45000, at: now - 3600000 }
  ]
};
const nodes = {
  db_sirr_ouverture: { label: 'Sirr — Ouverture', page: 'Secrets et bienfaits' },
  db_sirr_protection: { label: 'Sirr — Protection', page: 'Secrets et bienfaits' },
  db_sirr_domptage: { label: 'Sirr — Domptage', page: 'Secrets et bienfaits' },
  db_sirr_ilham: { label: 'Sirr — Ilham', page: 'Secrets et bienfaits' },
  almaqtab: { label: 'Bibliothèque', page: 'Livres et documents' },
  formations: { label: 'Formations', page: 'Cours et rencontres' }
};
function response(endpoint, action, payload) {
  if (endpoint === 'stats' && action === 'overview') return overview;
  if (endpoint === 'content' && action === 'nodes') return { nodes };
  if (endpoint === 'content' && action === 'list') return { value: payload.node === 'formations' ? { course: { titre: 'Initiation à la géomancie' } } : { first: { titre: 'Les bienfaits du dhikr', sirr: 'Découvrez cette publication et les indications associées.' }, second: { titre: 'Ouverture et connaissance', sirr: 'Une nouvelle ressource pour enrichir votre bibliothèque.' }, third: { titre: 'Les noms et leurs bienfaits', sirr: 'Contenu détaillé de la publication.' } } };
  if (endpoint === 'users' && action === 'list_access') return { total: 3, items: ['amina', 'moussa', 'fatou'].map((name, i) => ({ email: name + '@example.com', active: true, level: i ? 15000 : 45000, expiresAt: now + 90 * DAY, at: now - DAY, lastActiveAt: now - 3600000, lastPage: 'Chapelet' })) };
  if (endpoint === 'formation-access') return { total: 0, items: [] };
  if (endpoint === 'market') return { totalShops: 0, totalProducts: 0, shops: [], products: [] };
  if (endpoint === 'fonts') return { fonts: [] };
  if (endpoint === 'referral') return { totals: { sponsors: 12, active: 10, blocked: 2, clicks: 840, conv: 12.5, points: 1400, rewards: 8 }, periods: { d30: { sponsors: 4, invited: 31 } }, daily: daily.map(row => ({ bucket: row.bucket, invited: Math.floor(row.total / 20) })), sponsors: [], alerts: [], settings: { enabled: true, pointsPerInvite: 10, rewardPoints: 100, rewardDays: 30, maxAccountAgeDays: 7 } };
  if (endpoint === 'stats' && action === 'analytics') return { totals: { boutiques: 12, avisTotal: 28, pagesTotal: 2400 }, periods: { d30: { unique: 842, total: 9648, interactions: 2140, deltaUnique: 12, deltaTotal: 18 } }, daily, monthly: [], topPages: [{ page: 'Chapelet', count: 1200 }, { page: 'Bibliothèque', count: 740 }, { page: 'Secrets', count: 460 }], boutiques: [] };
  return {};
}
module.exports = { overview, response };
