import type { Pr, Provider } from '../../types'
import { hostOf, repoFromRemote, summaryOf, ticketKey, UNKNOWN } from './shared'

const branchOf = (ref: string) => ref.replace(/^refs\/heads\//, '')

// Reviewer votes: 10 approved, 5 approved with suggestions, 0 none, -5 waiting for author, -10 rejected
// any negative vote asks for changes, otherwise any positive vote approves; branch policies are not read
function reviewOf(votes: number[]): string {
  if (votes.some(vote => vote < 0)) return 'CHANGES_REQUESTED'
  if (votes.some(vote => vote > 0)) return 'APPROVED'
  return 'NONE'
}

const MERGEABLE: Record<string, string> = { succeeded: 'MERGEABLE', conflicts: 'CONFLICTING' }

// raw az objects as-is, az is the trust boundary. Build results and comment threads live
// behind other calls, so the rest stays UNKNOWN
function toPr(node: any): Pr {
  const repository = node.repository
  const head = branchOf(node.sourceRefName)
  const votes: number[] = node.reviewers.map((r: any) => r.vote)

  return {
    provider: 'azdo',
    host: hostOf(repository.webUrl),
    number: node.pullRequestId,
    title: node.title,
    url: `${repository.webUrl}/pullrequest/${node.pullRequestId}`,
    repo: repository.name,
    // webUrl can carry the project id instead of its name; remoteUrl is the clone URL, the same shape as the git remote
    fullName: repoFromRemote(repository.remoteUrl ?? repository.webUrl) ?? repository.name.toLowerCase(),
    trunk: branchOf(repository.defaultBranch ?? 'refs/heads/main'),
    head,
    base: branchOf(node.targetRefName),
    isDraft: node.isDraft === true,
    mergeable: MERGEABLE[node.mergeStatus] ?? 'UNKNOWN',
    reviewRequests: votes.filter(vote => vote === 0).length,
    ...UNKNOWN,
    review: reviewOf(votes),
    ticket: ticketKey(`${node.title} ${head}`),
    summary: summaryOf(node.description ?? ''),
  }
}

// az lists one project's PRs (the one it detects from the git remote or `az devops configure`);
// override azdoCommand to cover more projects. --creator takes the signed-in account's name
export const azdo: Provider = {
  id: 'azdo',
  cli: 'az repos',
  command: 'az repos pr list --status active --top 50 --creator "$(az account show --query user.name -o tsv)" -o json',
  parse: stdout => JSON.parse(stdout).map(toPr),
  readyHint: 'az repos pr update --draft false --id <the PR number>',
  supportsCopilot: false,
}
