// Ticket keys look like ABC-123 in both Jira and Linear
export const TICKET_KEY = /\b[A-Z][A-Z0-9]+-\d+\b/i

export function ticketKey(text: string): string | undefined {
  return text.match(TICKET_KEY)?.[0].toUpperCase()
}

const TICKET_KEYS = new RegExp(TICKET_KEY.source, 'gi')
// markdown links keep their text; emphasis, code ticks and list or quote markers go
const plainText = (line: string) =>
  line
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]+/g, '')
    .replace(/^\s*(?:[-*+>]|\d+\.)\s+/, '')
    .trim()

// the first sentence of the first prose line; a model summary would read better but costs a call per PR.
// Skips headings ("## Summary"), fences, tables, link references and ticket-only lines ("ABC-1, part of ABC-2.").
// Parsers keep the whole sentence; the pane cuts it to the summaryLength option.
export function summaryOf(body: string, max = Infinity): string {
  const isProse = (raw: string) => {
    if (/^\s*(?:#|```|\||\[[^\]]+\]:)/.test(raw)) return false
    return plainText(raw).replace(TICKET_KEYS, '').split(/\s+/).filter(word => /\w{2,}/.test(word)).length >= 3
  }
  const line = plainText(body.split('\n').find(isProse) ?? '')
  const sentence = line.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? line
  return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence
}

// What a host that does not report CI, review threads, line counts or permissions leaves at its neutral value.
// canRequestReview stays true because the permission is unknown, so the review request is still offered.
export const UNKNOWN = {
  review: 'NONE',
  ci: 'NONE',
  checksPassed: 0,
  checksTotal: 0,
  canRequestReview: true,
  hasCopilot: false,
  unresolved: 0,
  changedFiles: 0,
  additions: 0,
  deletions: 0,
}

// hostname of an http(s) URL; the engine has no URL global
export function hostOf(url: string): string {
  return url.match(/^https?:\/\/(?:[^@/]+@)?([^/:]+)/i)?.[1]?.toLowerCase() ?? ''
}

// owner/repo from a git remote URL, ssh or https. GitLab subgroups keep the whole path
// (group/sub/repo); Azure DevOps gives org/project/repo.
export function repoFromRemote(url: string): string | undefined {
  const clean = url.trim().replace(/\/$/, '').replace(/\.git$/, '')

  const azure = clean.match(/dev\.azure\.com[:/](?:v3\/)?([^/]+)\/([^/]+)\/(?:_git\/)?([^/]+)$/i)
  if (azure) return azure.slice(1).join('/').toLowerCase()

  const path = clean.match(/^(?:[\w+.-]+:\/\/)?(?:[^@/]+@)?[^/:]+(?::\d+(?=\/))?[:/](.+)$/)?.[1]
  if (!path?.includes('/')) return undefined
  return path.toLowerCase()
}
