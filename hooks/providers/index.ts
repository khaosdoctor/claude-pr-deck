import type { EngineInterface, PluginOptions } from 'claude-code'

import type { Pr, Provider } from '../../types'
import { run } from '../run'
import { azdo } from './azdo'
import { gitea } from './gitea'
import { github } from './github'
import { gitlab } from './gitlab'
import { TICKET_KEY } from './shared'

export { repoFromRemote, ticketKey } from './shared'

const providers: Provider[] = [github, gitlab, gitea, azdo]

export function providerOf(id: string): Provider {
  return providers.find(provider => provider.id === id) ?? github
}

// An option as trimmed text; blank and missing both come back as ''
const text = (options: PluginOptions, key: string) => String(options[key] ?? '').trim()

async function fetchOne($: EngineInterface, provider: Provider, custom: string): Promise<{ prs: Pr[]; error?: string }> {
  try {
    const result = await run($, custom || provider.command, { query: provider.query ?? '' })
    if (result.exitCode !== 0) return { prs: [], error: `${provider.id}: ${result.stderr.trim()}` }
    return { prs: provider.parse(result.stdout) }
  } catch (error) {
    return { prs: [], error: `${provider.id}: ${error instanceof Error ? error.message : String(error)}` }
  }
}

export async function fetchAll($: EngineInterface, options: PluginOptions): Promise<{ prs: Pr[]; errors: string[] }> {
  const ids = (text(options, 'providers') || 'github').split(',').map(id => id.trim().toLowerCase()).filter(Boolean)
  const errors: string[] = []
  const jobs: Promise<{ prs: Pr[]; error?: string }>[] = []

  for (const id of new Set(ids)) {
    const provider = providers.find(p => p.id === id)
    if (!provider) {
      errors.push(`${id}: unknown code host`)
      continue
    }
    jobs.push(fetchOne($, provider, text(options, `${id}Command`)))
  }

  const prs: Pr[] = []
  for (const result of await Promise.all(jobs)) {
    prs.push(...result.prs)
    if (result.error) errors.push(result.error)
  }

  return { prs, errors }
}

type Tracker = { id: string; keyPattern: RegExp; url: (base: string, key: string) => string }

const withSlash = (base: string) => (base.endsWith('/') ? base : `${base}/`)

const trackers: Tracker[] = [
  {
    id: 'jira',
    keyPattern: TICKET_KEY,
    // a bare site URL gets /browse/, a full prefix is used as given
    url: (base, key) => `${withSlash(base)}${base.includes('/browse') ? '' : 'browse/'}${key}`,
  },
  { id: 'linear', keyPattern: TICKET_KEY, url: (base, key) => `${withSlash(base)}${key}` },
]

export function ticketUrl(options: PluginOptions, key: string): string | undefined {
  const base = text(options, 'trackerUrl')
  if (!base) return undefined

  const tracker = trackers.find(t => t.id === (text(options, 'tracker').toLowerCase() || 'jira'))
  if (!tracker?.keyPattern.test(key)) return undefined

  return tracker.url(base, key)
}
