import type { ActionState, Pr, Stack, StatePrompts } from '../types'
import { providerOf } from './providers'

export { summaryOf } from './providers/shared'

// A stack is a chain of PRs where each one's base is the previous one's head.
// Single PRs come out as stacks of one.
export function toStacks(prs: Pr[]): Stack[] {
  const stacks: Stack[] = []
  const repos = [...new Set(prs.map(pr => pr.repo))]

  for (const repo of repos) {
    const mine = prs.filter(pr => pr.repo === repo)
    const heads = new Set(mine.map(pr => pr.head))
    const roots = mine.filter(pr => !heads.has(pr.base))

    for (const root of roots) {
      const chain: Pr[] = []
      const queue = [root]
      // ponytail: depth-first walk, a branching stack shows as one flattened chain
      while (queue.length > 0) {
        const pr = queue.shift() as Pr
        chain.push(pr)
        queue.unshift(...mine.filter(child => child.base === pr.head))
      }
      stacks.push({ repo, base: root.base, prs: chain })
    }
  }

  return stacks
}

export type { ActionState, StatePrompts } from '../types'

export type Action = { state: ActionState; label: string; prompt?: string }

// Placeholders are plain text, not shell-quoted like the command ones; unknown ones stay as written.
export const plain = (template: string, vars: Record<string, string>) => template.replace(/\{(\w+)\}/g, (match, name: string) => vars[name] ?? match)

// What the prompt and session name templates can use; {number} is an alias of {pr}.
export const prVars = (pr: Pr): Record<string, string> => ({
  pr: String(pr.number),
  number: String(pr.number),
  url: pr.url,
  title: pr.title,
  branch: pr.head,
  base: pr.base,
  repo: pr.repo,
  fullName: pr.fullName,
  host: pr.host,
  cli: providerOf(pr.provider).cli,
})

// Same text as the fablePrompt and workPrompt defaults in plugin.json, used when an option is blank.
export const DEFAULT_FABLE_PROMPT = "Spawn a subagent with model fable to review {url} against the repo's own standards. Report findings to me, do not post anything to {host}."
export const DEFAULT_WORK_PROMPT =
  'Load context for {url}: check out branch {branch} in the {repo} repo, read the PR description, diff, CI status and review comments ({cli} reads them), then wait for my instructions.'

// Per state: the button label, when it applies (the order of the keys is the order of the checks in stateOf)
// and the default next-action prompt. States without a prompt only wait, unless the prompts file gives them one.
const STATE_INFO: Record<ActionState, { label: string; when: string; next?: string }> = {
  draft: { label: 'Mark ready', when: 'the PR is a draft', next: 'Mark PR {url} (branch {branch}) as ready for review with {readyHint}.' },
  'ci-failed': {
    label: 'Fix CI',
    when: 'a check failed',
    next: 'CI is failing on PR {url} (branch {branch}). Find the failing checks ({cli} can list them), fix the cause and push.',
  },
  conflicts: {
    label: 'Rebase',
    when: 'the PR has merge conflicts',
    next: 'PR {url} (branch {branch}) has conflicts with {base}. Rebase it, resolve the conflicts and force-push with lease.',
  },
  comments: {
    label: 'Address comments',
    when: 'changes were requested or review threads are unresolved',
    next: 'Go through the unresolved review comments on PR {url} (branch {branch}) (read them with {cli}), fix what is valid and draft replies for me to approve.',
  },
  mergeable: {
    label: 'Merge',
    when: 'approved, CI passing, and the PR is alone or at the bottom of its stack',
    next: 'PR {url} (branch {branch}) is approved and green. Confirm with me, then merge it with {cli}.',
  },
  'stack-below': { label: 'Wait for stack below', when: 'approved and green, but a PR below it in the stack is not merged yet' },
  'ci-running': { label: 'Wait for CI', when: 'checks are still running' },
  'no-reviewers': {
    label: 'Request a review',
    when: 'nobody is asked to review yet',
    next: 'Request reviews on PR {url} (branch {branch}) with {cli} from the right people or team based on CODEOWNERS and recent history.',
  },
  maintainers: { label: 'Wait for maintainers', when: 'nobody is asked to review and you cannot request reviews on the repo' },
  'in-review': { label: 'Wait for review', when: 'a review is requested and nothing else needs you' },
}

export const STATES = Object.keys(STATE_INFO) as ActionState[]
export const whenOf = (state: ActionState) => STATE_INFO[state].when

