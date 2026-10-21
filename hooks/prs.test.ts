import { expect, test } from 'claude-code/testing'

import type { Pr } from '../types'
import { nextAction, summaryOf, toStacks, workAction } from './prs'
import { repoFromRemote, ticketUrl } from './providers'
import { azdo } from './providers/azdo'
import { gitea } from './providers/gitea'
import { github } from './providers/github'
import { gitlab } from './providers/gitlab'

test('summary skips short heading lines and caps at 30 chars', () => {
  expect(summaryOf('Summary\n\nAdds a pane that lists every open PR', 30)).toBe('Adds a pane that lists every…')
  expect(summaryOf('Summary\n\nAdds a pane that lists every open PR')).toBe('Adds a pane that lists every open PR')
  expect(summaryOf('Fix login bug')).toBe('Fix login bug')
  expect(summaryOf('')).toBe('')
  expect(
    summaryOf('[ABC-196](https://x.test/ABC-196), part of [ABC-120](https://x.test/ABC-120).\n\n## Why\nThis moves the apps onto `forRoot()` and the shared logger. Errors log once now.'),
  ).toBe('This moves the apps onto forRoot() and the shared logger.')
  expect(summaryOf('ABC-196, part of ABC-120.\nAdds the drawer to every page')).toBe('Adds the drawer to every page')
})

test('reads owner/repo from ssh and https remotes', () => {
  expect(repoFromRemote('git@github.com:acme/Api.git\n')).toBe('acme/api')
  expect(repoFromRemote('https://github.com/acme/web')).toBe('acme/web')
  expect(repoFromRemote('ssh://git@git.example.com:2222/acme/web.git')).toBe('acme/web')
  expect(repoFromRemote('')).toBeUndefined()
})

test('keeps the full GitLab subgroup path', () => {
  expect(repoFromRemote('git@gitlab.com:Group/Sub/Repo.git')).toBe('group/sub/repo')
  expect(repoFromRemote('https://gitlab.com/group/sub/repo')).toBe('group/sub/repo')
})

test('reads org/project/repo from Azure DevOps remotes', () => {
  expect(repoFromRemote('https://acme@dev.azure.com/Acme/Proj/_git/Api')).toBe('acme/proj/api')
  expect(repoFromRemote('git@ssh.dev.azure.com:v3/Acme/Proj/Api')).toBe('acme/proj/api')
})

test('links ticket keys to the configured tracker', () => {
  const jira = { tracker: 'jira', trackerUrl: 'https://acme.atlassian.net/browse/' }
  expect(ticketUrl(jira, 'ABC-1')).toBe('https://acme.atlassian.net/browse/ABC-1')
  expect(ticketUrl({ tracker: 'jira', trackerUrl: 'https://acme.atlassian.net' }, 'ABC-1')).toBe('https://acme.atlassian.net/browse/ABC-1')
  expect(ticketUrl({ tracker: 'linear', trackerUrl: 'https://linear.app/acme/issue' }, 'ABC-1')).toBe('https://linear.app/acme/issue/ABC-1')
  expect(ticketUrl({ tracker: 'none', trackerUrl: 'https://x.test/' }, 'ABC-1')).toBeUndefined()
  expect(ticketUrl({ tracker: 'jira', trackerUrl: '  ' }, 'ABC-1')).toBeUndefined()
})

