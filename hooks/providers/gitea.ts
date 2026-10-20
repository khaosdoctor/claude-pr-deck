import type { Pr, Provider } from '../../types'
import { hostOf, summaryOf, ticketKey } from './shared'

// Forgejo and Gitea mark drafts with a title prefix, and newer versions also set `draft`
const DRAFT_PREFIX = /^(\[(wip|draft)\]|(wip|draft):)/i

// ponytail: raw API objects as-is, tea is the trust boundary. Review threads and CI are separate
// endpoints per PR, so they stay unknown: ci NONE, unresolved 0
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
    review: 'NONE',
    mergeable: node.mergeable === false ? 'CONFLICTING' : 'MERGEABLE',
    ci: 'NONE',
    checksPassed: 0,
    checksTotal: 0,
    reviewRequests: (node.requested_reviewers ?? []).length,
    hasCopilot: false,
    unresolved: 0,
    changedFiles: node.changed_files ?? 0,
    additions: node.additions ?? 0,
    deletions: node.deletions ?? 0,
    ticket: ticketKey(`${node.title} ${node.head.ref}`),
    summary: summaryOf(node.body ?? ''),
  }
}

// ponytail: the issue search lists my PRs across repos but without branches, so each one is fetched
// from its pull endpoint and jq slurps the objects into one array; needs jq next to tea
export const gitea: Provider = {
  id: 'gitea',
  cli: 'tea',
  command:
    "set -o pipefail; tea api '/repos/issues/search?type=pulls&state=open&created=true&limit=50' | jq -r '.[] | \"\\(.repository.full_name) \\(.number)\"' | while read -r repo number; do tea api \"/repos/$repo/pulls/$number\"; done | jq -s .",
  parse: stdout => JSON.parse(stdout).map(toPr),
  readyHint: 'tea api -X PATCH on the pull request, sending its title without the WIP: or Draft: prefix',
  supportsCopilot: false,
}
