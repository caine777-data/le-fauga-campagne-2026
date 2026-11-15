# Brief : économie de tokens (token-meter 0.4.0)

*Mis à jour le 15/11/2026. Branche `claude/token-savings-media-local-5bq1t9`.*

## Ce que montrent tes discussions (≈ 50 dernières)

| Constat | Où | Réponse |
|---|---|---|
| Discussions de plusieurs semaines : chaque message relit tout l'historique (164 000 tokens dans la discussion Gemini, avec un blocage par la limite des 5 h) | Ludus Latinus, Dédale, Capitaine Spade, site papp | **`/passation`** puis `/clear` |
| Génération d'images (gravures, art de jeu), alors que ComfyUI + Flux tournent déjà sur ton PC | Légendes carolingiennes, Ludus, Capitaine Spade | sous-agent **image**, trois voies au choix |
| Reels, bandes-annonces, chaîne YouTube, migration de 57 vidéos | Ogier Instagram, Reels, Prismes | sous-agent **media** + `monter` (automatique) |
| Fabrication de .exe et de versions | RamWatch, PodAdmin, Dédale | sous-agent **setup-exe** |
| Relectures de manuscrits | Ogier, livre enquête, analyse de style | sous-agent **lecteur** |
| LLM local (Ollama) testé et abandonné | Gemini possibilities | pas repris : décision gardée |

## Tes choix (15/11)

- **Génération d'image** : Claude te demande la voie à chaque fois (local ComfyUI / fiche à coller dans Gemini / API payante).
- **Montage** : entièrement automatique, en local (plus de CapCut).
- **`/passation`** : oui. Guide des connecteurs : non.

## Ce qui existe maintenant

| Élément | Rôle |
|---|---|
| `scripts/media.py` | info, apercu, planche, galerie, couper, assembler, compresser, reduire, gif, extraire-audio, **monter** (plan texte → film 9:16 ou 16:9, avec cartons, textes, zoom, fondus et musique qui baisse sous les voix) |
| `scripts/generer.py` | `comfy` (ComfyUI local), `fiche` + `entrants` (Gemini à la main), `api` (Gemini, payant) |
| `scripts/build_setup.py` | PyInstaller → Inno Setup ou NSIS → setup.exe, journal à part |
| Sous-agents | `media` (Haiku), `image` (Haiku), `setup-exe` (Sonnet), `lecteur` (Haiku) |
| Automatismes | ffmpeg et PyInstaller rendus silencieux ; lecture d'une vidéo ou d'une image > 500 Ko retenue une fois avec la bonne commande |
| `/passation` | écrit `ETAT.md` ; au démarrage suivant, un message signale qu'il existe |

## Testé / pas testé

- Testé ici : toutes les commandes `media.py` (dont un montage 9:16 vérifié à l'œil), `build_setup.py` jusqu'à un vrai setup.exe NSIS, `generer.py comfy` contre un faux serveur ComfyUI, `fiche` et `entrants`, plus les 22 tests du mod.
- **À tester chez toi** : ComfyUI réel (`generer.py comfy --verifier`), Inno Setup, l'API Gemini (le nom du modèle peut changer : option `--modele`), et les sous-agents et `/passation` dans une vraie session.

## Pour installer

`/plugin marketplace update token-meter`, puis redémarrer Claude Code. Sur le PC : `winget install Gyan.FFmpeg`, `pip install pyinstaller`, `winget install JRSoftware.InnoSetup`.

## Pistes suivantes (pas encore faites)

1. Mettre ton workflow Flux exporté (« Save (API) ») dans `scripts/workflows/` pour que `comfy` utilise exactement tes réglages.
2. Sous-titres automatiques des Reels (transcription locale avec faster-whisper) dans `monter`.
3. Fiche Gemini aussi pour la **vidéo** (Veo), sur le même principe.
