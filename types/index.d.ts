export type Pr = {
  // code host id (github, gitlab, gitea, azdo) and its hostname, e.g. gitlab.com
  provider: string
  host: string
  number: number
  title: string
  url: string
  repo: string
  fullName: string
  trunk: string
  head: string
  base: string
  isDraft: boolean
  review: string
  mergeable: string
  ci: string
  checksPassed: number
  checksTotal: number
  reviewRequests: number
  hasCopilot: boolean
  unresolved: number
  changedFiles: number
  additions: number
  deletions: number
  ticket?: string
  summary: string
}

// One code host: how to fetch the user's open PRs and what to tell the agent about its CLI.
// command may use {query}; cli is the name used inside prompt text.
export type Provider = {
  id: string
  cli: string
  command: string
  query?: string
  parse: (stdout: string) => Pr[]
  readyHint: string
  supportsCopilot: boolean
}

export type GroupBy = 'status' | 'none'

export type Stack ={ repo: string; base: string; prs: Pr[] }

// project: owner/repo of the session's git remote, absent outside a repo
export type Snapshot = { prs: Pr[]; updatedAt: number; project?: string; error?: string }

declare module 'claude-code' {
  interface PluginState {
    'pr-deck': { snapshot: Snapshot | null; showAll: boolean; groupBy: GroupBy; collapsed: string[]; ignored: string[]; showIgnored: boolean }
  }
}
