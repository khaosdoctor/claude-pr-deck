// Ticket keys look like ABC-123 in both Jira and Linear
export const TICKET_KEY = /\b[A-Z][A-Z0-9]+-\d+\b/i

export function ticketKey(text: string): string | undefined {
  return text.match(TICKET_KEY)?.[0].toUpperCase()
}

// ponytail: first body line with 3+ words skips template headings like "Summary"; a model summary would read better but costs a call per PR
// parsers keep the whole line; the pane cuts it to the summaryLength option
export function summaryOf(body: string, max = Infinity): string {
  const line = body.split('\n').map(l => l.trim()).find(l => l.split(/\s+/).length >= 3) ?? ''
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
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
