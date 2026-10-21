import { expect, test } from 'claude-code/testing'

import type { Pr } from '../types'
import { keepFailedHosts, parseConfig } from './snapshot'

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

test('text that is not a JSON object is unreadable, not empty', () => {
  expect(parseConfig('', [])).toBeUndefined()
  expect(parseConfig('{"ignored": [', [])).toBeUndefined()
  expect(parseConfig('null', [])).toBeUndefined()
  expect(parseConfig('[]', [])).toBeUndefined()
})
