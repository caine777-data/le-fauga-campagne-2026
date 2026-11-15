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
- **Médias et setup.exe en local** (voir plus bas) : trois sous-agents appelés d'office et deux scripts Python.
- **Commandes bavardes rendues silencieuses** : `ffmpeg`/`ffprobe` sans bannière ni progression, PyInstaller en `WARN`.
- **Garde-fou médias** : un `Read` de vidéo/son, ou d'une image > 500 Ko, est retenu une fois avec la commande d'aperçu à lancer.
- **Skill `economie-tokens`** : diagnostic symptôme → cause → geste, leviers classés, conseils pour le travail sur manuscrit.

## Sous-agents et scripts locaux

Le mod déclare trois types de sous-agents que Claude appelle de lui-même quand la demande s'y prête. Le travail lourd (images, journaux, lectures) reste dans leur contexte ; seule une réponse de quelques lignes revient.

| Sous-agent | Modèle | Pour |
|---|---|---|
| `token-meter:media` | Haiku | montage, découpe, assemblage, compression, GIF, lot d'images, « regarder » une vidéo |
| `token-meter:setup-exe` | Sonnet | `.exe` et `setup.exe` (PyInstaller → Inno Setup ou NSIS), réparation d'un build |
| `token-meter:lecteur` | Haiku | lire un manuscrit, de gros journaux ou un dossier entier et n'en rendre que l'essentiel |

Les scripts marchent aussi seuls, sans Claude :

```
python scripts/media.py info video.mp4
python scripts/media.py planche video.mp4          # 12 vignettes horodatées en UNE image
python scripts/media.py apercu photo.jpg           # copie ≤ 768 px
python scripts/media.py couper in.mp4 0:12 0:45 out.mp4
python scripts/media.py assembler film.mp4 a.mp4 b.mp4
python scripts/media.py compresser in.mp4 out.mp4 --crf 28
python scripts/media.py reduire photos/ --max 1600 --dest web/

python scripts/build_setup.py --verifier
python scripts/build_setup.py --entree app.py --nom MonAppli --version 1.0.0 --icone app.ico --fenetre
```

Prérequis sous Windows : Python, `winget install Gyan.FFmpeg`, `pip install pyinstaller`, `winget install JRSoftware.InnoSetup` (ou NSIS).

## Commandes

| Commande | Effet |
|---|---|
| `/tokens` | Ouvre / ferme le widget |
| `/tokens-garde` | Active / coupe le garde-fou (lectures, médias, commandes silencieuses) |
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
