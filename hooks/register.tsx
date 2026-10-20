import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { GroupBy, Pr, Snapshot, Stack } from '../types'
import type { Action } from './prs'
import { nextAction, toStacks, workAction } from './prs'
import { fetchAll, repoFromRemote, ticketUrl } from './providers'
import { run } from './run'

const PANE = 'pr-deck'
const YOUR_MOVE = 'group:your-move'
const snapshot = atom({ plugin: 'pr-deck', key: 'snapshot' } as const, null)
const showAll = atom({ plugin: 'pr-deck', key: 'showAll' } as const, false)
const collapsed = atom({ plugin: 'pr-deck', key: 'collapsed' } as const, [] as string[])
// owner/repo, lowercase, as written in the config file
const ignored = atom({ plugin: 'pr-deck', key: 'ignored' } as const, [] as string[])
const showIgnored =atom({ plugin: 'pr-deck', key: 'showIgnored' } as const, false)
// options come as string | number | boolean | string[]; the command and path ones are strings
const str = (value: unknown) => (typeof value === 'string' ? value : '')
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
      return JSON.parse(text) as { ignored?: unknown }
    } catch {
      return {}
    }
  })()
  const list = Array.isArray(parsed.ignored) ? parsed.ignored.filter((x): x is string => typeof x === 'string') : []
  await update($, ignored, () => list.map(x => x.toLowerCase()))
}

async function saveConfig($: EngineInterface) {
  const config = { ignored: await read($, ignored) }
  await $.fs.write(await configPath($), `${JSON.stringify(config, null, 2)}\n`)
}

async function saveIgnored($: EngineInterface, list: string[]) {
  await update($, ignored, () => list)
  await saveConfig($)
}

async function openConfig($: EngineInterface, options: PluginOptions) {
  const path = await configPath($)
  if (!(await $.fs.exists(path))) await saveConfig($)
  await run($, str(options.editorCommand), { path })
}

async function refresh($: EngineInterface, options: PluginOptions) {
  await loadConfig($)
  const [{ prs, errors }, remote] = await Promise.all([
    fetchAll($, options),
    run($, str(options.remoteCommand)).catch(() => undefined),
  ])
  const now = await $.clock.now()
  const project = remote?.exitCode === 0 ? repoFromRemote(remote.stdout) : undefined
  const error = errors.join(' · ')

  // every host failed: keep the last list on screen next to the error
  const failed = errors.length > 0 && prs.length === 0
  await update($, snapshot, (old): Snapshot => ({ prs: failed ? (old?.prs ?? []) : prs, updatedAt: now, project, error: error || undefined }))
}

// cloneDir placeholders are plain text, not shell-quoted like the command ones
const plain = (template: string, vars: Record<string, string>) => template.replace(/\{(\w+)\}/g, (match, name: string) => vars[name] ?? match)

