/**
 * Médias et constructions : faire travailler la machine, pas le contexte.
 *
 * - Une image lue coûte environ (largeur × hauteur) / 750 tokens, jusqu'à ~1 600 ;
 *   un aperçu réduit à 768 px en coûte ~800, une planche de 12 vignettes en vaut UNE.
 * - Une vidéo ou un son ne se « lit » pas : on en tire info, aperçu ou planche.
 * - ffmpeg et PyInstaller écrivent des centaines de lignes (bannière, progression,
 *   INFO) : on les fait taire, seules les erreurs remontent.
 */

const VIDEO_AUDIO = /\.(mp4|mov|m4v|mkv|avi|webm|wmv|flv|mts|m2ts|3gp|mp3|wav|m4a|aac|flac|ogg|opus)$/i
const IMAGE = /\.(png|jpe?g|webp|gif|bmp|tiff?|heic)$/i

/** Au-delà, une image vaut d'être réduite avant d'être regardée. */
export const BIG_IMAGE_BYTES = 500_000

export type MediaVerdict = { kind: 'allow' } | { kind: 'deny'; reason: string; why: 'video' | 'image' }

const kb = (bytes: number): string => `${Math.round(bytes / 1000)} Ko`

const q = (s: string): string => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s)

/** Ce que le garde-fou fait d'un Read sur un fichier média. */
export const judgeMedia = (filePath: string, size: number | undefined, script: string): MediaVerdict => {
  const media = `python ${q(script)}`
  if (VIDEO_AUDIO.test(filePath)) {
    return {
      kind: 'deny',
      why: 'video',
      reason:
        `token-meter : ${filePath} est une vidéo ou un son, Read ne peut pas le lire utilement. ` +
        `Infos : \`${media} info ${q(filePath)}\` ; voir le contenu : \`${media} planche ${q(filePath)}\` ` +
        `(une seule image de 12 vignettes horodatées) puis Read de cette planche. ` +
        'Pour un montage, délègue au sous-agent token-meter:media.',
    }
  }
  if (IMAGE.test(filePath) && size !== undefined && size > BIG_IMAGE_BYTES) {
    return {
      kind: 'deny',
      why: 'image',
      reason:
        `token-meter : ${filePath} pèse ${kb(size)}. Pour la regarder, crée d'abord un aperçu réduit : ` +
        `\`${media} apercu ${q(filePath)}\` (≤ 768 px, moitié moins de tokens) et lis celui-là. ` +
        'Si le détail en pleine résolution est nécessaire, relance exactement ce même Read : il sera autorisé.',
    }
  }
  return { kind: 'allow' }
}

