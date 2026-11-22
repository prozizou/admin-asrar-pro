# Supprimer tous les diagnostics — admin-v42

Dans Bugs et lenteurs, « Tout supprimer » exige la saisie exacte de SUPPRIMER. L’action vise tous les incidents enregistrés (ouverts/résolus, visibles/masqués par les filtres, au-delà de la liste chargée de 500 groupes et de sa fenêtre de consultation). Exporter les données souhaitées avant confirmation.

L’API exige un administrateur puis supprime atomiquement la seule racine app_diagnostics et audite l’action diagnostic:delete_all. Elle ne lit pas tous les incidents, ne touche pas aux statistiques, comptes ou contenus et ne remet pas à zéro les quotas app_diagnostic_limits. Les nouvelles écritures peuvent créer de nouveaux incidents après la suppression ; la collecte reste active.

Le bouton est désactivé pendant le chargement de la liste et la suppression. Une annulation ou un mot incorrect n’envoie aucune requête. Un échec conserve l’affichage existant. Aucun diagnostic de production n’est supprimé par les tests ou le déploiement de cette option.
