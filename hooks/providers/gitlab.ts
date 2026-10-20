import type { Pr, Provider } from '../../types'
import { hostOf, summaryOf, ticketKey } from './shared'

const query = `{currentUser{authoredMergeRequests(state:opened,first:50,sort:UPDATED_DESC){nodes{
  iid title description webUrl draft sourceBranch targetBranch conflicts approved
  diffStatsSummary{additions deletions fileCount}
  headPipeline{status}
  reviewers(first:20){nodes{username}}
  discussions(first:100){nodes{resolvable resolved}}
  project{name fullPath webUrl repository{rootRef}}
}}}}`

// GitLab pipeline status -> the GitHub rollup states the rest of the mod reads
const CI: Record<string, string> = {
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILURE',
  CREATED: 'PENDING',
  WAITING_FOR_RESOURCE: 'PENDING',
  PREPARING: 'PENDING',
  PENDING: 'PENDING',
  RUNNING: 'PENDING',
  SCHEDULED: 'PENDING',
}

// ponytail: raw GraphQL nodes as-is, glab is the trust boundary; the head pipeline counts as one check
function toPr(node: any): Pr {
  const ci = CI[node.headPipeline?.status ?? ''] ?? 'NONE'
  const fullName: string = node.project.fullPath.toLowerCase()
  const stats = node.diffStatsSummary

  return {
    provider: 'gitlab',
    host: hostOf(node.webUrl),
    number: Number(node.iid),
    title: node.title,
    url: node.webUrl,
    repo: node.project.name,
    fullName,
    trunk: node.project.repository?.rootRef ?? 'main',
    head: node.sourceBranch,
    base: node.targetBranch,
    isDraft: node.draft,
    review: node.approved ? 'APPROVED' : 'NONE',
    mergeable: node.conflicts ? 'CONFLICTING' : 'MERGEABLE',
    ci,
    checksPassed: ci === 'SUCCESS' ? 1 : 0,
    checksTotal: node.headPipeline ? 1 : 0,
    reviewRequests: node.reviewers.nodes.length,
    hasCopilot: false,
    unresolved: node.discussions.nodes.filter((d: any) => d.resolvable && !d.resolved).length,
    changedFiles: Number(stats?.fileCount ?? 0),
    additions: stats?.additions ?? 0,
    deletions: stats?.deletions ?? 0,
    ticket: ticketKey(`${node.title} ${node.sourceBranch}`),
    summary: summaryOf(node.description ?? ''),
  }
}

export const gitlab: Provider = {
  id: 'gitlab',
  cli: 'glab',
  command: 'glab api graphql -f query={query}',
  query,
  parse: stdout => JSON.parse(stdout).data.currentUser.authoredMergeRequests.nodes.map(toPr),
  readyHint: 'glab mr update --ready',
  supportsCopilot: false,
}
