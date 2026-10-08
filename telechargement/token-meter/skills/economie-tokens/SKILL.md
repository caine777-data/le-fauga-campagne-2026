---
name: economie-tokens
description: Économiser les tokens et garder un contexte sain dans Claude Code et claude.ai. Déclencher quand l'utilisateur dit « économise des tokens », « ça consomme trop », « je suis à X % de contexte », « mes limites fondent », « pourquoi ce tour a coûté autant », « lis le panneau Tokens », « optimise le contexte », « reduce token costs », « optimize context », ou quand le panneau / la ligne de statut token-meter montre un contexte ≥ 70 %, un faible taux de cache ou un pic. Couvre le diagnostic (lire /tokens et /context), les leviers concrets (compact, clear, sous-agents, lectures ciblées, modèle, skills/MCP), le cache de prompt, et les gestes propres au travail d'écriture sur manuscrit. Pour concevoir un système d'agents (code), voir references/systemes-agents.md.
---

# Économie de tokens

But : dépenser les tokens là où ils servent le travail, pas dans le bruit. On ne cherche pas le minimum absolu ; on cherche à ne jamais payer deux fois la même chose et à ne pas traîner un contexte plein de déchets.

## 1. Mesurer d'abord (30 secondes)

Avant de conseiller quoi que ce soit, lire l'état réel :

- **Ligne de statut token-meter** : `ctx ███░ 62% · dernier tour 12k (↑1.5k) · $1.23 · 5h 23%`.
- **`/tokens`** (panneau) : catégories du contexte, taux de cache, courbe par tour, sous-agents.
- **`/context`** : la même répartition, détaillée par fichier mémoire, outil MCP, skill.
- **`/cost`** : coût de la session.

Si l'utilisateur colle ou décrit ces chiffres, partir de là. Sinon, lui demander d'ouvrir `/tokens` plutôt que de deviner.

## 2. Lire le diagnostic : symptôme → cause → geste

| Ce que montre le panneau | Cause probable | Geste |
|---|---|---|
| Contexte ≥ 70 % | Historique long, gros résultats d'outils accumulés | `/compact` **avec consigne** (« garde les décisions et l'état du Ch.12, jette les lectures ») |
| Bandeau ⚠ au-dessus de la saisie | Contexte ≥ 70 %, avec prévision « 85 % dans ~N tours » | Bouton **Compacter** (consigne déjà rédigée : garder décisions, chapitres en cours, consignes de style) |
| Contexte ≥ 85 % | Compaction automatique imminente, perte de contrôle sur ce qui est gardé | `/compact` maintenant, ou `/clear` si la tâche est finie |
| Catégorie **Messages** dominante | Conversation qui s'étire, tâches enchaînées | `/clear` entre tâches sans lien ; résumer l'acquis dans un fichier avant |
| Catégorie **Outils MCP / System tools** lourde | Serveurs MCP ou connecteurs inutiles chargés | Désactiver les connecteurs non utilisés pour ce projet |
| Catégorie **Skills** lourde | Beaucoup de skills installées : chaque description est relue à chaque tour | Retirer les skills jamais utilisées ; raccourcir les descriptions trop bavardes |
| Catégorie **Memory files** lourde | CLAUDE.md long ou bible/plan importés en mémoire | CLAUDE.md court (règles), le détail dans des fichiers lus à la demande |
| **Taux de cache < 50 %** sur plusieurs tours | Préfixe instable, ou pauses longues : le cache expire (≈ 5 min, parfois 1 h) | Éviter de modifier CLAUDE.md/skills en pleine session ; enchaîner les échanges plutôt que revenir après une longue pause sur un gros contexte |
| **Pic** sur la courbe, gros « ↓ » (cache écrit) | Reprise après pause (cache expiré) ou gros fichier injecté | Normal une fois ; si répété : `/compact` avant la pause, lectures plus ciblées |
| Gros « ↑ » (sortie) | Réponses longues, réécritures complètes de fichiers/chapitres | Demander des diffs / chercher-remplacer plutôt que le texte entier |
| **Sous-agents** élevés | Recherches larges déléguées (normal) ou délégation inutile | Déléguer seulement les balayages larges ; tâche ciblée = faire soi-même |
| Limite **5h / 7j** qui monte vite | Gros modèle sur tâches simples, contexte toujours plein | `/model` plus léger pour le mécanique ; compacter plus tôt |

## 3. Les leviers, du plus rentable au moins rentable

