// Ticket keys look like ABC-123 in both Jira and Linear. A number followed by .5 or -5 is a version or
// an id (lodash-4.17.21, CVE-2024-1234), not a key; ENG-1-2fa-login still is one.
// An underscore ends a key like any other separator (ENG-123_fix), which \b does not do; the key is group 1.
export const TICKET_KEY = /(?:^|[^A-Za-z0-9])([A-Z][A-Z0-9]+-\d+)(?![A-Za-z0-9])(?!\.\d|-\d+\b)/i

export function ticketKey(text: string): string | undefined {
  return text.match(TICKET_KEY)?.[1]?.toUpperCase()
}

const TICKET_KEYS = new RegExp(TICKET_KEY.source, 'gi')
// markdown links keep their text; emphasis, code ticks and list or quote markers go
const plainText = (line: string) =>
  line
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // underscores only as emphasis, so snake_case names stay whole
    .replace(/[*`]+|\b_+|_+\b/g, '')
    .replace(/^\s*(?:[-*+>]|\d+\.)\s+/, '')
    .trim()

// the first sentence of the first prose line; a model summary would read better but costs a call per PR.
// Skips headings ("## Summary"), fences, tables, link references and ticket-only lines ("ABC-1, part of ABC-2.").
// Parsers keep the whole sentence; the pane cuts it to the summaryLength option.
export function summaryOf(body: string, max = Infinity): string {
  const isProse = (raw: string) => {
    // "#42 follow-up" is prose, "## Summary" a heading; "- [ ] task" is a template checklist
    if (/^\s*(?:#{1,6}(?:\s|$)|```|\||\[[^\]]+\]:|[-*+]\s+\[[ xX]\](?:\s|$)|(?:<\/?[a-z][^>]*>\s*)+$)/i.test(raw)) return false
    return plainText(raw).replace(TICKET_KEYS, '').split(/\s+/).filter(word => /\w{2,}/.test(word)).length >= 3
  }
  // PR templates keep their instructions in HTML comments, often over several lines
  const lines = body.replace(/<!--[\s\S]*?(?:-->|$)/g, '').split('\n')
  const line = plainText(lines.find(isProse) ?? '')
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

// Azure DevOps remotes: https://dev.azure.com/org/project/_git/repo, git@ssh.dev.azure.com:v3/org/project/repo and the
// legacy https://org.visualstudio.com/[DefaultCollection/]project/_git/repo and org@vs-ssh.visualstudio.com:v3/org/project/repo.
// A repo named like its project has a short https form without the project (.../org/_git/repo).
const AZURE_REMOTE = /^(?:[\w+.-]+:\/\/)?(?:[^@/]+@)?((?:ssh\.)?dev\.azure\.com|vs-ssh\.visualstudio\.com|([^/:@.]+)\.visualstudio\.com)[:/](.+)$/i

// org/project/repo, or undefined when the URL is not an Azure DevOps one
function azureRepo(clean: string): string | undefined {
  const match = clean.match(AZURE_REMOTE)
  if (!match) return undefined
  const [, host = '', legacyOrg, path = ''] = match
  const segments = path.split('/')

  if (/^(?:vs-)?ssh\./i.test(host)) return segments.length === 4 && segments[0] === 'v3' ? segments.slice(1).join('/').toLowerCase() : undefined

  const git = segments.indexOf('_git')
  const repo = segments[git + 1]
  if (git < 0 || !repo) return undefined
  const before = segments.slice(0, git).filter(segment => segment.toLowerCase() !== 'defaultcollection')
  const [org, project] = legacyOrg ? [legacyOrg, before[0]] : before
  if (!org) return undefined
  return [org, project ?? repo, repo].join('/').toLowerCase()
}

// owner/repo from a git remote URL, ssh or https. GitLab subgroups keep the whole path
// (group/sub/repo); Azure DevOps gives org/project/repo.
export function repoFromRemote(url: string): string | undefined {
  const clean = url.trim().replace(/\/$/, '').replace(/\.git$/, '')

  const azure = azureRepo(clean)
  if (azure) return azure

  const path = clean.match(/^(?:[\w+.-]+:\/\/)?(?:[^@/]+@)?[^/:]+(?::\d+(?=\/))?[:/](.+)$/)?.[1]
  if (!path?.includes('/')) return undefined
  return path.toLowerCase()
}
