import type { Pr, Stack } from '../types'
import { providerOf } from './providers'

export { summaryOf } from './providers/shared'

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
  const provider = providerOf(pr.provider)

  if (pr.isDraft) {
    return { label: 'Mark ready', prompt: `Mark ${ref} as ready for review with ${provider.readyHint}.` }
  }
  if (pr.ci === 'FAILURE' || pr.ci === 'ERROR') {
    return { label: 'Fix CI', prompt: `CI is failing on ${ref}. Find the failing checks (${provider.cli} can list them), fix the cause and push.` }
  }
  if (pr.mergeable === 'CONFLICTING') {
    return { label: 'Rebase', prompt: `${ref} has conflicts with ${pr.base}. Rebase it, resolve the conflicts and force-push with lease.` }
  }
  if (pr.review === 'CHANGES_REQUESTED' || pr.unresolved > 0) {
    return { label: 'Address comments', prompt: `Go through the unresolved review comments on ${ref} (read them with ${provider.cli}), fix what is valid and draft replies for me to approve.` }
  }
  if (pr.review === 'APPROVED' && pr.ci === 'SUCCESS') {
    if (!isBottom) return { label: 'Wait for stack below' }
    return { label: 'Merge', prompt: `${ref} is approved and green. Confirm with me, then merge it with ${provider.cli}.` }
  }
  if (pr.ci === 'PENDING' || pr.ci === 'EXPECTED') return { label: 'Wait for CI' }
  if (pr.reviewRequests === 0) {
    return { label: 'Request a review', prompt: `Request reviews on ${ref} with ${provider.cli} from the right people or team based on CODEOWNERS and recent history.` }
  }

  return { label: 'Wait for review' }
}

// The third button: once the PR is green and only waiting on people, put Copilot on it
// (only when the user allows it and the code host has Copilot).
export function workAction(pr: Pr, next: Action, allowCopilot: boolean): Action {
  const ref = `PR ${pr.url} (branch ${pr.head})`
  const provider = providerOf(pr.provider)

  if (allowCopilot && provider.supportsCopilot && pr.ci === 'SUCCESS' && pr.unresolved === 0 && !next.prompt && !pr.hasCopilot) {
    return {
      label: '✦ Copilot pass',
      prompt: `Request a review from Copilot on ${ref} with ${provider.cli} pr edit ${pr.url} --add-reviewer @copilot. Wait for its review to arrive (poll ${provider.cli} pr view --json reviews every minute, give up after 15 minutes), then check out ${pr.head}, go through each Copilot comment, fix the valid ones, push, and reply to and resolve each thread. List what you fixed and what you dismissed and why.`,
    }
  }

  return {
    label: '❯ Work on it',
    prompt: `Load context for ${pr.url}: check out branch ${pr.head} in the ${pr.repo} repo, read the PR description, diff, CI status and review comments (${provider.cli} reads them), then wait for my instructions.`,
  }
}
