# Suppression d’un incident — admin-v40

Dans Bugs et lenteurs, ouvrir un incident puis choisir « Supprimer cet incident ». La confirmation précise le nombre de remontées regroupées. L’API vérifie le rôle administrateur, valide l’identifiant et supprime le seul groupe demandé par transaction Firebase. Si son compteur ou sa dernière date ont changé, la suppression est refusée (409) pour permettre une nouvelle lecture. L’action est inscrite dans l’audit administratif.

La suppression ne bloque pas la collecte : une nouvelle occurrence peut recréer ce groupe. Les quotas de collecte restent inchangés. Aucun incident de production n’est supprimé lors des tests ou du déploiement. Le TXT peut être enregistré avant suppression.
