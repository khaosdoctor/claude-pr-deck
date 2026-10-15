import { expect, test } from 'claude-code/testing'

import type { Pr } from '../types'
import { nextAction, repoFromRemote, toStacks, workAction } from './prs'

test('reads owner/repo from ssh and https remotes', () => {
  expect(repoFromRemote('git@github.com:acme/Api.git\n')).toBe('acme/api')
  expect(repoFromRemote('https://github.com/acme/web')).toBe('acme/web')
  expect(repoFromRemote('')).toBeUndefined()
})

const pr = (over: Partial<Pr>): Pr => ({
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
  expect(workAction(idle, nextAction(idle, true)).label).toBe('✦ Copilot pass')

  const asked = pr({ hasCopilot: true })
  expect(workAction(asked, nextAction(asked, true)).label).toBe('❯ Work on it')

  const commented = pr({ unresolved: 1 })
  expect(workAction(commented, { label: 'Wait for review' }).label).toBe('❯ Work on it')

  const running = pr({ ci: 'PENDING' })
  expect(workAction(running, nextAction(running, true)).label).toBe('❯ Work on it')

  const failing = pr({ ci: 'FAILURE' })
  expect(workAction(failing, nextAction(failing, true)).label).toBe('❯ Work on it')
})
