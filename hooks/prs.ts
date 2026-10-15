import type { Pr, Stack } from '../types'

export const QUERY = `{viewer{pullRequests(first:50,states:OPEN,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{
  number title url isDraft headRefName baseRefName reviewDecision mergeable changedFiles additions deletions
  repository{name nameWithOwner defaultBranchRef{name}}
  reviewRequests(first:20){totalCount nodes{requestedReviewer{... on Bot{login} ... on User{login}}}}
  reviews(first:50){nodes{author{login}}}
  reviewThreads(first:100){nodes{isResolved}}
  commits(last:1){nodes{commit{statusCheckRollup{state contexts(first:100){nodes{
    __typename ... on CheckRun{status conclusion} ... on StatusContext{state}
  }}}}}}
}}}}`

const PASSED = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED'])
const JIRA_KEY = /\b([A-Z][A-Z0-9]+-\d+)\b/i

type Context = { __typename: string; status?: string; conclusion?: string | null; state?: string }

// ponytail: takes the raw GraphQL nodes as-is, no schema validation; gh is the trust boundary
export function toPr(node: any): Pr {
  const rollup = node.commits.nodes[0]?.commit.statusCheckRollup
  const contexts: Context[] = rollup?.contexts.nodes ?? []
  const passed = contexts.filter(c =>
    c.__typename === 'CheckRun' ? PASSED.has(c.conclusion ?? '') : c.state === 'SUCCESS',
  ).length
  const jira = (node.title.match(JIRA_KEY) ?? node.headRefName.match(JIRA_KEY))?.[1]
  const reviewers: string[] = [
    ...node.reviews.nodes.map((r: any) => r.author?.login ?? ''),
    ...node.reviewRequests.nodes.map((r: any) => r.requestedReviewer?.login ?? ''),
  ]

  return {
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
    // login is copilot-pull-request-reviewer once it reviewed
    hasCopilot: reviewers.some(login => login.toLowerCase().includes('copilot')),
    unresolved: node.reviewThreads.nodes.filter((t: { isResolved: boolean }) => !t.isResolved).length,
    changedFiles: node.changedFiles,
    additions: node.additions,
    deletions: node.deletions,
    jira: jira?.toUpperCase(),
  }
}

// owner/repo from a git remote URL, ssh or https
export function repoFromRemote(url: string): string | undefined {
  return url.trim().match(/[:/]([^/:]+\/[^/]+?)(\.git)?\/?$/)?.[1]?.toLowerCase()
}

// A stack is a chain of PRs where each one's base is the previous one's head.
// Single PRs come out as stacks of one.
export function toStacks(prs: Pr[]): Stack[] {
  const stacks: Stack[] = []
  const repos = [...new Set(prs.map(pr => pr.repo))]

  for (const repo of repos) {
    const mine = prs.filter(pr => pr.repo === repo)
    const heads = new Set(mine.map(pr => pr.head))
    const roots = mine.filter(pr => !heads.has(pr.base))

    for (const root of roots) {
      const chain: Pr[] = []
      const queue = [root]
      // ponytail: depth-first walk, a branching stack shows as one flattened chain
      while (queue.length > 0) {
        const pr = queue.shift() as Pr
        chain.push(pr)
        queue.unshift(...mine.filter(child => child.base === pr.head))
      }
      stacks.push({ repo, base: root.base, prs: chain })
    }
  }

  return stacks
}

export type Action = { label: string; prompt?: string }

export function nextAction(pr: Pr, isBottom: boolean): Action {
  const ref = `PR ${pr.url} (branch ${pr.head})`

  if (pr.isDraft) {
    return { label: 'Mark ready', prompt: `Mark ${ref} as ready for review with gh pr ready.` }
  }
  if (pr.ci === 'FAILURE' || pr.ci === 'ERROR') {
    return { label: 'Fix CI', prompt: `CI is failing on ${ref}. Find the failing checks, fix the cause and push.` }
  }
  if (pr.mergeable === 'CONFLICTING') {
    return { label: 'Rebase', prompt: `${ref} has conflicts with ${pr.base}. Rebase it, resolve the conflicts and force-push with lease.` }
  }
  if (pr.review === 'CHANGES_REQUESTED' || pr.unresolved > 0) {
    return { label: 'Address comments', prompt: `Go through the unresolved review comments on ${ref}, fix what is valid and draft replies for me to approve.` }
  }
  if (pr.review === 'APPROVED' && pr.ci === 'SUCCESS') {
    if (!isBottom) return { label: 'Wait for stack below' }
    return { label: 'Merge', prompt: `${ref} is approved and green. Confirm with me, then merge it.` }
  }
  if (pr.ci === 'PENDING' || pr.ci === 'EXPECTED') return { label: 'Wait for CI' }
  if (pr.reviewRequests === 0) {
    return { label: 'Request a review', prompt: `Request reviews on ${ref} from the right people or team based on CODEOWNERS and recent history.` }
  }

  return { label: 'Wait for review' }
}

// The third button: once the PR is green and only waiting on people, put Copilot on it.
export function workAction(pr: Pr, next: Action): Action {
  const ref = `PR ${pr.url} (branch ${pr.head})`

  if (pr.ci === 'SUCCESS' && pr.unresolved === 0 && !next.prompt && !pr.hasCopilot) {
    return {
      label: '✦ Copilot pass',
      prompt: `Request a review from Copilot on ${ref} with gh pr edit ${pr.url} --add-reviewer @copilot. Wait for its review to arrive (poll gh pr view --json reviews every minute, give up after 15 minutes), then check out ${pr.head}, go through each Copilot comment, fix the valid ones, push, and reply to and resolve each thread. List what you fixed and what you dismissed and why.`,
    }
  }

  return {
    label: '❯ Work on it',
    prompt: `Load context for ${pr.url}: check out branch ${pr.head} in the ${pr.repo} repo, read the PR description, diff, CI status and review comments, then wait for my instructions.`,
  }
}