// where the PR's repo is cloned, undefined when cloneDir is blank
async function cloneDirOf($: EngineInterface, options: PluginOptions, pr: Pr) {
  const template = str(options.cloneDir).trim()
  if (!template) return undefined
  const cut = pr.fullName.lastIndexOf('/')
  const dir = plain(template, { host: pr.host, owner: pr.fullName.slice(0, cut), repo: pr.fullName.slice(cut + 1) })
  if (dir !== '~' && !dir.startsWith('~/')) return dir
  return `${(await $.env.get('HOME')) ?? ''}${dir.slice(1)}`
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

// Each repo (or PR, for random card colours) gets a theme colour picked from its name, so it keeps the same one across refreshes and filters.
const REPO_COLORS = ['claude', 'suggestion', 'merged', 'autoAccept', 'planMode', 'ide', 'permission']
const repoColor = (repo: string) =>
  REPO_COLORS[[...repo].reduce((sum, char) => sum + char.charCodeAt(0), 0) % REPO_COLORS.length] ?? 'claude'

// Labels are written "icon text"; buttonStyle keeps one half or both.
const labelFor = (style: unknown) => (label: string) => {
  const cut = label.indexOf(' ')
  if (style === 'icons') return label.slice(0, cut)
  if (style === 'text') return label.slice(cut + 1)
  return label
}

const short =(text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

export const register: Register = (on, options) => {
  const label = labelFor(options.buttonStyle)
  // ponytail: the option is only the atom's starting value, a toggle sticks until the session state resets
  const groupBy = atom({ plugin: 'pr-deck', key: 'groupBy' } as const, (options.defaultGroup === 'none' ? 'none' : 'status') as GroupBy)
  const refreshMs = (Number(options.refreshMinutes) || 2) * 60 * 1000
  const isAttention = !['status', 'repo', 'random'].includes(str(options.cardColors))
  const cardModes = ['attention', 'status', 'repo', 'random']
  const cardMode = isAttention ? 'attention' : str(options.cardColors)
  const cardColor = (pr: Pr, status: string, needsMe: boolean) => {
    if (options.cardColors === 'repo') return repoColor(pr.repo)
    if (options.cardColors === 'random') return repoColor(pr.url)
    if (isAttention) return needsMe ? status : 'subtle'
    return status
  }
  const needsYouAt = (pr: Pr, i: number) => Boolean(nextAction(pr, i === 0).prompt)

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'prs', description: 'Show your open PRs and stacks in a pane' })
    void refresh($, options)
    $.clock.every(refreshMs, () => void refresh($, options))

    return next(e)
  })

  on('command.run', { command: 'prs' }, async $ => {
    void refresh($, options)
    await $.ui.open({ id: PANE, title: 'Pull requests', focus: true })

    return { text: 'PR pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const snap = await read($, snapshot)

    if (snap === null) return <Text dimColor>Loading PRs…</Text>

    // the toggle flips away from the configured default
    const isAll = (await read($, showAll)) !== (options.alwaysShowAll === true) || !snap.project
    const ignoredList = await read($, ignored)
    const isIgnoredOpen = await read($, showIgnored)
    const visible = snap.prs.filter(pr => !ignoredList.includes(pr.fullName))
    const prs = isAll ? visible : visible.filter(pr => pr.fullName === snap.project)
    const fullNameOf = (repo: string) => snap.prs.find(pr => pr.repo === repo)?.fullName ?? repo
    const toggle = () => update($, showAll, value => !value)
    const stacks = toStacks(prs)
    const rank = (key: string) => STATUS_ORDER.indexOf(key)
    const statusOf = (pr: Pr, i: number) => tone(pr, nextAction(pr, i === 0)).status
    const moves = stacks
      .flatMap(stack => stack.prs.map((pr, i) => ({ pr, i })).filter(({ pr, i }) => needsYouAt(pr, i)))
      .sort((a, b) => rank(statusOf(a.pr, a.i)) - rank(statusOf(b.pr, b.i)))
    const pinMoves = options.pinYourMove !== false && moves.length > 0
    // ponytail: a stack where every PR needs you moves to Your move whole; a stack where only some do stays intact in its repo and those PRs show in both places
    const sections = pinMoves ? stacks.filter(s => !s.prs.every(needsYouAt)) : stacks
    const repos = [...new Set(sections.map(s => s.repo))]
    // numbered by bottom PR so a stack keeps its number when grouping changes
    const stackNumber = (stack: Stack) =>
      stacks
        .filter(s => s.prs.length > 1)
        .map(s => s.prs[0]?.number ?? 0)
        .sort((a, b) => a - b)
        .indexOf(stack.prs[0]?.number ?? 0) + 1
    const needsYou = moves.length
    const updated = new Date(snap.updatedAt).toTimeString().slice(0, 5)
    // border, padding, "#1234 ", the stack marker and the status take ~28 columns
    const titleRoom = Math.max(20, (e.viewport?.columns ?? 80) - 28)
    const submit = (text: string) => void $.prompt.submit({ text })
    const open = (url: string) => void run($, str(options.openCommand), { url })
    const switchHere = async (pr: Pr) => {
      const dir = await cloneDirOf($, options, pr)
      const where = dir ? `it should be at ${dir}` : 'look in nearby folders'
      submit(
        `Switch this session to repo ${pr.fullName} (host ${pr.host}) on branch ${pr.head}. If the current folder is not a clone of that repo, find the local clone (${where}) or clone it, cd there, fetch and check out ${pr.head}, then summarize the PR state and wait for instructions.`,
      )
    }
    const newSession = async (pr: Pr, prompt: string) => {
      const dir = (await cloneDirOf($, options, pr)) ?? (await $.session.cwd())
      const result = await run($, str(options.newSessionCommand), { dir, prompt, url: pr.url, branch: pr.head, repo: pr.fullName })
      $.ui.toast(result.exitCode === 0 ? `Opened a session for #${pr.number}` : short(result.stderr.trim() || `new session command exited ${result.exitCode}`, 200))
    }
    // ponytail: session state may still hold the removed 'project' value, treat anything else as status
    const folded = new Set(await read($, collapsed))
    const grouping: GroupBy =(await read($, groupBy)) === 'none' ? 'none' : 'status'
    // a stack groups as its bottom PR, so stacks never split
    const groupOf = (stack: Stack): string => {
      const bottom = stack.prs[0]
      if (!bottom || grouping === 'none') return ''
      return tone(bottom, nextAction(bottom, true)).status
    }
    const groupColor = (key: string) => STATUS_COLOR[key] ?? 'suggestion'
    // place: 'move' when drawn in Your move, since the same PR can also sit in its repo section
    const card = (pr: Pr, i: number, isStack: boolean, place = '') => {
      const action = nextAction(pr, i === 0)
      const work = workAction(pr, action, options.showCopilotPass !== false)
      const ci = ciLine(pr)
      const review = reviewLine(pr)
      const { color: statusColor, status } = tone(pr, action)
      const needsMe = Boolean(action.prompt)
      const color = cardColor(pr, statusColor, needsMe)
      const isDim = isAttention && !needsMe
      const hasBar = isAttention && needsMe
      const foldKey = `pr:${pr.url}`
      // the same PR can be drawn twice (Your move and its repo), so button keys carry the place
      const key = (name: string) => `${name}:${place}${pr.url}`
      const ticketLink = pr.ticket ? ticketUrl(options, pr.ticket) : undefined
      // the list holds PRs toggled away from the startCollapsed default
      const isPrFolded = folded.has(foldKey) !== (options.startCollapsed === true)
      const titleRow = (
        <Box justifyContent="space-between">
          <Box flexShrink={1}>
            <Button key={key('fold')} plain label={isPrFolded ? '▸' : '▾'} onPress={() => update($, collapsed, list => flipIn(list, foldKey))} />
            <Text> </Text>
            {isStack && <Text color={color}>{i === 0 ? '◆ ' : '◇ '}</Text>}
            <Button key={key('pr')} plain label={`#${pr.number}`} onPress={() => open(pr.url)} />
            <Text bold dimColor={isDim} color={color} wrap="truncate-end">
              {' '}
              {short(pr.title, titleRoom)}
            </Text>
          </Box>
          <Box flexShrink={0} marginLeft={1}>
            <Text color={statusColor}>{status}</Text>
          </Box>
        </Box>
      )

      // ponytail: the bar is an absolute Box pinned top and bottom, so it spans the card height whatever it holds; a long column of ┃ is clipped to it
      const bar = hasBar && (
        <Box position="absolute" top={0} bottom={0} left={0} width={1} overflow="hidden">
          <Text color={statusColor}>{'┃\n'.repeat(60)}</Text>
        </Box>
      )

      if (isPrFolded) {
        return (
          <Box key={pr.url} flexDirection="column" borderStyle="round" borderColor={color} paddingLeft={hasBar ? 2 : 1} paddingRight={1}>
            {bar}
            {titleRow}
          </Box>
        )
      }

      return (
        <Box key={pr.url} flexDirection="column" borderStyle="round" borderColor={color} paddingLeft={hasBar ? 2 : 1} paddingRight={1}>
          {bar}
          {titleRow}
          {options.showSummary !== false && pr.summary && <Text dimColor wrap="truncate-end">{pr.summary}</Text>}
          <Box flexWrap="wrap" columnGap={1}>
            <Button key={key('copy-url')} label={label('⧉ copy link')} onPress={press => void $.ui.copy({ text: pr.url, surface: press.surface })} />
            <Button key={key('browser')} label={label('↗ open')} onPress={() => open(pr.url)} />
            <Button key={key('copy-num')} label={label(`# copy ${pr.number}`)} onPress={press => void $.ui.copy({ text: String(pr.number), surface: press.surface })} />
          </Box>
          <Text dimColor={isDim} wrap="truncate-end">
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
            {pr.ticket && (
              ticketLink ? (
                <Button key={key('ticket')} plain label={pr.ticket} onPress={() => open(ticketLink)} />
              ) : (
                <Text>{pr.ticket}</Text>
              )
            )}
            <Text dimColor>{pr.ticket ? ' · ' : ''}</Text>
            <Button key={key('files')} plain label={short(pr.head, titleRoom)} onPress={() => open(`${pr.url}/files`)} />
          </Box>
          <Box marginTop={1} flexWrap="wrap" columnGap={1}>
            {/* ponytail: next action keeps its text in every buttonStyle, an arrow alone says nothing */}
            <Button
              key={key('next')}
              label={options.buttonStyle === 'text' ? action.label : `→ ${action.label}`}
              variant={action.prompt ? 'primary' : undefined}
              onPress={() => action.prompt && submit(action.prompt)}
            />
            {options.showFableButton !== false && (
              <Button
                key={key('review')}
                label={label('✦ Fable review')}
                onPress={() =>
                  submit(
                    `Spawn a subagent with model fable to review ${pr.url} against the repo's own standards. Report findings to me, do not post anything to ${pr.host}.`,
                  )
                }
              />
            )}
            <Button key={key('work')} label={label(work.label)} onPress={() => work.prompt && submit(work.prompt)} />
            <Button key={key('switch')} label={label('⎇ Switch here')} onPress={() => void switchHere(pr)} />
            <Button key={key('new-session')} label={label('⧉ New session')} onPress={() => void newSession(pr, workAction(pr, action, false).prompt ?? '')} />
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {/* ponytail: the header is a filled Box, so the strip spans the pane whatever its width; the empty row after it comes from the next block's marginTop */}
        <Box flexDirection="column" backgroundColor="userMessageBackground">
          <Box justifyContent="center">
            <Text wrap="truncate-end">
              <Text bold color="claude">
                PULL REQUESTS
              </Text>
              <Text bold> · {isAll ? 'ALL REPOS' : snap.project?.toUpperCase()} · {prs.length} OPEN · </Text>
              <Text bold color="warning">{needsYou} NEED YOU</Text>
              <Text dimColor> · updated {updated}</Text>
            </Text>
          </Box>
          <Box justifyContent="center" flexWrap="wrap" columnGap={1}>
            {snap.project && <Button key="scope" label={label(isAll ? '◧ This repo' : '◨ All')} onPress={toggle} />}
            <Button key="group" label={label(`⊞ ${grouping}`)} onPress={() => update($, groupBy, () => NEXT_GROUP[grouping])} />
            <Button
              key="colors"
              label={label(`◐ ${cardMode}`)}
              onPress={async () => {
                const next = cardModes[(cardModes.indexOf(cardMode) + 1) % cardModes.length] ?? 'attention'
                const { deny } = await $.config.set({ key: `${$.plugin.name}.cardColors`, value: next })
                if (deny) $.ui.toast(deny)
              }}
            />
            <Button key="refresh" label={label('↻ Refresh')} onPress={() => refresh($, options)} />
            <Button key="config" label={label('⚙ Config')} onPress={() => openConfig($, options)} />
          </Box>
        </Box>
        {!snap.project && <Text dimColor>no repo remote in this folder, showing all repos</Text>}
        {snap.error && <Text color="error">fetch failed: {short(snap.error, 200)}</Text>}
        {prs.length === 0 && (
          <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1} marginTop={1}>
            <Text dimColor>No open PRs of yours in {snap.project}.</Text>
            <Button key="show-all" label="Show all PRs" variant="primary" onPress={toggle} />
          </Box>
        )}
        {pinMoves && (
          <Box flexDirection="column" marginTop={1}>
            <Button key={YOUR_MOVE} plain onPress={() => update($, collapsed, list => flipIn(list, YOUR_MOVE))}>
              <Text color="warning">{folded.has(YOUR_MOVE) ? '▸' : '▾'} </Text>
              <Text bold color="inverseText" backgroundColor="warning"> ● YOUR MOVE </Text>{' '}
              <Text dimColor>{moves.length}</Text>
            </Button>
            {!folded.has(YOUR_MOVE) &&
              [...new Set(moves.map(m => m.pr.repo))].map(repo => {
                const mine = moves.filter(m => m.pr.repo === repo)
                // moves are already sorted by status, so the keys come out in attention order
                const keys = [...new Set(mine.map(m => (grouping === 'none' ? '' : statusOf(m.pr, m.i))))]
                return (
                  <Box key={`move:${repo}`} flexDirection="column" marginTop={1}>
                    <Text>
                      <Text bold color="inverseText" backgroundColor={repoColor(repo)}>
                        {' '}
                        {repo.toUpperCase()}{' '}
                      </Text>{' '}
                      <Text dimColor>{mine.length}</Text>
                    </Text>
                    {keys.map(key => {
                      const statusId = `status:move:${repo}:${key}`
                      const isGroupFolded = key !== '' && folded.has(statusId)
                      return (
                        <Box key={`move:${repo}:${key}`} flexDirection="column">
                          {key && (
                            <Button key={statusId} plain onPress={() => update($, collapsed, list => flipIn(list, statusId))}>
                              <Text bold color={groupColor(key)}>
                                {isGroupFolded ? '▸' : '▾'} {key}{' '}
                                <Text dimColor>{mine.filter(m => statusOf(m.pr, m.i) === key).length}</Text>
                              </Text>
                            </Button>
                          )}
                          {!isGroupFolded &&
                            mine.filter(m => !key || statusOf(m.pr, m.i) === key).map(({ pr, i }) => card(pr, i, false, 'move:'))}
                        </Box>
                      )
                    })}
                  </Box>
                )
              })}
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
                <Text dimColor>{sections.filter(s => s.repo === repo).reduce((n, s) => n + s.prs.length, 0)}</Text>
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
            {[...new Set(sections.filter(s => s.repo === repo && !folded.has(repo)).map(groupOf))]
              .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
              .map(key => {
                const group = sections.filter(s => s.repo === repo && groupOf(s) === key)
                // status ids are prefixed so they never clash with repo names, stack: or pr: keys
                const statusId = `status:repo:${repo}:${key}`
                const isGroupFolded = key !== '' && folded.has(statusId)
                return (
                  <Box key={`${repo}:${key}`} flexDirection="column" marginTop={1}>
                    {key && (
                      <Button key={statusId} plain onPress={() => update($, collapsed, list => flipIn(list, statusId))}>
                        <Text bold color={groupColor(key)}>
                          {isGroupFolded ? '▸' : '▾'} {key} <Text dimColor>{group.reduce((n, s) => n + s.prs.length, 0)}</Text>
                        </Text>
                      </Button>
                    )}
                    {!isGroupFolded && group.map(stack => {
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