test('parses a GitHub GraphQL node', () => {
  const stdout = JSON.stringify({
    data: { viewer: { pullRequests: { nodes: [{
      number: 7, title: 'ABC-12 add thing', bodyText: 'Adds the thing to the list', url: 'https://github.com/Acme/Api/pull/7',
      isDraft: false, headRefName: 'feat/x', baseRefName: 'main', reviewDecision: null, mergeable: 'MERGEABLE',
      changedFiles: 2, additions: 5, deletions: 1,
      repository: { name: 'Api', nameWithOwner: 'Acme/Api', defaultBranchRef: { name: 'main' } },
      reviewRequests: { totalCount: 1, nodes: [{ requestedReviewer: { login: 'copilot-pull-request-reviewer' } }] },
      reviews: { nodes: [] },
      reviewThreads: { nodes: [{ isResolved: false }, { isResolved: true }] },
      commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS', contexts: { nodes: [{ __typename: 'CheckRun', conclusion: 'SUCCESS' }] } } } }] },
    }] } } },
  })
  const [parsed] = github.parse(stdout)

  expect(parsed).toMatchObject({
    provider: 'github', host: 'github.com', fullName: 'acme/api', ci: 'SUCCESS', checksPassed: 1,
    unresolved: 1, hasCopilot: true, ticket: 'ABC-12', review: 'NONE',
  })
})

test('parses a GitLab merge request', () => {
  const stdout = JSON.stringify({
    data: { currentUser: { authoredMergeRequests: { nodes: [{
      iid: '4', title: 'Fix it', description: 'Fixes the broken thing today', webUrl: 'https://gitlab.com/group/sub/repo/-/merge_requests/4',
      draft: true, sourceBranch: 'ENG-9-fix', targetBranch: 'main', conflicts: true, approved: false,
      diffStatsSummary: { additions: 3, deletions: 2, fileCount: '1' },
      headPipeline: { status: 'FAILED' },
      reviewers: { nodes: [{ username: 'bob' }] },
      discussions: { nodes: [{ resolvable: true, resolved: false }, { resolvable: false, resolved: false }] },
      project: { name: 'repo', fullPath: 'Group/Sub/Repo', webUrl: 'https://gitlab.com/group/sub/repo', repository: { rootRef: 'trunk' } },
    }] } } },
  })
  const [parsed] = gitlab.parse(stdout)

  expect(parsed).toMatchObject({
    provider: 'gitlab', host: 'gitlab.com', number: 4, fullName: 'group/sub/repo', trunk: 'trunk', isDraft: true,
    ci: 'FAILURE', mergeable: 'CONFLICTING', unresolved: 1, reviewRequests: 1, changedFiles: 1, additions: 3, ticket: 'ENG-9',
  })
})

test('parses a Gitea pull request', () => {
  const stdout = JSON.stringify([{
    number: 3, title: 'WIP: add thing', body: 'Adds the thing to the list', html_url: 'https://git.example.com/acme/web/pulls/3',
    head: { ref: 'feat/y' }, base: { ref: 'main', repo: { name: 'web', full_name: 'Acme/Web', default_branch: 'main' } },
    mergeable: false, requested_reviewers: [{ login: 'bob' }], changed_files: 4, additions: 10, deletions: 2,
  }])
  const [parsed] = gitea.parse(stdout)

  expect(parsed).toMatchObject({
    provider: 'gitea', host: 'git.example.com', fullName: 'acme/web', head: 'feat/y', isDraft: true,
    mergeable: 'CONFLICTING', ci: 'NONE', reviewRequests: 1, changedFiles: 4,
  })
})

test('parses an Azure DevOps pull request', () => {
  const stdout = JSON.stringify([{
    pullRequestId: 12, title: 'Add thing', description: 'Adds the thing to the list', isDraft: false,
    sourceRefName: 'refs/heads/feat/z', targetRefName: 'refs/heads/main', mergeStatus: 'conflicts',
    reviewers: [{ vote: 10 }, { vote: 0 }],
    repository: { name: 'Api', webUrl: 'https://dev.azure.com/acme/proj/_git/Api' },
  }])
  const [parsed] = azdo.parse(stdout)

  expect(parsed).toMatchObject({
    provider: 'azdo', host: 'dev.azure.com', number: 12, fullName: 'acme/proj/api', head: 'feat/z', base: 'main',
    url: 'https://dev.azure.com/acme/proj/_git/Api/pullrequest/12', review: 'APPROVED', mergeable: 'CONFLICTING', reviewRequests: 1,
  })
})

