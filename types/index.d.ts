export type Pr = {
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
  jira?: string
}

export type GroupBy = 'status' | 'none'

export type Stack ={ repo: string; base: string; prs: Pr[] }

// project: owner/repo of the session's git remote, absent outside a repo
export type Snapshot = { prs: Pr[]; updatedAt: number; project?: string; error?: string }

declare module 'claude-code' {
  interface PluginState {
    'pr-deck': { snapshot: Snapshot | null; showAll: boolean; groupBy: GroupBy; collapsed: string[]; ignored: string[]; jiraBaseUrl: string; showIgnored: boolean }
  }
}
