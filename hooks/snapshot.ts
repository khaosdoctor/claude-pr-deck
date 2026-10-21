import type { Pr } from '../types'

// A host that failed this round keeps its last PRs on screen; dropping them would also prune their manual statuses on the next save.
// Errors start with the provider id, see fetchAll.
export function keepFailedHosts(fresh: Pr[], old: Pr[], errors: string[]): Pr[] {
  const kept = old.filter(pr => errors.some(error => error.startsWith(`${pr.provider}:`)))
  return [...fresh, ...kept]
}

export type StoredConfig = { ignored: string[]; overrides: Record<string, string> }

// undefined when the text is not a JSON object, so a half-edited file never reads as an empty config.
export function parseConfig(text: string, statuses: string[]): StoredConfig | undefined {
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    const { ignored, overrides } = parsed as { ignored?: unknown; overrides?: unknown }
    const list = Array.isArray(ignored) ? ignored.filter((x): x is string => typeof x === 'string') : []
    const stored = typeof overrides === 'object' && overrides !== null ? Object.entries(overrides) : []
    return {
      ignored: list.map(x => x.toLowerCase()),
      overrides: Object.fromEntries(stored.filter(([, status]) => statuses.includes(status))),
    }
  } catch {
    return undefined
  }
}
