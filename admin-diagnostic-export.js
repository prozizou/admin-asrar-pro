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
      'Résolution : ' + stamp(item.resolvedAt), 'Positions des fichiers :', field(item.stack), '',
    ])).join('\n');
  };
  window.downloadDiagnostics = function (items, limited) {
    if (!items.length) return;
    try {
      const text = diagnosticsText(items, limited);
      const blob = new Blob(['\uFEFF', text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'asrar-diagnostics-' + new Date().toISOString().replace(/[:.]/g, '-') + '.txt';
      link.rel = 'noopener'; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      showToast('Téléchargement du fichier TXT demandé. Retrouvez-le dans les téléchargements de votre appareil.');
    } catch { showToast('Le fichier n’a pas pu être téléchargé. Réessayez dans votre navigateur.', 'err'); }
  };
})();
