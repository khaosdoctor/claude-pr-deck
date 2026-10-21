import { expect, test } from 'claude-code/testing'

import type { Pr } from '../types'
import { guarded, keepFailedHosts, parseConfig, repoKeyOf, safeSessionName, short, splitFullName } from './snapshot'

const pr = (provider: string, number: number) => ({ provider, number, url: `https://${provider}.test/${number}` }) as Pr

test('a failed host keeps its last PRs while the others refresh', () => {
  const old = [pr('github', 1), pr('gitlab', 2)]
  const merged = keepFailedHosts([pr('github', 3)], old, ['gitlab: connection refused'])
  expect(merged.map(p => p.number)).toEqual([3, 2])
})

test('no errors means only the fresh PRs', () => {
  expect(keepFailedHosts([pr('github', 3)], [pr('github', 1)], [])).toEqual([pr('github', 3)])
})

test('a host that is no longer configured is not kept', () => {
  expect(keepFailedHosts([], [pr('github', 1)], ['gitlab: down'])).toEqual([])
})

test('reads ignored and overrides, lowercasing repos and dropping unknown statuses', () => {
  const config = parseConfig('{"ignored":["Acme/Api",3],"overrides":{"u1":"● needs you","u2":"bogus"}}', ['● needs you'])
  expect(config).toEqual({ ignored: ['acme/api'], overrides: { u1: '● needs you' } })
})

test('a missing field reads as empty', () => {
  expect(parseConfig('{}', [])).toEqual({ ignored: [], overrides: {} })
})

test('a repo listed twice in the ignored list is kept once', () => {
  expect(parseConfig('{"ignored":["Acme/Api","acme/api"]}', [])?.ignored).toEqual(['acme/api'])
})

test('splits owner and repo at the last slash', () => {
  expect(splitFullName('acme/api')).toEqual({ owner: 'acme', repo: 'api' })
  expect(splitFullName('group/sub/api')).toEqual({ owner: 'group/sub', repo: 'api' })
})

test('a name without a slash is all repo, with no owner', () => {
  expect(splitFullName('api')).toEqual({ owner: '', repo: 'api' })
})

const repoPr = (host: string, fullName: string) => ({ host, fullName, repo: fullName.split('/').at(-1) }) as Pr

test('repos with different short names keep them as section names', () => {
  const prs = [repoPr('github.com', 'acme/api'), repoPr('github.com', 'acme/web')]
  const key = repoKeyOf(prs)
  expect(prs.map(key)).toEqual(['api', 'web'])
})

test('two repos sharing a short name get separate section names', () => {
  const prs = [repoPr('github.com', 'acme/api'), repoPr('github.com', 'other/api'), repoPr('github.com', 'acme/web')]
  expect(prs.map(repoKeyOf(prs))).toEqual(['github.com/acme/api', 'github.com/other/api', 'web'])
})

test('several PRs of one repo share its section name', () => {
  const prs = [repoPr('github.com', 'acme/api'), repoPr('github.com', 'acme/api')]
  expect(prs.map(repoKeyOf(prs))).toEqual(['api', 'api'])
})

test('a session name never starts with a dash or holds unsafe characters', () => {
  expect(safeSessionName('pr-12-worker')).toBe('pr-12-worker')
  expect(safeSessionName('--help me')).toBe('help-me')
  expect(safeSessionName('-WIP: x; rm')).toBe('WIP-x-rm')
  expect(safeSessionName('!!!')).toBe('')
})

test('short cuts with an ellipsis and survives a max of zero or less', () => {
  expect(short('hello', 10)).toBe('hello')
  expect(short('hello world', 6)).toBe('hello…')
  expect(short('hello', 0)).toBe('…')
  expect(short('hello', -3)).toBe('…')
  expect(short('', 0)).toBe('')
})

test('a handler that rejects ends in a toast', async () => {
  const toasts: string[] = []
  const $ = { ui: { toast: (text: string) => void toasts.push(text) } } as unknown as Parameters<typeof guarded>[0]
  await guarded($, () => Promise.reject(new Error('disk full')))
  await guarded($, () => {
    throw 'plain'
  })
  await guarded($, () => Promise.resolve())
  expect(toasts).toEqual(['pr-deck: disk full', 'pr-deck: plain'])
})

test('text that is not a JSON object is unreadable, not empty', () => {
  expect(parseConfig('', [])).toBeUndefined()
  expect(parseConfig('{"ignored": [', [])).toBeUndefined()
  expect(parseConfig('null', [])).toBeUndefined()
  expect(parseConfig('[]', [])).toBeUndefined()
})
