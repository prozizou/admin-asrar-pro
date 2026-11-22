// Export local uniquement : les données déjà autorisées dans le panneau ne
// transitent par aucun service tiers. Téléchargement initié par un clic.
(function () {
  'use strict';
  const stamp = value => Number.isFinite(Number(value)) && Number(value) > 0 ? new Date(Number(value)).toISOString() : '—';
  const field = value => String(value == null || value === '' ? '—' : value).replace(/[\r\u0000]/g, '');
  window.diagnosticsText = function (items, limited) {
    const header = ['ASRAR PRO — Rapport de bugs et lenteurs', 'Export : ' + new Date().toISOString(), 'Seuil des nouvelles lenteurs : strictement plus de 1 000 ms.', 'Les répétitions sont regroupées ; les compteurs représentent les remontées reçues.', limited ? 'Attention : cet export porte sur les groupes chargés, dans la limite de 500. Utilisez les filtres pour sélectionner les incidents.' : '', 'Nombre de groupes exportés : ' + items.length, ''];
    return header.concat(items.flatMap((item, index) => [
      '============================================================',
      'Incident ' + (index + 1) + ' — ' + field(item.title),
      'Identifiant : ' + field(item.id), 'Type : ' + field(item.kind),
      'État : ' + (item.status === 'resolved' ? 'Résolu' : 'À traiter'),
      'Erreur : ' + field(item.name), 'Page : ' + field(item.page), 'API : ' + field(item.endpoint),
      'Version : ' + field(item.version), 'Appareil : ' + field(item.platform),
      'Occurrences reçues : ' + field(item.count),
      'Durée maximale (ms) : ' + field(item.maxDurationMs), 'HTTP : ' + field(item.statusCode || null),
      'Première remontée : ' + stamp(item.firstAt), 'Dernière remontée : ' + stamp(item.lastAt),
      'Connexion : ' + (typeof item.online === 'boolean' ? item.online ? 'En ligne' : 'Hors ligne' : 'Inconnue'),
      'Dernier compte concerné (UID) : ' + field(item.lastUid),
      'Contexte technique (dernière occurrence reçue) :',
      item.details ? JSON.stringify(item.details, null, 2) : 'Non collecté par cette ancienne version.',
      'Lecture : timings en ms ; auth = session, token = identité, headers = attente réseau/serveur, json = lecture/décodage. Chronologie : at = ms depuis l’ouverture de la page.',
      'Limites : état réseau déclaré par le navigateur ; une tâche bloquante ne fournit pas toujours sa pile causale. Les positions API sont celles de l’appelant. Aucun contenu privé ni jeton n’est collecté.',
      'Résolution : ' + stamp(item.resolvedAt), 'Positions des fichiers :', field(item.stack), '',
    ])).join('\n');
  };
  window.diagnosticsJson = function (items, limited) {
    const fields = ['id', 'kind', 'title', 'name', 'status', 'page', 'endpoint', 'version', 'platform', 'count', 'durationMs', 'maxDurationMs', 'statusCode', 'firstAt', 'lastAt', 'online', 'lastUid', 'resolvedAt', 'stack', 'details'];
    return JSON.stringify({
      schemaVersion: 1, application: 'ASRAR PRO', exportedAt: new Date().toISOString(),
      lagThresholdMs: 1000, thresholdComparison: 'strictly-greater-than',
      groupCount: items.length, limited: Boolean(limited), retentionDays: 30,
      notes: [
        'Les incidents sont regroupés ; count représente les remontées reçues.',
        'L’export contient uniquement les groupes sélectionnés ou les résultats filtrés chargés (500 maximum).',
        'Les durées et timings sont en ms ; les dates numériques sont en ms depuis Unix UTC. breadcrumbs.at est relatif à la navigation.',
        'details décrit le contexte collecté ; un ancien incident peut ne pas en posséder. La durée maximale et le contexte peuvent provenir de remontées différentes.',
        'statusCode 0 et durée 0 peuvent signifier une mesure indisponible. Le réseau est déclaré ou estimé par le navigateur ; la cause racine n’est pas toujours déterminable.',
      ],
      incidents: items.map(item => Object.fromEntries(fields.map(key => [key, item[key] ?? null]))),
    }, null, 2);
  };
  window.downloadDiagnostics = function (items, limited, format = 'txt') {
    if (!items.length) return;
    try {
      const json = format === 'json';
      const text = json ? diagnosticsJson(items, limited) : diagnosticsText(items, limited);
      const blob = new Blob([json ? '' : '\uFEFF', text], { type: json ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'asrar-diagnostics-' + new Date().toISOString().replace(/[:.]/g, '-') + (json ? '.json' : '.txt');
      link.rel = 'noopener'; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      showToast('Téléchargement du fichier ' + (json ? 'JSON' : 'TXT') + ' demandé. Retrouvez-le dans les téléchargements de votre appareil.');
    } catch { showToast('Le fichier n’a pas pu être téléchargé. Réessayez dans votre navigateur.', 'err'); }
  };
})();