const FFMPEG = /(^|[\s;&|(`])((?:[\w./\\:-]*[\\/])?(ffmpeg|ffprobe)(?:\.exe)?)(?=\s)/g
const PYINSTALLER = /(^|[\s;&|(`])((?:python3?\s+-m\s+)?(?:PyInstaller|pyinstaller)(?:\.exe)?)(?=\s)/g

/**
 * Rend une commande Bash bavarde silencieuse, sans en changer le sens :
 * ffmpeg/ffprobe sans bannière ni progression, PyInstaller en WARN.
 * Rien n'est touché si la commande règle déjà son niveau de journal.
 */
export const quietCommand = (cmd: string): string => {
  let out = cmd
  if (!/-hide_banner/.test(out)) {
    out = out.replace(FFMPEG, (_m, pre: string, bin: string, name: string) =>
      `${pre}${bin} -hide_banner${name.toLowerCase() === 'ffmpeg' && !/-nostats|-stats\b|-progress/.test(cmd) ? ' -nostats' : ''}`,
    )
  }
  if (!/--log-level|--debug/.test(out)) {
    out = out.replace(PYINSTALLER, (_m, pre: string, bin: string) => `${pre}${bin} --log-level WARN`)
  }
  return out
}

// ── Sous-agents ─────────────────────────────────────────────────────────────

export type AgentDef = {
  name: string
  description: string
  prompt: string
  tools: string[]
  model: string
}

const RULES_SHARED = `Règles d'économie (impératives) :
- Ta réponse finale est courte : ce qui a été fait, les chemins des fichiers produits, les problèmes. Jamais de journal brut.
- N'affiche jamais une sortie longue : redirige vers un fichier et lis-le par Grep ou par tranches.
- Ne lis jamais un fichier binaire (vidéo, son, exe, zip) avec Read.
- Ne réessaie pas en boucle : après deux échecs sur la même étape, arrête et explique.
- Réponds en français.`

export const agentDefs = (root: string): AgentDef[] => {
  const media = `python "${root}/scripts/media.py"`
  const build = `python "${root}/scripts/build_setup.py"`
  return [
    {
      name: 'media',
      model: 'haiku',
      tools: ['Bash', 'Read', 'Glob', 'Grep', 'Write'],
      description:
        "À utiliser AUTOMATIQUEMENT pour tout travail sur images, vidéos ou sons : découper, assembler, monter, compresser, convertir, recadrer, réduire un lot d'images, extraire l'audio, faire un GIF, regarder/décrire une vidéo, inspecter des médias. Il fait tourner ffmpeg en local et rend un résumé de quelques lignes, sans charger les médias dans la conversation principale. Lui donner : les fichiers, ce qu'il faut produire, où l'écrire.",
      prompt: `Tu es un opérateur média. Tout le travail se fait en local avec ffmpeg, par le script ${media}.

Commandes (une ligne de sortie chacune) :
- ${media} info FICHIER...                → durée, résolution, codecs, taille
- ${media} apercu FICHIER [--t 12] [--max 768] [-o x.jpg] → UNE image réduite (image ou instant d'une vidéo)
- ${media} planche VIDEO [--n 12] [--cols 4]  → UNE image de vignettes horodatées : la façon de « regarder » une vidéo
- ${media} couper ENTREE DEBUT FIN SORTIE [--exact]   (sans --exact : copie instantanée sans réencodage)
- ${media} assembler SORTIE A B C...
- ${media} compresser ENTREE SORTIE [--crf 28] [--max 1920]
- ${media} reduire DOSSIER|IMAGES... [--max 1600] [--dest dossier]
- ${media} extraire-audio VIDEO SORTIE.mp3
- ${media} gif VIDEO SORTIE.gif [--debut s] [--duree s] [--largeur 480]
- ${media} ffmpeg ARGS...  → n'importe quelle commande ffmpeg, silencieuse, journal à part

Méthode :
1. Commence par \`info\` : ne devine jamais durée, format ou résolution.
2. Pour voir une image, lis son \`apercu\`, jamais l'original lourd. Pour voir une vidéo, lis UNE \`planche\` ; affine avec une planche sur un extrait ou un \`apercu --t\` précis, pas avec des dizaines d'images.
3. Pour un montage complexe (filtres, superpositions, sous-titres), écris la commande ffmpeg complète une fois, lance-la via \`${media} ffmpeg\`, vérifie le résultat par \`info\` puis une \`planche\`.
4. Ne regarde le résultat que si la demande l'exige (qualité visuelle, cadrage) ; sinon \`info\` suffit.

${RULES_SHARED}`,
    },
    {
      name: 'setup-exe',
      model: 'sonnet',
      tools: ['Bash', 'Read', 'Glob', 'Grep', 'Edit', 'Write'],
      description:
        "À utiliser AUTOMATIQUEMENT pour fabriquer un exécutable ou un installateur Windows : setup.exe, .exe, PyInstaller, Inno Setup, NSIS, empaqueter une appli Python, corriger une construction qui échoue. Il lance la construction en local, garde les journaux (des milliers de lignes) hors de la conversation et rend le chemin du setup.exe ou l'erreur précise. Lui donner : le script principal, le nom de l'appli, la version, l'icône, les dossiers de données.",
      prompt: `Tu fabriques des exécutables et des installateurs Windows, en local, par le script ${build}.

- ${build} --verifier → ce qui est installé (Python, PyInstaller, Inno Setup, NSIS). Toujours en premier.
- ${build} --entree app.py --nom MonAppli [--version 1.0.0] [--icone app.ico] [--fenetre] [--onedir] [--donnees "assets;assets"] [--editeur "Nom"] [--sans-installeur]
  Étapes : PyInstaller (exe) puis Inno Setup (sinon NSIS) → dist/MonAppli-1.0.0-setup.exe. Un .iss ou .nsi à la racine du projet est réutilisé tel quel.
  Journal complet : build/setup-log.txt. À l'écran : OK par étape, ou les lignes d'erreur utiles.

Méthode :
1. \`--verifier\`. Manque PyInstaller : \`pip install pyinstaller\`. Manque Inno Setup : dire à l'utilisateur \`winget install JRSoftware.InnoSetup\` (ne pas installer de logiciel système sans accord).
2. Lance la construction. En cas d'échec, lis les lignes données ; si elles ne suffisent pas, \`Grep\` dans build/setup-log.txt (ex. "ModuleNotFoundError|Error|WARNING: Hidden import"), jamais le journal entier.
3. Corrections usuelles : module caché → --hidden-import via un .spec ou import explicite ; fichiers de données absents → --donnees ; antivirus qui bloque → --onedir.
4. Termine par : chemin et taille du setup.exe, ou l'erreur exacte et la correction proposée.

${RULES_SHARED}`,
    },
    {
      name: 'lecteur',
      model: 'haiku',
      tools: ['Read', 'Grep', 'Glob', 'Bash'],
      description:
        "À utiliser pour lire beaucoup de texte et n'en rendre que l'essentiel : manuscrit ou chapitres entiers, gros journaux, longs documents, PDF, export de données, dossier de fichiers à inventorier. Il lit tout dans son propre contexte et rend une synthèse, une liste de problèmes ou des passages précis avec numéros de ligne. Lui dire exactement quoi chercher et sous quelle forme rendre le résultat.",
      prompt: `Tu lis de gros volumes de texte pour quelqu'un d'autre et tu rends seulement ce qu'il a demandé.

Méthode :
1. Repère d'abord avec Grep/Glob ce qui est pertinent ; lis par tranches (offset/limit) ce qui doit être lu en entier.
2. Rends le résultat sous la forme demandée (liste, tableau, synthèse). Pour chaque point : fichier:ligne et une citation courte (une ligne max), pas de longs extraits.
3. Si la demande est ambiguë, choisis l'interprétation la plus utile et dis-la en une ligne.
4. Garde la réponse sous 400 mots, sauf si on t'a demandé une liste exhaustive.

${RULES_SHARED}`,
    },
  ]
}
