import type { Pr, Provider } from '../../types'
import { hostOf, summaryOf, ticketKey } from './shared'

const query = `{viewer{pullRequests(first:50,states:OPEN,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{
  number title bodyText url isDraft headRefName baseRefName reviewDecision mergeable changedFiles additions deletions
  repository{name nameWithOwner viewerPermission defaultBranchRef{name}}
  reviewRequests(first:20){totalCount nodes{requestedReviewer{... on Bot{login} ... on User{login}}}}
  reviews(first:50){nodes{author{login}}}
  reviewThreads(first:100){nodes{isResolved}}
  commits(last:1){nodes{commit{statusCheckRollup{state contexts(first:100){nodes{
    __typename ... on CheckRun{status conclusion} ... on StatusContext{state}
  }}}}}}
}}}}`

const PASSED = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED'])
// READ (or null) cannot request reviews, e.g. a PR from a fork into someone else's repo
const CAN_REQUEST_REVIEW = new Set(['ADMIN', 'MAINTAIN', 'WRITE', 'TRIAGE'])

type Context = { __typename: string; status?: string; conclusion?: string | null; state?: string }

// ponytail: takes the raw GraphQL nodes as-is, no schema validation; gh is the trust boundary
export function toPr(node: any): Pr {
  const rollup = node.commits.nodes[0]?.commit.statusCheckRollup
  const contexts: Context[] = rollup?.contexts.nodes ?? []
  const passed = contexts.filter(c =>
    c.__typename === 'CheckRun' ? PASSED.has(c.conclusion ?? '') : c.state === 'SUCCESS',
  ).length
  const reviewers: string[] = [
    ...node.reviews.nodes.map((r: any) => r.author?.login ?? ''),
    ...node.reviewRequests.nodes.map((r: any) => r.requestedReviewer?.login ?? ''),
  ]

  return {
    provider: 'github',
    host: hostOf(node.url),
    number: node.number,
    title: node.title,
    url: node.url,
    repo: node.repository.name,
    fullName: node.repository.nameWithOwner.toLowerCase(),
    trunk: node.repository.defaultBranchRef?.name ?? 'main',
    head: node.headRefName,
    base: node.baseRefName,
    isDraft: node.isDraft,
    review: node.reviewDecision ?? 'NONE',
    mergeable: node.mergeable,
    ci: rollup?.state ?? 'NONE',
    checksPassed: passed,
    checksTotal: contexts.length,
    reviewRequests: node.reviewRequests.totalCount,
    canRequestReview: CAN_REQUEST_REVIEW.has(node.repository.viewerPermission),
    // login is copilot-pull-request-reviewer once it reviewed
    hasCopilot: reviewers.some(login => login.toLowerCase().includes('copilot')),
    unresolved: node.reviewThreads.nodes.filter((t: { isResolved: boolean }) => !t.isResolved).length,
    changedFiles: node.changedFiles,
    additions: node.additions,
    deletions: node.deletions,
    ticket: ticketKey(`${node.title} ${node.headRefName}`),
    summary: summaryOf(node.bodyText ?? ''),
  }
}

export const github: Provider = {
  id: 'github',
  cli: 'gh',
  command: 'gh api graphql -f query={query}',
  query,
  parse: stdout => JSON.parse(stdout).data.viewer.pullRequests.nodes.map(toPr),
  readyHint: 'gh pr ready',
  supportsCopilot: true,
}
