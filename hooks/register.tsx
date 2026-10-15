import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GroupBy, Pr, Snapshot, Stack } from '../types'
import type { Action } from './prs'
import { QUERY, nextAction, repoFromRemote, toPr, toStacks, workAction } from './prs'

const PANE = 'pr-deck'
const POLL_MS = 2 * 60 * 1000
const snapshot = atom({ plugin: 'pr-deck', key: 'snapshot' } as const, null)
const showAll = atom({ plugin: 'pr-deck', key: 'showAll' } as const, false)
const groupBy = atom({ plugin: 'pr-deck', key: 'groupBy' } as const, 'status' as GroupBy)
const collapsed = atom({ plugin: 'pr-deck', key: 'collapsed' } as const, [] as string[])
// owner/repo, lowercase, as written in the config file
const ignored = atom({ plugin: 'pr-deck', key: 'ignored' } as const, [] as string[])
// ticket links go to `${jiraBaseUrl}${KEY}`, e.g. https://yourcompany.atlassian.net/browse/; empty shows the key as text
const jiraBaseUrl = atom({ plugin: 'pr-deck', key: 'jiraBaseUrl' } as const, '')
const showIgnored =atom({ plugin: 'pr-deck', key: 'showIgnored' } as const, false)
const flipIn =(list: string[], item: string) => (list.includes(item) ? list.filter(x => x !== item) : [...list, item])
const NEXT_GROUP: Record<GroupBy, GroupBy> = { status: 'none', none: 'status' }
// statuses in the order they need attention
const STATUS_ORDER = ['✗ broken', '✗ conflicts', '● needs you', '○ waiting', '✓ approved']
const STATUS_COLOR: Record<string, string> = {
  '✗ broken': 'error',
  '✗ conflicts': 'error',
  '● needs you': 'warning',
  '○ waiting': 'suggestion',
  '✓ approved': 'success',
}

const configPath = async ($: EngineInterface) => `${(await $.env.get('HOME')) ?? ''}/.config/pr-deck.json`

// The config file is the source of truth; edits to it apply on the next refresh.
async function loadConfig($: EngineInterface) {
  const text = await $.fs.read(await configPath($)).catch(() => '{}')
  const parsed = (() => {
    try {
      return JSON.parse(text) as { ignored?: unknown; jiraBaseUrl?: unknown }
    } catch {
      return {}
    }
  })()
  const list = Array.isArray(parsed.ignored) ? parsed.ignored.filter((x): x is string => typeof x === 'string') : []
  await update($, ignored, () => list.map(x => x.toLowerCase()))
  await update($, jiraBaseUrl, () => (typeof parsed.jiraBaseUrl === 'string' ? parsed.jiraBaseUrl.trim() : ''))
}

async function saveConfig($: EngineInterface) {
  const config = { ignored: await read($, ignored), jiraBaseUrl: await read($, jiraBaseUrl) }
  await $.fs.write(await configPath($), `${JSON.stringify(config, null, 2)}\n`)
}

async function saveIgnored($: EngineInterface, list: string[]) {
  await update($, ignored, () => list)
  await saveConfig($)
}

async function openConfig($: EngineInterface) {
  const path = await configPath($)
  if (!(await $.fs.exists(path))) await saveConfig($)
  await $.process.run(['open', '-t', path])
}

async function refresh($: EngineInterface) {
  await loadConfig($)
  const [gh, remote] = await Promise.all([
    $.process.run(['gh', 'api', 'graphql', '-f', `query=${QUERY}`]),
    $.process.run(['git', 'remote', 'get-url', 'origin']).catch(() => undefined),
  ])
  const now = await $.clock.now()
  const project = remote?.exitCode === 0 ? repoFromRemote(remote.stdout) : undefined

  if (gh.exitCode !== 0) {
    await update($, snapshot, old => ({ prs: old?.prs ?? [], updatedAt: now, project, error: gh.stderr.trim() }))
    return
  }

  const prs = JSON.parse(gh.stdout).data.viewer.pullRequests.nodes.map(toPr)
  await update($, snapshot, (): Snapshot => ({ prs, updatedAt: now, project }))
}

