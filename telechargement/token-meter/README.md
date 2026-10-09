# token-meter

Mod Claude Code pour **voir et réduire** la consommation de tokens.

## Installation

```
/plugin install token-meter --marketplace caine777-data/token-meter
```

Répondre `y` pour ajouter la marketplace, puis choisir la portée (utilisateur conseillé).
Le dépôt est privé : il faut que ton compte GitHub y ait accès.

## Ce qu'il fait

- **Icône cliquable** : un simple symbole au bout de la ligne grise sous la zone de saisie. Il se remplit avec le contexte (○ ◔ ◑ ◕ ●), s'allume et affiche le pourcentage à partir de 70 %. Un clic ouvre ou ferme le widget.
- **Widget à la demande** (clic sur l'icône ou `/tokens`, Échap pour fermer), en 4 onglets (touches 1 à 4) :
  - **Aperçu** : jauge de contexte, coût de la session, dernier tour, taux de cache, limites 5 h / 7 j, prévisions, conseil du moment ;
  - **Contexte** : répartition par catégorie et conseils ;
  - **Tours** : courbe et détail des derniers tours ;
  - **Garde-fou** : compteurs et bouton pour le couper ou l'activer.
- **Discret** : rien d'affiché en permanence, à part le symbole. Deux notifications seulement : contexte à 85 % et tour anormalement coûteux.
- **Garde-fou de lecture** : retient une fois la lecture intégrale d'un gros fichier (> 80 Ko) et la relecture d'un fichier inchangé. La lecture intégrale reste toujours possible : relancer la même lecture, lire par tranches, écrire « en entier / intégral / relecture totale » dans la demande, ou `/tokens-garde`.
- **Skill `economie-tokens`** : diagnostic symptôme → cause → geste, leviers classés, conseils pour le travail sur manuscrit.

## Commandes

| Commande | Effet |
|---|---|
| `/tokens` | Ouvre / ferme le widget |
| `/tokens-garde` | Active / coupe le garde-fou de lecture |
| `/tokens-reset` | Remet l'historique à zéro |

## Mise à jour

Remplacer le dossier par la nouvelle version, puis dans Claude Code :

```
/plugin marketplace update token-meter
```

et redémarrer Claude Code.

## Développement

```
claude plugin validate .
claude plugin test .
```