// First match wins.
export function stateOf(pr: Pr, isBottom: boolean): ActionState {
  if (pr.isDraft) return 'draft'
  if (pr.ci === 'FAILURE' || pr.ci === 'ERROR') return 'ci-failed'
  if (pr.mergeable === 'CONFLICTING') return 'conflicts'
  if (pr.review === 'CHANGES_REQUESTED' || pr.unresolved > 0) return 'comments'
  if (pr.review === 'APPROVED' && pr.ci === 'SUCCESS') return isBottom ? 'mergeable' : 'stack-below'
  if (pr.ci === 'PENDING' || pr.ci === 'EXPECTED') return 'ci-running'
  if (pr.reviewRequests === 0) return pr.canRequestReview ? 'no-reviewers' : 'maintainers'
  return 'in-review'
}

// {readyHint} and {state} come on top of the PR placeholders
const stateVars = (pr: Pr, state: ActionState) => ({ ...prVars(pr), readyHint: providerOf(pr.provider).readyHint, state })

// A next template from the prompts file also turns a wait-only state into a pressable action.
export function nextAction(pr: Pr, isBottom: boolean, prompts: StatePrompts = {}): Action {
  const state = stateOf(pr, isBottom)
  const { label, next } = STATE_INFO[state]
  const template = prompts[state]?.next?.trim() || next
  if (!template) return { state, label }
  return { state, label, prompt: plain(template, stateVars(pr, state)) }
}

// Reads the parsed prompts file: unknown states and fields that are not text are dropped.
export function toStatePrompts(parsed: unknown): StatePrompts {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('expected an object keyed by state')
  const prompts: StatePrompts = {}
  for (const state of STATES) {
    const entry: unknown = (parsed as Record<string, unknown>)[state]
    if (typeof entry !== 'object' || entry === null) continue
    const { next, work } = entry as Record<string, unknown>
    prompts[state] = { next: typeof next === 'string' ? next : undefined, work: typeof work === 'string' ? work : undefined }
  }
  return prompts
}

// What a new ~/.config/pr-deck.prompts.jsonc starts with: valid as it is ({}), every state as a commented-out block with its defaults.
export function promptsTemplate(): string {
  const header = [
    'Prompts per state for pr-deck. Read by the mod, never written after this file is created.',
    'Remove the // in front of a block to use it. Comments and trailing commas are fine here.',
    '',
    '"next" replaces the prompt of the next-action button in that state.',
    'A state with no default next prompt only waits; give it one and the wait becomes a button.',
    '"work" replaces the prompt of the Work on it button and of New session in that state.',
    'Without it the workPrompt option applies, then the built-in default.',
    '',
    'Placeholders: {pr} {number} {url} {title} {branch} {base} {repo} {fullName} {host} {cli} {readyHint} {state}',
  ]
  const blocks = STATES.map(state => {
    const { next, when } = STATE_INFO[state]
    const nextLines = next ? [`  "next": ${JSON.stringify(next)},`] : []
    return [`${state}: ${when}`, `"${state}": {`, ...nextLines, `  "work": ${JSON.stringify(DEFAULT_WORK_PROMPT)}`, '},']
  })
  const comment = (line: string) => (line ? `// ${line}` : '//')
  return [...header.map(comment), '{', ...blocks.flatMap(([title, ...lines]) => ['', comment(title ?? ''), ...lines.map(comment)]), '}', ''].join('\n')
}

// The third button: once the PR is green and only waiting on people, put Copilot on it
// (only when the user allows it and the code host has Copilot).
// The work prompt: the state's work template, then the workPrompt option, then the built-in default.
export function workAction(pr: Pr, next: Action, allowCopilot: boolean, workTemplate?: string, prompts: StatePrompts = {}): Action {
  const ref = `PR ${pr.url} (branch ${pr.head})`
  const provider = providerOf(pr.provider)

  if (allowCopilot && provider.supportsCopilot && pr.ci === 'SUCCESS' && pr.unresolved === 0 && !next.prompt && !pr.hasCopilot) {
    return {
      state: next.state,
      label: '✦ Copilot pass',
      prompt: `Request a review from Copilot on ${ref} with ${provider.cli} pr edit ${pr.url} --add-reviewer @copilot. Wait for its review to arrive (poll ${provider.cli} pr view --json reviews every minute, give up after 15 minutes), then check out ${pr.head}, go through each Copilot comment, fix the valid ones, push, and reply to and resolve each thread. List what you fixed and what you dismissed and why.`,
    }
  }

  return {
    state: next.state,
    label: '❯ Work on it',
    prompt: plain(prompts[next.state]?.work?.trim() || workTemplate?.trim() || DEFAULT_WORK_PROMPT, stateVars(pr, next.state)),
  }
}