1. **`/clear` entre tâches sans rapport.** Le geste le plus rentable : chaque tour relit tout le contexte. Avant, écrire l'état utile dans un fichier (plan, notes de chapitre) pour le relire plus tard en une lecture.
2. **`/compact <consigne>`** quand on continue la même tâche. Toujours dire quoi garder : décisions prises, fichiers en cours, prochaines étapes. Sans consigne, le résumé garde ce qu'il juge important, pas forcément ce qui l'est pour toi.
3. **Lire petit.** `Grep` d'abord, puis `Read` avec `offset`/`limit` sur la zone utile. Ne jamais relire un fichier déjà lu et non modifié. Éviter `cat` de gros fichiers dans Bash.
4. **Déléguer les balayages larges** (Explore / sous-agent) : la recherche coûteuse reste dans son contexte, seul le résultat revient. À ne pas faire pour une tâche ciblée : le sous-agent repart de zéro et relit ce qu'on savait déjà.
5. **Sorties courtes.** Diffs et chercher/remplacer plutôt que réécrire un fichier ou un chapitre entier ; demander une synthèse plutôt qu'un rapport exhaustif.
6. **Bon modèle, bon effort.** Modèle léger pour le mécanique (renommer, formater, grep), gros modèle pour le jugement (structure, style).
7. **Garder le cache chaud.** Ne pas toucher CLAUDE.md, les skills ou les connecteurs au milieu d'une session longue (ça casse le préfixe) ; une lecture en cache coûte environ un dixième d'une lecture normale.
8. **Alléger l'outillage permanent.** Skills, connecteurs MCP et CLAUDE.md sont payés à chaque tour : n'installer que ce qui sert au projet.

## 4. Travail d'écriture (manuscrit, bible, plan)

- **Un chapitre à la fois.** Ne pas coller le manuscrit entier ; pointer le fichier du chapitre et lire la scène concernée.
- **Bible et plan en fichiers**, pas en mémoire permanente : les lire quand la question l'exige.
- **Passes globales** (tics, répétitions, cohérence de noms sur tout le roman) : `grep` ou sous-agent, qui rend une liste, plutôt que charger tous les chapitres dans la conversation.
- **Corrections en chercher/remplacer** (format déjà utilisé par les skills d'écriture) plutôt que réécriture intégrale : la sortie coûte plus cher que l'entrée.
- **Après une grosse session de polissage** : noter les décisions dans le plan, puis `/clear` avant le chapitre suivant.

## 5. Garde-fou de lecture (mod token-meter)

Le mod retient **une fois** deux sortes de `Read` : un gros fichier (> 80 Ko) lu en entier sans `offset`/`limit`, et la relecture d'une plage déjà lue et inchangée dans le même contexte. Le refus commence par `token-meter :`.

Quand la tâche **exige** le texte entier (relecture totale, cohérence des noms ou de la chronologie sur tout le roman, résumé global, comparaison de chapitres éloignés), il ne faut jamais renoncer ni répondre de mémoire. Trois voies, toutes autorisées :

1. **Relancer exactement le même `Read`** : la seconde tentative passe toujours.
2. **Lire par tranches** (`offset`/`limit`, 2 000 lignes) : jamais retenu, et c'est de toute façon nécessaire au-delà de 2 000 lignes.
3. Si l'utilisateur a écrit « en entier », « intégral », « tout le manuscrit », « relecture totale »…, le garde-fou de taille est suspendu pour tout le tour.

Pour un manuscrit très long, préférer un **sous-agent** qui lit tout et rend une synthèse ou une liste de problèmes : le texte intégral reste dans son contexte, pas dans la conversation principale. `/tokens-garde` coupe ou réactive le garde-fou.

Après un refus pour relecture : si le contenu a disparu du contexte (compaction, `/clear`), relancer ; le mod oublie de lui-même ce qui a été lu après une compaction ou un `/clear`.

## 6. Répondre à l'utilisateur

1. Donner les 2 ou 3 chiffres qui comptent (contexte %, catégorie dominante, taux de cache ou pic).
2. Nommer la cause en une phrase.
3. Proposer **un** geste concret, le plus rentable, avec la commande exacte (`/compact garde …`).
4. Ne pas faire de cours : le tableau ci-dessus suffit, on pioche la ligne qui correspond.

## Pour aller plus loin

- `references/systemes-agents.md` : techniques pour **concevoir** un système d'agents (compaction programmatique, masquage d'observations, budgets, ordonnancement pour le cache KV). Ne la lire que si l'on écrit du code d'agent, pas pour l'usage courant de Claude.
