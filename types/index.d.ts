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
  // false when the user lacks the permission to request reviews on the repo
  canRequestReview: boolean
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

// what the pane draws: the PR list or the config screen
export type View = 'list' | 'config'

export type Stack ={ repo: string; base: string; prs: Pr[] }

// project: owner/repo of the session's git remote, absent outside a repo
export type Snapshot = { prs: Pr[]; updatedAt: number; project?: string; error?: string }

// What a PR needs next, first match wins; see STATE_INFO in hooks/prs.ts
export type ActionState = 'draft' | 'ci-failed' | 'conflicts' | 'comments' | 'mergeable' | 'stack-below' | 'ci-running' | 'no-reviewers' | 'maintainers' | 'in-review'

// ~/.config/pr-deck.prompts.jsonc: prompt templates per state; a missing state or field keeps the default
export type StatePrompts = Partial<Record<ActionState, { next?: string; work?: string; watch?: string }>>

// the parsed prompts file, or the reason it could not be read
export type PromptsFile = { map: StatePrompts; error?: string }

declare module 'claude-code' {
  interface PluginState {
    'pr-deck': { snapshot: Snapshot | null; showAll: boolean; groupBy: GroupBy; collapsed: string[]; ignored: string[]; overrides: Record<string, string>; showIgnored: boolean; view: View; prompts: PromptsFile }
  }
}