function ciLine(pr: Pr): { text: string; color: string } {
  const counts = `${pr.checksPassed}/${pr.checksTotal}`
  if (pr.ci === 'SUCCESS') return { text: '✓ CI passing', color: 'success' }
  if (pr.ci === 'FAILURE' || pr.ci === 'ERROR') return { text: `✗ CI failed ${counts}`, color: 'error' }
  if (pr.ci === 'PENDING' || pr.ci === 'EXPECTED') return { text: `◌ CI running ${counts}`, color: 'warning' }
  return { text: '· no CI', color: 'subtle' }
}

function reviewLine(pr: Pr): { text: string; color: string } {
  if (pr.isDraft) return { text: 'draft', color: 'subtle' }
  if (pr.unresolved > 0) return { text: `${pr.unresolved} unresolved`, color: 'warning' }
  if (pr.review === 'APPROVED') return { text: 'approved', color: 'success' }
  if (pr.review === 'CHANGES_REQUESTED') return { text: 'changes requested', color: 'error' }
  return { text: 'review needed', color: 'suggestion' }
}

// Card colour and the status in its top-right corner.
function tone(pr: Pr, action: Action): { color: string; status: string } {
  if (pr.ci === 'FAILURE' || pr.ci === 'ERROR') return { color: 'error', status: '✗ broken' }
  if (pr.mergeable === 'CONFLICTING') return { color: 'error', status: '✗ conflicts' }
  if (action.prompt) return { color: 'warning', status: '● needs you' }
  if (pr.review === 'APPROVED') return { color: 'success', status: '✓ approved' }
  return { color: 'suggestion', status: '○ waiting' }
}

// Each repo gets a theme colour picked from its name, so it keeps the same one across refreshes and filters.
const REPO_COLORS = ['claude', 'suggestion', 'merged', 'autoAccept', 'planMode', 'ide', 'permission']
const repoColor = (repo: string) =>
  REPO_COLORS[[...repo].reduce((sum, char) => sum + char.charCodeAt(0), 0) % REPO_COLORS.length] ?? 'claude'

