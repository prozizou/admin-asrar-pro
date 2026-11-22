# Export JSON — admin-v41

Bugs et lenteurs propose « Enregistrer en JSON » pour un incident et « Exporter les résultats en JSON » pour les résultats filtrés chargés. TXT reste disponible. Les fichiers .json sont encodés en UTF-8 sans BOM avec le type application/json et téléchargés localement, sans transfert à un service externe.

Le schéma version 1 contient application, exportedAt (ISO UTC), lagThresholdMs (seuil strict), groupCount, limited, retentionDays, notes et incidents. Chaque incident contient les champs connus du diagnostic ; les valeurs absentes sont null et les champs arbitraires ne sont pas exportés. Les nombres, booléens, chronologies et étapes restent structurés. Les dates numériques sont en ms Unix UTC ; les at des breadcrumbs sont relatifs à la navigation. Les données proviennent de la collecte nettoyée existante, sans nouveau suivi.

Les limites de collecte et de chargement, la distinction entre dernière occurrence et maximum du groupe, et les mesures indisponibles sont rappelées dans notes. Le JSON facilite l’analyse et n’ajoute pas de détails aux anciens rapports.
