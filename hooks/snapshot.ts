import type { EngineInterface } from 'claude-code'

import type { Pr } from '../types'

// Runs a handler that nobody awaits (a button press, a timer); a rejection ends in a toast instead of vanishing.
export async function guarded($: Pick<EngineInterface, 'ui'>, task: () => unknown): Promise<void> {
  try {
    await task()
  } catch (error) {
    $.ui.toast(`pr-deck: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// Cuts text to max characters with an ellipsis; a max below 1 still gives the ellipsis, not a slice from the end.
export function short(text: string, max: number): string {
  const room = Math.max(1, max)
  return text.length > room ? `${text.slice(0, room - 1)}…` : text
}

// A host that failed this round keeps its last PRs on screen; dropping them would also prune their manual statuses on the next save.
// Errors start with the provider id, see fetchAll.
export function keepFailedHosts(fresh: Pr[], old: Pr[], errors: string[]): Pr[] {
  const kept = old.filter(pr => errors.some(error => error.startsWith(`${pr.provider}:`)))
  return [...fresh, ...kept]
}

// owner is everything before the last "/"; a name without one (Azure DevOps falls back to the bare repo name) has no owner
export function splitFullName(fullName: string): { owner: string; repo: string } {
  const cut = fullName.lastIndexOf('/')
  return { owner: cut < 0 ? '' : fullName.slice(0, cut), repo: fullName.slice(cut + 1) }
}

// What a repo section is called: the short name, or host/owner/repo for two repos that share one (acme/api and other/api), so their PRs never mix.
export function repoKeyOf(prs: Pr[]): (pr: Pr) => string {
  const full = new Map<string, Set<string>>()
  for (const pr of prs) full.set(pr.repo, (full.get(pr.repo) ?? new Set<string>()).add(`${pr.host}/${pr.fullName}`))
  return pr => ((full.get(pr.repo)?.size ?? 0) > 1 ? `${pr.host}/${pr.fullName}` : pr.repo)
}

// A session name goes unquoted into `claude -n <name>`, so anything outside [A-Za-z0-9._-] becomes '-' and a leading '-' is dropped, or claude reads it as a flag.
export const safeSessionName = (name: string) => name.replace(/[^\w.-]+/g, '-').replace(/^-+/, '')

// The PR `/prs watch <ref>` names: its URL, owner/repo#number, or a bare number, which prefers the session's repo when several repos have one.
// A string is the reason nothing matched.
export function findPr(prs: Pr[], ref: string, project?: string): Pr | string {
  const text = ref.trim().replace(/^#/, '')
  if (!text) return 'Which PR? Pass its number, owner/repo#number or URL.'
  // a URL copied from a tab, like .../pull/7/files or .../pull/7#discussion, is still that PR
  const byUrl = prs.find(pr => text === pr.url || text.startsWith(`${pr.url}/`) || text.startsWith(`${pr.url}#`))
  if (byUrl) return byUrl
  const match = /^(?:(.+)#)?(\d+)$/.exec(text)
  if (!match) return `${text} is not a PR number, owner/repo#number or URL.`
  const [, repo, number] = match
  const found = prs.filter(pr => pr.number === Number(number) && (!repo || pr.fullName === repo.toLowerCase()))
  const here = found.filter(pr => pr.fullName === project)
  const [only] = found.length === 1 ? found : here.length === 1 ? here : []
  if (only) return only
  if (found.length === 0) return `None of your open PRs is ${text}.`
  return `#${number} is open in ${found.map(pr => pr.fullName).join(', ')}, pass owner/repo#${number}.`
}

export type StoredConfig ={ ignored: string[]; overrides: Record<string, string> }

// undefined when the text is not a JSON object, so a half-edited file never reads as an empty config.
export function parseConfig(text: string, statuses: string[]): StoredConfig | undefined {
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    const { ignored, overrides } = parsed as { ignored?: unknown; overrides?: unknown }
    const list = Array.isArray(ignored) ? ignored.filter((x): x is string => typeof x === 'string') : []
    const stored = typeof overrides === 'object' && overrides !== null ? Object.entries(overrides) : []
    return {
      // a repo listed twice (or in two cases) would draw two rows with the same key
      ignored: [...new Set(list.map(x => x.toLowerCase()))],
      overrides: Object.fromEntries(stored.filter(([, status]) => statuses.includes(status))),
    }
  } catch {
    return undefined
  }
}