const pr = (over: Partial<Pr>): Pr => ({
  provider: 'github',
  host: 'github.com',
  number: 1,
  title: 'ABC-1: thing',
  url: 'https://github.com/acme/api/pull/1',
  repo: 'api',
  fullName: 'acme/api',
  trunk: 'main',
  head: 'a',
  base: 'main',
  isDraft: false,
  review: 'REVIEW_REQUIRED',
  mergeable: 'MERGEABLE',
  ci: 'SUCCESS',
  checksPassed: 1,
  checksTotal: 1,
  reviewRequests: 1,
  hasCopilot: false,
  unresolved: 0,
  changedFiles: 1,
  additions: 1,
  deletions: 0,
  summary: '',
  ...over,
})

test('chains PRs whose base is another PR head into one stack', () => {
  const stacks = toStacks([
    pr({ number: 3, head: 'c', base: 'b' }),
    pr({ number: 1, head: 'a', base: 'main' }),
    pr({ number: 2, head: 'b', base: 'a' }),
    pr({ number: 9, head: 'z', base: 'main', repo: 'web' }),
  ])

  expect(stacks.map(s => s.prs.map(p => p.number))).toEqual([[1, 2, 3], [9]])
})

test('next action follows CI, review and stack position', () => {
  expect(nextAction(pr({ ci: 'FAILURE' }), true).label).toBe('Fix CI')
  expect(nextAction(pr({ unresolved: 2 }), true).label).toBe('Address comments')
  expect(nextAction(pr({ reviewRequests: 0 }), true).label).toBe('Request a review')
  expect(nextAction(pr({ review: 'APPROVED' }), true).label).toBe('Merge')
  expect(nextAction(pr({ review: 'APPROVED' }), false).label).toBe('Wait for stack below')
  expect(nextAction(pr({}), true).prompt).toBeUndefined()
})

test('work button offers a Copilot pass only when green, idle and not asked yet', () => {
  const idle = pr({})
  expect(workAction(idle, nextAction(idle, true), true).label).toBe('✦ Copilot pass')

  const asked = pr({ hasCopilot: true })
  expect(workAction(asked, nextAction(asked, true), true).label).toBe('❯ Work on it')

  const commented = pr({ unresolved: 1 })
  expect(workAction(commented, { label: 'Wait for review' }, true).label).toBe('❯ Work on it')

  const running = pr({ ci: 'PENDING' })
  expect(workAction(running, nextAction(running, true), true).label).toBe('❯ Work on it')

  const failing = pr({ ci: 'FAILURE' })
  expect(workAction(failing, nextAction(failing, true), true).label).toBe('❯ Work on it')
})

test('Copilot pass is off when the user disables it or the host has no Copilot', () => {
  const idle = pr({})
  expect(workAction(idle, nextAction(idle, true), false).label).toBe('❯ Work on it')

  const gitlab = pr({ provider: 'gitlab' })
  expect(workAction(gitlab, nextAction(gitlab, true), true).label).toBe('❯ Work on it')
})

test('a custom work template fills the placeholders, blank falls back to the default', () => {
  const custom = pr({ number: 42, head: 'feat/x' })
  expect(workAction(custom, { label: 'Wait for review' }, false, 'Review #{pr} on {branch} {nope}').prompt).toBe('Review #42 on feat/x {nope}')
  expect(workAction(custom, { label: 'Wait for review' }, false, '  ').prompt).toContain('check out branch feat/x')
})

test('prompts use the CLI of the PR host', () => {
  const draft = nextAction(pr({ provider: 'gitlab', isDraft: true }), true)
  expect(draft.prompt).toContain('glab mr update --ready')

  const azure = nextAction(pr({ provider: 'azdo', isDraft: true }), true)
  expect(azure.prompt).toContain('az repos pr update')
})