const short =(text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'prs', description: 'Show your open PRs and stacks in a pane' })
    void refresh($)
    $.clock.every(POLL_MS, () => void refresh($))

    return next(e)
  })

  on('command.run', { command: 'prs' }, async $ => {
    void refresh($)
    await $.ui.open({ id: PANE, title: 'Pull requests', focus: true })

    return { text: 'PR pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const snap = await read($, snapshot)

    if (snap === null) return <Text dimColor>Loading PRs…</Text>

    const isAll = (await read($, showAll)) || !snap.project
    const ignoredList = await read($, ignored)
    const jira = await read($, jiraBaseUrl)
    const isIgnoredOpen = await read($, showIgnored)
    const visible = snap.prs.filter(pr => !ignoredList.includes(pr.fullName))
    const prs = isAll ? visible : visible.filter(pr => pr.fullName === snap.project)
    const fullNameOf = (repo: string) => snap.prs.find(pr => pr.repo === repo)?.fullName ?? repo
    const toggle = () => update($, showAll, value => !value)
    const stacks = toStacks(prs)
    const repos = [...new Set(stacks.map(s => s.repo))]
    // numbered by bottom PR so a stack keeps its number when grouping changes
    const stackNumber = (stack: Stack) =>
      stacks
        .filter(s => s.prs.length > 1)
        .map(s => s.prs[0]?.number ?? 0)
        .sort((a, b) => a - b)
        .indexOf(stack.prs[0]?.number ?? 0) + 1
    const needsYou = stacks.flatMap(s => s.prs.map((pr, i) => nextAction(pr, i === 0))).filter(a => a.prompt).length
    const updated = new Date(snap.updatedAt).toTimeString().slice(0, 5)
    // border, padding, "#1234 ", the stack marker and the status take ~28 columns
    const titleRoom = Math.max(20, (e.viewport?.columns ?? 80) - 28)
    const submit = (text: string) => void $.prompt.submit({ text })
    const open = (url: string) => void $.process.run(['open', url])
    // ponytail: session state may still hold the removed 'project' value, treat anything else as status
    const folded = new Set(await read($, collapsed))
    const grouping: GroupBy =(await read($, groupBy)) === 'none' ? 'none' : 'status'
    // a stack groups as its bottom PR, so stacks never split
    const groupOf = (stack: Stack): string => {
      const bottom = stack.prs[0]
      if (!bottom || grouping === 'none') return ''
      return tone(bottom, nextAction(bottom, true)).status
    }
    const rank = (key: string) => STATUS_ORDER.indexOf(key)
    const groupColor = (key: string) => STATUS_COLOR[key] ?? 'suggestion'
    const card = (pr: Pr, i: number, isStack: boolean) => {
      const action = nextAction(pr, i === 0)
      const work = workAction(pr, action)
      const ci = ciLine(pr)
      const review = reviewLine(pr)
      const { color, status } = tone(pr, action)

      return (
        <Box key={pr.url} flexDirection="column" borderStyle="round" borderColor={color} paddingX={1}>
          <Box justifyContent="space-between">
            <Box flexShrink={1}>
              {isStack && <Text color={color}>{i === 0 ? '◆ ' : '◇ '}</Text>}
              <Button key={`pr:${pr.url}`} plain label={`#${pr.number}`} onPress={() => open(pr.url)} />
              <Text bold color={color} wrap="truncate-end">
                {' '}
                {short(pr.title, titleRoom)}
              </Text>
            </Box>
            <Box flexShrink={0} marginLeft={1}>
              <Text color={color}>{status}</Text>
            </Box>
          </Box>
          <Text wrap="truncate-end">
            <Text color={ci.color}>{ci.text}</Text>
            <Text dimColor> · </Text>
            <Text color={review.color}>{review.text}</Text>
            <Text dimColor> · {pr.changedFiles} files </Text>
            <Text bold color="success">
              +{pr.additions}
            </Text>
            <Text> </Text>
            <Text bold color="error">
              −{pr.deletions}
            </Text>
          </Text>
          <Box>
            {pr.jira && (
              jira ? (
                <Button key={`jira:${pr.url}`} plain label={pr.jira} onPress={() => open(`${jira}${pr.jira}`)} />
              ) : (
                <Text>{pr.jira}</Text>
              )
            )}
            <Text dimColor>{pr.jira ? ' · ' : ''}</Text>
            <Button key={`files:${pr.url}`} plain label={short(pr.head, titleRoom)} onPress={() => open(`${pr.url}/files`)} />
          </Box>
          <Box marginTop={1} flexWrap="wrap">
            <Button
              key={`next:${pr.url}`}
              label={`→ ${action.label}`}
              variant={action.prompt ? 'primary' : undefined}
              onPress={() => action.prompt && submit(action.prompt)}
            />
            <Text> </Text>
            <Button
              key={`review:${pr.url}`}
              label="✦ Fable review"
              onPress={() =>
                submit(
                  `Spawn a subagent with model fable to review ${pr.url} against the repo's own standards. Report findings to me, do not post anything to GitHub.`,
                )
              }
            />
            <Text> </Text>
            <Button key={`work:${pr.url}`} label={work.label} onPress={() => work.prompt && submit(work.prompt)} />
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Text wrap="truncate-end">
          <Text bold color="claude">
            PULL REQUESTS
          </Text>
          <Text> · {isAll ? 'all repos' : snap.project} · {prs.length} open · </Text>
          <Text color="warning">{needsYou} need you</Text>
          <Text dimColor> · updated {updated}</Text>
        </Text>
        {!snap.project && <Text dimColor>no GitHub remote in this folder, showing all repos</Text>}
        <Box flexWrap="wrap" columnGap={1}>
          {snap.project && <Button key="scope" label={isAll ? '◧ This repo' : '◨ All'} onPress={toggle} />}
          <Button key="group" label={`⊞ ${grouping}`} onPress={() => update($, groupBy, () => NEXT_GROUP[grouping])} />
          <Button key="refresh" label="↻ Refresh" onPress={() => refresh($)} />
          <Button key="config" label="⚙ Config" onPress={() => openConfig($)} />
        </Box>
        {snap.error && <Text color="error">gh failed: {short(snap.error, 200)}</Text>}
        {prs.length === 0 && (
          <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1} marginTop={1}>
            <Text dimColor>No open PRs of yours in {snap.project}.</Text>
            <Button key="show-all" label="Show all PRs" variant="primary" onPress={toggle} />
          </Box>
        )}
        {repos.map(repo => (
          <Box key={repo} flexDirection="column" marginTop={1}>
            <Box>
              <Button key={`repo:${repo}`} plain onPress={() => update($, collapsed, list => flipIn(list, repo))}>
                <Text bold size="title" color="inverseText" backgroundColor={repoColor(repo)}>
                  {' '}
                  {folded.has(repo) ? '▸' : '▾'} {repo.toUpperCase()}{' '}
                </Text>{' '}
                <Text dimColor>{prs.filter(pr => pr.repo === repo).length}</Text>
              </Button>
              <Text>  </Text>
              <Button
                key={`ignore:${repo}`}
                plain
                dimColor
                label="⊘ ignore"
                onPress={() => saveIgnored($, [...ignoredList, fullNameOf(repo)])}
              />
            </Box>
            {/* viewport is the whole screen, not the pane: draw a long rule and clip it to one row of the pane's width */}
            <Box width="100%" height={1} overflow="hidden">
              <Text color={repoColor(repo)}>{'━'.repeat(500)}</Text>
            </Box>
            {[...new Set(stacks.filter(s => s.repo === repo && !folded.has(repo)).map(groupOf))]
              .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
              .map(key => {
                const group = stacks.filter(s => s.repo === repo && groupOf(s) === key)
                return (
                  <Box key={`${repo}:${key}`} flexDirection="column" marginTop={1}>
                    {key && (
                      <Text bold color={groupColor(key)}>
                        ▸ {key} <Text dimColor>{group.reduce((n, s) => n + s.prs.length, 0)}</Text>
                      </Text>
                    )}
                    {group.map(stack => {
                      const isStack = stack.prs.length > 1
                      // collapsed keys share one list with repos; stack keys are prefixed so they never clash
                      const stackId = `stack:${stack.prs[0]?.url}`
                      const isFolded = isStack && folded.has(stackId)
                      const top = stack.prs[stack.prs.length - 1]
                      return (
                        <Box key={`${repo}:${stack.prs[0]?.head}`} flexDirection="column">
                          {isStack && (
                            <Button
                              key={`stack:${stackId}`}
                              plain
                              onPress={() => update($, collapsed, list => flipIn(list, stackId))}
                            >
                              <Text color="claude">
                                {isFolded ? '▸' : '▾'} stack #{stackNumber(stack)} on {stack.base}
                              </Text>
                              {isFolded && top && (
                                <Text dimColor>
                                  {' '}
                                  · {stack.prs.length} PRs · last #{top.number} {short(top.title, titleRoom - 20)}
                                </Text>
                              )}
                            </Button>
                          )}
                          {!isFolded && stack.prs.map((pr, i) => card(pr, i, isStack))}
                          {isStack && !isFolded && <Text color="claude">└─ end of stack #{stackNumber(stack)}</Text>}
                        </Box>
                      )
                    })}
                  </Box>
                )
              })}
          </Box>
        ))}
        {ignoredList.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Button key="ignored" plain dimColor onPress={() => update($, showIgnored, value => !value)}>
              <Text dimColor>
                {isIgnoredOpen ? '▾' : '▸'} Ignored {ignoredList.length}
              </Text>
            </Button>
            {isIgnoredOpen &&
              ignoredList.map(name => (
                <Box key={`ignored:${name}`}>
                  <Text dimColor>
                    {'  '}
                    {name} · {snap.prs.filter(pr => pr.fullName === name).length} open{'  '}
                  </Text>
                  <Button
                    key={`unignore:${name}`}
                    plain
                    label="↺ unignore"
                    onPress={() => saveIgnored($, ignoredList.filter(x => x !== name))}
                  />
                </Box>
              ))}
          </Box>
        )}
      </Box>
    )
  })
}
