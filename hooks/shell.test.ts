import { expect, test } from 'claude-code/testing'

import type { EngineInterface } from 'claude-code'

import { parseJsonc } from './jsonc'
import { repoFromRemote } from './providers'
import { github } from './providers/github'
import { gitlab } from './providers/gitlab'
import { fill, quote, run } from './run'
import { TERMINALS } from './terminals'

test('quote wraps in single quotes and escapes embedded ones', () => {
  expect(quote('plain')).toBe("'plain'")
  expect(quote('')).toBe("''")
  expect(quote("it's")).toBe(`'it'\\''s'`)
  expect(quote('a $HOME `id`\nb')).toBe("'a $HOME `id`\nb'")
})

test('fill quotes each value once and leaves unknown placeholders alone', () => {
  expect(fill('open {url} {other}', { url: "a'b" })).toBe(`open 'a'\\''b' {other}`)
})

test('fill does not expand placeholders found inside a value', () => {
  expect(fill('echo {prompt}', { prompt: '{dir}', dir: 'x' })).toBe("echo '{dir}'")
})

test('fill treats inherited object keys as unknown placeholders', () => {
  expect(fill('echo {constructor} {toString} {__proto__}', {})).toBe('echo {constructor} {toString} {__proto__}')
})

test('run turns a command that cannot finish into a failed result', async () => {
  const stuck = { process: { run: () => Promise.reject(new Error('timed out')) } } as unknown as EngineInterface
  const result = await run(stuck, 'sleep 99')
  expect(result.exitCode).toBe(1)
  expect(result.stderr).toBe('timed out')
})

test('Rio and Ghostty hand the prompt over in an environment variable, since fish has no $0 for -c', () => {
  for (const name of ['Rio', 'Ghostty']) {
    const command = fill(TERMINALS.find(t => t.name === name)?.command ?? '', { dir: '/d', prompt: "it's" })
    expect(command).toContain(`--env PR_DECK_PROMPT=${quote("it's")} `)
    expect(command).toContain('"$PR_DECK_PROMPT"')
    expect(command).not.toContain('$0')
  }
})

test('every terminal puts -- before the prompt, so one that starts with a dash is not read as a claude flag', () => {
  const promptAfterDashes = /\{claude\} -- (?:\{prompt\}|\{shellPrompt\}|"\$PR_DECK_PROMPT"|" & quoted form of item 2)/
  for (const { name, command } of TERMINALS) expect([name, promptAfterDashes.test(command)]).toEqual([name, true])
})

test('shellPrompt comes out quoted twice, so the pane shell sees the quoted prompt', () => {
  const herdr = TERMINALS.find(t => t.name === 'a herdr tab')
  const prompt = "it's"
  const command = fill(herdr?.command ?? '', { dir: '/d', label: 'l', shellPrompt: quote(prompt) })
  expect(command).toContain(quote(quote(prompt)))
})

test('a prompts file with only whitespace or comments is an empty object', () => {
  expect(parseJsonc('')).toEqual({})
  expect(parseJsonc('  \n\t\n')).toEqual({})
  expect(parseJsonc('// nothing here yet\n/* or here */\n')).toEqual({})
  expect(parseJsonc('﻿')).toEqual({})
  expect(() => parseJsonc('{')).toThrow()
})

test('Azure DevOps remotes in every form give org/project/repo', () => {
  expect(repoFromRemote('https://dev.azure.com/Acme/_git/Api')).toBe('acme/api/api')
  expect(repoFromRemote('https://acme@dev.azure.com/Acme/_git/Api')).toBe('acme/api/api')
  expect(repoFromRemote('https://acme.visualstudio.com/Proj/_git/Api')).toBe('acme/proj/api')
  expect(repoFromRemote('https://acme.visualstudio.com/DefaultCollection/Proj/_git/Api')).toBe('acme/proj/api')
  expect(repoFromRemote('https://acme.visualstudio.com/_git/Api')).toBe('acme/api/api')
  expect(repoFromRemote('acme@vs-ssh.visualstudio.com:v3/Acme/Proj/Api')).toBe('acme/proj/api')
  expect(repoFromRemote('https://dev.azure.com/Acme/My%20Proj/_git/Api.git')).toBe('acme/my%20proj/api')
})

const githubStdout = (node: object) =>
  JSON.stringify({
    data: { viewer: { pullRequests: { nodes: [{
      number: 1, title: 't', bodyText: '', url: 'https://github.com/a/b/pull/1', isDraft: false, headRefName: 'h', baseRefName: 'main',
      reviewDecision: null, mergeable: 'MERGEABLE', changedFiles: 1, additions: 1, deletions: 0,
      repository: { name: 'b', nameWithOwner: 'a/b', viewerPermission: 'WRITE', defaultBranchRef: { name: 'main' } },
      reviewRequests: { totalCount: 0, nodes: [] }, reviews: { nodes: [] }, reviewThreads: { nodes: [] }, commits: { nodes: [] },
      ...node,
    }] } } },
  })

test('GitLab reports approved for a project that requires no approvals, so that alone is not a review', () => {
  const review = (node: object) => {
    const stdout = JSON.stringify({
      data: { currentUser: { authoredMergeRequests: { nodes: [{
        iid: '1', title: 't', description: '', webUrl: 'https://gitlab.com/g/r/-/merge_requests/1', draft: false, sourceBranch: 'h', targetBranch: 'main',
        conflicts: false, approved: true, approvedBy: { nodes: [] }, diffStatsSummary: null, headPipeline: null,
        reviewers: { nodes: [] }, discussions: { nodes: [] }, project: { name: 'r', fullPath: 'g/r', repository: { rootRef: 'main' } },
        ...node,
      }] } } },
    })
    return gitlab.parse(stdout)[0]?.review
  }

  expect(review({})).toBe('NONE')
  expect(review({ approvedBy: { nodes: [{ username: 'ana' }] } })).toBe('APPROVED')
  expect(review({ approved: false, approvedBy: { nodes: [{ username: 'ana' }] } })).toBe('NONE')
})

test('GitHub falls back to the latest reviews when the repo does not require reviews', () => {
  const latest = (...states: string[]) => ({ latestOpinionatedReviews: { nodes: states.map(state => ({ state })) } })
  const review = (node: object) => github.parse(githubStdout(node))[0]?.review

  expect(review(latest('APPROVED'))).toBe('APPROVED')
  expect(review(latest('APPROVED', 'CHANGES_REQUESTED'))).toBe('CHANGES_REQUESTED')
  expect(review(latest('DISMISSED'))).toBe('NONE')
  expect(review({})).toBe('NONE')
  // a decision from the host wins over the individual reviews
  expect(review({ reviewDecision: 'REVIEW_REQUIRED', ...latest('APPROVED') })).toBe('REVIEW_REQUIRED')
})
