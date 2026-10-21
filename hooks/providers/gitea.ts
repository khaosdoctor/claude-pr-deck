import type { Pr, Provider } from '../../types'
import { hostOf, summaryOf, ticketKey, UNKNOWN } from './shared'

// Forgejo and Gitea mark drafts with a title prefix, and newer versions also set `draft`
const DRAFT_PREFIX = /^(\[(wip|draft)\]|(wip|draft):)/i

// raw API objects as-is, tea is the trust boundary. Review threads and CI are separate
// endpoints per PR, so they stay UNKNOWN
function toPr(node: any): Pr {
  const base = node.base.repo

  return {
    provider: 'gitea',
    host: hostOf(node.html_url),
    number: node.number,
    title: node.title,
    url: node.html_url,
    repo: base.name,
    fullName: base.full_name.toLowerCase(),
    trunk: base.default_branch ?? 'main',
    head: node.head.ref,
    base: node.base.ref,
    isDraft: node.draft === true || DRAFT_PREFIX.test(node.title),
    mergeable: node.mergeable === false ? 'CONFLICTING' : 'MERGEABLE',
    reviewRequests: (node.requested_reviewers ?? []).length,
    ...UNKNOWN,
    changedFiles: node.changed_files ?? 0,
    additions: node.additions ?? 0,
    deletions: node.deletions ?? 0,
    ticket: ticketKey(`${node.title} ${node.head.ref}`),
    summary: summaryOf(node.body ?? ''),
  }
}

// the issue search lists my PRs across repos but without branches, so each one is fetched
// from its pull endpoint and jq slurps the objects into one array; needs jq next to tea.
// Each step is its own assignment so a failing tea or jq stops the script under any POSIX sh
// (no pipefail), and printf keeps dash's echo from expanding the \n inside the JSON.
export const gitea: Provider = {
  id: 'gitea',
  cli: 'tea',
  command: [
    String.raw`list=$(tea api '/repos/issues/search?type=pulls&state=open&created=true&limit=50') || exit 1`,
    String.raw`paths=$(printf '%s\n' "$list" | jq -r '.[] | "\(.repository.full_name)/pulls/\(.number)"') || exit 1`,
    String.raw`out=$(for path in $paths; do tea api "/repos/$path" || exit 1; done) || exit 1`,
    String.raw`printf '%s\n' "$out" | jq -s .`,
  ].join('\n'),
  parse: stdout => JSON.parse(stdout).map(toPr),
  readyHint: 'tea api -X PATCH on the pull request, sending its title without the WIP: or Draft: prefix',
  supportsCopilot: false,
}
