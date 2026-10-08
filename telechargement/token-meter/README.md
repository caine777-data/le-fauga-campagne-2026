# token-meter

Mod Claude Code pour **voir et réduire** la consommation de tokens.

## Installation

```
/plugin install token-meter --marketplace caine777-data/token-meter
```

Répondre `y` pour ajouter la marketplace, puis choisir la portée (utilisateur conseillé).
Le dépôt est privé : il faut que ton compte GitHub y ait accès.

## Ce qu'il fait

- **Ligne de statut** : jauge de contexte, tokens du dernier tour, coût, limites 5 h / 7 j.
- **Panneau `/tokens`** : catégories du contexte, totaux (entrée, cache lu/écrit, sortie), taux de cache, sous-agents, prévisions, garde-fou, conseils, courbe et détail des derniers tours.
- **Bandeau d'alerte** dès 70 % de contexte : boutons *Compacter* (consigne de compaction prête), *Détails*, *Masquer*.
- **Prévisions** : « 85 % de contexte dans ~N tours », « limite 5 h atteinte dans ~1 h 20 ».
- **Alertes** : seuils 70 / 85 %, pics de consommation avec leur cause probable.
- **Garde-fou de lecture** : retient une fois la lecture intégrale d'un gros fichier (> 80 Ko) et la relecture d'un fichier inchangé.
  La lecture intégrale reste toujours possible : relancer la même lecture, lire par tranches, écrire « en entier / intégral / relecture totale » dans la demande, ou `/tokens-garde` pour couper le garde-fou.
- **Skill `economie-tokens`** : diagnostic symptôme → cause → geste, leviers classés, conseils pour le travail sur manuscrit.

## Commandes

| Commande | Effet |
|---|---|
| `/tokens` | Ouvre le panneau |
| `/tokens-conseils` | Diagnostic express |
| `/tokens-garde` | Active / coupe le garde-fou de lecture |
| `/tokens-reset` | Remet l'historique à zéro |

## Développement

```
claude plugin validate .
claude plugin test .
```
