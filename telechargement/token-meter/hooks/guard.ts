/** Above this size a Read with no offset/limit is held once (≈ 20k tokens). */
export const BIG_FILE_BYTES = 80_000

const BINARY = /\.(pdf|png|jpe?g|gif|webp|ipynb)$/i

/**
 * Words in the person's prompt that ask for a whole-text reading: the guard
 * stands aside for that turn.
 */
const FULL_READ =
  /\b(en entier|enti[eè]re?ment|int[ée]gral(e|ement)?|(tout|lis|lire|relis|relire) (le |la |les )?(manuscrit|roman|livre|texte|fichier|chapitres?)|manuscrit complet|roman complet|relecture (totale|compl[eè]te|int[ée]grale)|d'un bout [àa] l'autre|from start to finish|whole (file|manuscript|book)|read (it )?all)\b/i

export const wantsFullRead = (text: string): boolean => FULL_READ.test(text)

export type ReadCall = { file_path: string; offset?: number; limit?: number; pages?: string; agentId?: string }

export const readKey = (c: ReadCall): string =>
  [c.agentId ?? 'main', c.file_path, c.offset ?? '', c.limit ?? '', c.pages ?? ''].join('|')

export type GuardMemory = {
  /** Ranges read in the live context, by readKey: the file's mtime then. */
  seen: Map<string, number>
  /** Calls held once: the same call again goes through. */
  held: Set<string>
}

export type Verdict = { kind: 'allow'; overridden: boolean } | { kind: 'deny'; reason: string; why: 'big' | 'reread' }

const kb = (bytes: number): string => `${Math.round(bytes / 1000)} Ko`

/** What the guard does with one Read, given the file's size and mtime. */
export const judgeRead = (
  mem: GuardMemory,
  call: ReadCall,
  file: { size: number; mtimeMs: number } | undefined,
  isFullReadTurn: boolean,
): Verdict => {
  const key = readKey(call)
  if (mem.held.has(key)) {
    mem.held.delete(key)
    return { kind: 'allow', overridden: true }
  }
  if (file === undefined) return { kind: 'allow', overridden: false }

  const RETRY =
    'Si tu en as réellement besoin pour répondre, relance exactement ce même Read : il sera autorisé.'

  if (mem.seen.get(key) === file.mtimeMs) {
    mem.held.add(key)
    return {
      kind: 'deny',
      why: 'reread',
      reason: `token-meter : ${call.file_path} a déjà été lu dans ce contexte (même plage) et n'a pas changé depuis. Réutilise ce que tu as déjà lu. ${RETRY}`,
    }
  }

  const isWhole = call.offset === undefined && call.limit === undefined && call.pages === undefined
  if (!isFullReadTurn && isWhole && !BINARY.test(call.file_path) && file.size > BIG_FILE_BYTES) {
    mem.held.add(key)
    return {
      kind: 'deny',
      why: 'big',
      reason:
        `token-meter : ${call.file_path} pèse ${kb(file.size)} (≈ ${Math.round(file.size / 4000)}k tokens) et serait lu en entier. ` +
        'Si seule une partie sert, cherche-la avec Grep puis lis-la avec Read offset/limit. ' +
        `Si la lecture intégrale est nécessaire (relecture totale, cohérence d'ensemble…), lis-le par tranches avec offset/limit, ou : ${RETRY}`,
    }
  }
  return { kind: 'allow', overridden: false }
}

/** After a compaction the loop no longer holds what it read. */
export const forgetLoop = (mem: GuardMemory, agentId: string | undefined): void => {
  const prefix = `${agentId ?? 'main'}|`
  for (const key of [...mem.seen.keys()]) if (key.startsWith(prefix)) mem.seen.delete(key)
  for (const key of [...mem.held]) if (key.startsWith(prefix)) mem.held.delete(key)
}
