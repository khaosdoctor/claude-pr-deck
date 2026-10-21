import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { GroupBy, Pr, PromptsFile, Snapshot, Stack, View } from '../types'
import { configScreen } from './config-screen'
import { parseJsonc } from './jsonc'
import { DEFAULT_FABLE_PROMPT, nextAction, plain, prVars, promptsTemplate, summaryOf, toStacks, toStatePrompts, workAction } from './prs'
import { fetchAll, repoFromRemote, ticketUrl } from './providers'
import { quote, run } from './run'
import { keepFailedHosts, parseConfig, repoKeyOf, safeSessionName, splitFullName } from './snapshot'
import { TERMINALS } from './terminals'
import type { TerminalEnv } from './terminals'

const PANE = 'pr-deck'
const YOUR_MOVE = 'group:your-move'
const snapshot = atom({ plugin: 'pr-deck', key: 'snapshot' } as const, null)
const showAll = atom({ plugin: 'pr-deck', key: 'showAll' } as const, false)
const collapsed = atom({ plugin: 'pr-deck', key: 'collapsed' } as const, [] as string[])
// owner/repo, lowercase, as written in the config file
const ignored = atom({ plugin: 'pr-deck', key: 'ignored' } as const, [] as string[])
// status the person picked for a PR url, saved in the config file; a PR with no entry shows its own status
const overrides = atom({ plugin: 'pr-deck', key: 'overrides' } as const, {} as Record<string, string>)
const showIgnored =atom({ plugin: 'pr-deck', key: 'showIgnored' } as const, false)
const view = atom({ plugin: 'pr-deck', key: 'view' } as const, 'list' as View)
// the per-state prompt templates from ~/.config/pr-deck.prompts.jsonc, or why it could not be read
const prompts = atom({ plugin: 'pr-deck', key: 'prompts' } as const, { map: {} } as PromptsFile)
// options come as string | number | boolean | string[]; the command and path ones are strings
const str = (value: unknown) => (typeof value === 'string' ? value : '')
// listed in the order the statuses need attention
const STATUS_COLOR: Record<string, string> = {
  '✗ broken': 'error',
  '✗ conflicts': 'error',
  '● needs you': 'warning',
  '○ waiting': 'suggestion',
  '✓ approved': 'success',
}
const STATUS_ORDER = Object.keys(STATUS_COLOR)
const colorOfStatus = (status: string) => STATUS_COLOR[status] ?? 'suggestion'

// the statuses a move button cycles through after auto, in order
const MOVES = ['○ waiting', '● needs you', '✓ approved']
// undefined past the last one means back to auto
const nextMove = (current: string | undefined) => MOVES[MOVES.indexOf(current ?? '') + 1]

const configFile = async ($: EngineInterface, name: string) => `${(await $.env.get('HOME')) ?? ''}/.config/${name}`

// Loads and saves of the config file run one at a time: a refresh reading the file between a save's state update and its write would put the old values back.
const configQueue = { tail: Promise.resolve() as Promise<unknown> }
function serial<T>(task: () => Promise<T>): Promise<T> {
  const result = configQueue.tail.then(task)
  configQueue.tail = result.catch(() => undefined)
  return result
}

// The config file is the source of truth; edits to it apply on the next refresh.
function loadConfig($: EngineInterface) {
  return serial(async () => {
    const path = await configFile($, 'pr-deck.json')
    const text = (await $.fs.exists(path)) ? await $.fs.read(path).catch(() => '') : '{}'
    const config = parseConfig(text, MOVES)
    // a file that does not parse (mid-edit) keeps what is in memory, or the next save would wipe the person's list
    if (!config) return
    await update($, ignored, () => config.ignored)
    await update($, overrides, () => config.overrides)
  })
}

// A separate file from pr-deck.json: the mod only reads it, so it can keep the user's comments.
async function loadPrompts($: EngineInterface) {
  const path = await configFile($, 'pr-deck.prompts.jsonc')
  if (!(await $.fs.exists(path))) return update($, prompts, () => ({ map: {} }))
  try {
    const map = toStatePrompts(parseJsonc(await $.fs.read(path)))
    return update($, prompts, () => ({ map }))
  } catch (error) {
    return update($, prompts, () => ({ map: {}, error: error instanceof Error ? error.message : String(error) }))
  }
}

async function saveConfig($: EngineInterface) {
  const snap = await read($, snapshot)
  const urls = new Set(snap?.prs.map(pr => pr.url))
  // overrides of PRs that are gone are dropped; before the first fetch, or after a failed one, there is nothing to compare with
  const kept = Object.entries(await read($, overrides)).filter(([url]) => !snap || snap.error || urls.has(url))
  const config = { ignored: await read($, ignored), overrides: Object.fromEntries(kept) }
  await $.fs.write(await configFile($, 'pr-deck.json'), `${JSON.stringify(config, null, 2)}\n`)
}

// undefined puts the PR back to auto
function saveOverride($: EngineInterface, url: string, status: string | undefined) {
  return serial(async () => {
    const rest = Object.entries(await read($, overrides)).filter(([key]) => key !== url)
    await update($, overrides, () => Object.fromEntries(status ? [...rest, [url, status]] : rest))
    await saveConfig($)
  })
}

function saveIgnored($: EngineInterface, list: (current: string[]) => string[]) {
  return serial(async () => {
    await update($, ignored, list)
    await saveConfig($)
  })
}

async function openFile($: EngineInterface, options: PluginOptions, name: string, create: (path: string) => Promise<unknown>) {
  const path = await configFile($, name)
  if (!(await $.fs.exists(path))) await create(path)
  await run($, str(options.editorCommand), { path })
}

async function refresh($: EngineInterface, options: PluginOptions) {
  await loadConfig($)
  await loadPrompts($)
  const [{ prs, errors }, remote] = await Promise.all([
    fetchAll($, options),
    run($, str(options.remoteCommand)).catch(() => undefined),
  ])
  const now = await $.clock.now()
  const project = remote?.exitCode === 0 ? repoFromRemote(remote.stdout) : undefined
  const error = errors.join(' · ')

  await update($, snapshot, (old): Snapshot => ({ prs: keepFailedHosts(prs, old?.prs ?? [], errors), updatedAt: now, project, error: error || undefined }))
}

// the session name for a PR, e.g. pr-3109-worker; empty turns naming off
const sessionNameOf = (options: PluginOptions, pr: Pr) =>
  options.autoRename === false ? '' : safeSessionName(plain(str(options.sessionName).trim(), prVars(pr)))

// where the PR's repo is cloned, undefined when cloneDir is blank
async function cloneDirOf($: EngineInterface, options: PluginOptions, pr: Pr) {
  const template = str(options.cloneDir).trim()
  if (!template) return undefined
  const dir = plain(template, { host: pr.host, ...splitFullName(pr.fullName) })
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

// The status in a card's top-right corner, from the PR's own state.
function ownStatus(pr: Pr, needsMe: boolean) {
  if (pr.ci === 'FAILURE' || pr.ci === 'ERROR') return '✗ broken'
  if (pr.mergeable === 'CONFLICTING') return '✗ conflicts'
  if (needsMe) return '● needs you'
  if (pr.review === 'APPROVED') return '✓ approved'
  return '○ waiting'
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
  // the option is only the atom's starting value, a toggle sticks until the session state resets
  const groupBy = atom({ plugin: 'pr-deck', key: 'groupBy' } as const, (options.defaultGroup === 'none' ? 'none' : 'status') as GroupBy)
  const isAttention = !['status', 'repo', 'random'].includes(str(options.cardColors))
  const cardModes = ['attention', 'status', 'repo', 'random']
  const cardMode = isAttention ? 'attention' : str(options.cardColors)
  const cardColor = (pr: Pr, repo: string, status: string, needsMe: boolean) => {
    if (options.cardColors === 'repo') return repoColor(repo)
    if (options.cardColors === 'random') return repoColor(pr.url)
    if (isAttention) return needsMe ? status : 'subtle'
    return status
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'prs', description: 'Show your open PRs and stacks in a pane' })
    void refresh($, options)
    $.clock.every((Number(options.refreshMinutes) || 2) * 60 * 1000,() => void refresh($, options))
    // session.start also fires on a reload, so this reopens a pane the person closed then; unfocused so the prompt keeps the cursor
    if (options.openOnStart === true) void $.ui.open({ id: PANE, title: 'Pull requests' })

    return next(e)
  })

  on('command.run', { command: 'prs' }, async $ => {
    void refresh($, options)
    await $.ui.open({ id: PANE, title: 'Pull requests', focus: true })

    return { text: 'PR pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    // mobile has no Input element, so it keeps the list
    if ('Input' in ui && (await read($, view)) === 'config') {
      return configScreen($, ui, {
        options,
        label,
        back: () => void update($, view, () => 'list'),
        openIgnored: () => void openFile($, options, 'pr-deck.json', () => serial(() => saveConfig($))),
        // the file is only created here, with every state as a commented-out block
        openPrompts: () => void openFile($, options, 'pr-deck.prompts.jsonc', path => $.fs.write(path, promptsTemplate())),
      })
    }
    const snap = await read($, snapshot)

    if (snap === null) return <Text dimColor>Loading PRs…</Text>

    // the toggle flips away from the configured default
    const isAll = (await read($, showAll)) !== (options.alwaysShowAll === true) || !snap.project
    const ignoredList = await read($, ignored)
    const isIgnoredOpen = await read($, showIgnored)
    const visible = snap.prs.filter(pr => !ignoredList.includes(pr.fullName))
    const prs = isAll ? visible : visible.filter(pr => pr.fullName === snap.project)
    const toggle = () => update($, showAll, value => !value)
    const fold = (id: string) => update($, collapsed, list => (list.includes(id) ? list.filter(x => x !== id) : [...list, id]))
    const stacks = toStacks(prs)
    const rank = (key: string) => STATUS_ORDER.indexOf(key)
    const manual = await read($, overrides)
    const { map: statePrompts, error: promptsError } = await read($, prompts)
    // the one place a PR's status, colour and "needs you" come from: the person's pick when there is one, else its own
    const statusFor = (pr: Pr, i: number) => {
      const hasPrompt = Boolean(nextAction(pr, i === 0, statePrompts).prompt)
      const picked = manual[pr.url]
      const status = picked ?? ownStatus(pr, hasPrompt)
      return { color: colorOfStatus(status), status, needsMe: picked ? picked === '● needs you' : hasPrompt, isManual: Boolean(picked) }
    }
    const statusOf = (pr: Pr, i: number) => statusFor(pr, i).status
    const moves = stacks
      .flatMap(stack => stack.prs.map((pr, i) => ({ pr, i })).filter(({ pr, i }) => statusFor(pr, i).needsMe))
      .sort((a, b) => rank(statusOf(a.pr, a.i)) - rank(statusOf(b.pr, b.i)))
    const pinMoves = options.pinYourMove !== false && moves.length > 0
    // a stack where every PR needs you moves to Your move whole; a stack where only some do stays intact in its repo and those PRs show in both places
    const sections = pinMoves ? stacks.filter(s => !s.prs.every((pr, i) => statusFor(pr, i).needsMe)) : stacks
    // sections are named by repoKey, so two repos with the same short name stay apart
    const repoKey = repoKeyOf(snap.prs)
    const sectionRepo = (stack: Stack) => (stack.prs[0] ? repoKey(stack.prs[0]) : stack.repo)
    const repos = [...new Set(sections.map(sectionRepo))]
    // numbered by bottom PR so a stack keeps its number when grouping changes
    // PR numbers repeat across repos, so the url identifies the bottom PR
    const bottoms = stacks
      .filter(s => s.prs.length > 1)
      .flatMap(s => s.prs.slice(0, 1))
      .sort((a, b) => a.number - b.number || a.url.localeCompare(b.url))
    const stackNumber = (stack: Stack) => bottoms.findIndex(pr => pr.url === stack.prs[0]?.url) + 1
    // border, padding, "#1234 ", the stack marker and the status take ~28 columns
    const titleRoom = Math.max(20, (e.viewport?.columns ?? 80) - 28)
    const submit = (text: string) => void $.prompt.submit({ text })
    const open = (url: string) => void run($, str(options.openCommand), { url })
    const switchHere = async (pr: Pr) => {
      const name = sessionNameOf(options, pr)
      if (name) await $.command.run({ command: 'rename', args: name }).catch(() => $.ui.toast(`Could not rename the session to ${name}`))
      const dir = await cloneDirOf($, options, pr)
      const where = dir ? `it should be at ${dir}` : 'look in nearby folders'
      submit(
        `Switch this session to repo ${pr.fullName} (host ${pr.host}) on branch ${pr.head}. If the current folder is not a clone of that repo, find the local clone (${where}) or clone it, cd there, fetch and check out ${pr.head}, then summarize the PR state and wait for instructions.`,
      )
    }
    const newSession = async (pr: Pr, prompt: string) => {
      const dir = (await cloneDirOf($, options, pr)) ?? (await $.session.cwd())
      // an empty option means auto: the first terminal that matches the session's own environment
      const env: TerminalEnv = {
        program: await $.env.get('TERM_PROGRAM'),
        bundleId: await $.env.get('__CFBundleIdentifier'),
        tmux: await $.env.get('TMUX'),
        zellij: await $.env.get('ZELLIJ'),
        kittyWindow: await $.env.get('KITTY_WINDOW_ID'),
        alacrittyWindow: await $.env.get('ALACRITTY_WINDOW_ID'),
      }
      const custom = str(options.newSessionCommand).trim()
      const terminal = TERMINALS.find(t => t.test(env))
      const name = sessionNameOf(options, pr)
      const vars = { dir, prompt, shellPrompt: quote(prompt), label: `#${pr.number} ${pr.repo}`, url: pr.url, branch: pr.head, repo: pr.fullName, name }
      // {claude} goes in unquoted: the name is limited to safe characters, so it survives any shell or AppleScript layer
      const template = (custom || (terminal?.command ?? '')).replaceAll('{claude}', name ? `claude -n ${name}` : 'claude')
      const result = await run($, template, vars)
      const where = custom ? 'a new session' : terminal?.name
      $.ui.toast(result.exitCode === 0 ? `Opened #${pr.number} in ${where}` : short(result.stderr.trim() || `new session command exited ${result.exitCode}`, 200))
    }
    // session state may still hold the removed 'project' value, treat anything else as status
    const folded = new Set(await read($, collapsed))
    const grouping: GroupBy =(await read($, groupBy)) === 'none' ? 'none' : 'status'
    // a stack groups as its bottom PR, so stacks never split
    const groupOf = (stack: Stack): string => {
      const bottom = stack.prs[0]
      if (!bottom || grouping === 'none') return ''
      return statusOf(bottom, 0)
    }
    // fold levels, each adding to the one below: 1 cards, 2 status groups and stacks, 3 repos and Your move
    const startFolded = options.startCollapsed === true
    const cardIds = prs.map(pr => `pr:${pr.url}`)
    const sectionIds = [
      ...new Set([
        ...(pinMoves && grouping === 'status' ? moves.map(m => `status:move:${repoKey(m.pr)}:${statusOf(m.pr, m.i)}`) : []),
        ...sections.filter(s => groupOf(s)).map(s => `status:repo:${sectionRepo(s)}:${groupOf(s)}`),
        ...sections.filter(s => s.prs.length > 1).map(s => `stack:${s.prs[0]?.url}`),
      ]),
    ]
    const topIds = [...repos, ...(pinMoves ? [YOUR_MOVE] : [])]
    const levelSize = [0, cardIds.length, sectionIds.length, topIds.length]
    // the level comes from what is folded now, so a hand-folded repo counts as level 3
    const foldLevel = (() => {
      if (topIds.some(id => folded.has(id))) return 3
      if (sectionIds.some(id => folded.has(id))) return 2
      return cardIds.some(id => folded.has(id) !== startFolded) ? 1 : 0
    })()
    // the list holds PRs toggled away from the startCollapsed default
    const foldTo = (level: number) =>
      update($, collapsed, () => [
        ...cardIds.filter(() => (level >= 1) !== startFolded),
        ...(level >= 2 ? sectionIds : []),
        ...(level >= 3 ? topIds : []),
      ])
    // a level with nothing to fold is skipped, or the press would change nothing; past the last level it wraps to all open
    const collapseTo = [1, 2, 3].find(n => n > foldLevel && levelSize[n]) ?? 0
    const statusHeader = (statusId: string, status: string, count: number) => (
      <Button key={statusId} plain onPress={() => fold(statusId)}>
        <Text bold color={colorOfStatus(status)}>
          {folded.has(statusId) ? '▸' : '▾'} {status} <Text dimColor>{count}</Text>
        </Text>
      </Button>
    )
    // place: 'move' when drawn in Your move, since the same PR can also sit in its repo section
    const card = (pr: Pr, i: number, isStack: boolean, place = '') => {
      const action = nextAction(pr, i === 0, statePrompts)
      const work = workAction(pr, action, options.showCopilotPass !== false, str(options.workPrompt), statePrompts)
      const ci = ciLine(pr)
      const review = reviewLine(pr)
      const { color: statusColor, status, needsMe, isManual } = statusFor(pr, i)
      const color = cardColor(pr, repoKey(pr), statusColor, needsMe)
      const isDim = isAttention && !needsMe
      const hasBar = isAttention && needsMe
      const foldKey = `pr:${pr.url}`
      // the same PR can be drawn twice (Your move and its repo), so button keys carry the place
      const key = (name: string) => `${name}:${place}${pr.url}`
      const ticketLink = pr.ticket ? ticketUrl(options, pr.ticket) : undefined
      const isPrFolded = folded.has(foldKey) !== startFolded
      const titleRow = (
        <Box justifyContent="space-between">
          <Box flexShrink={1}>
            <Button key={key('fold')} plain label={isPrFolded ? '▸' : '▾'} onPress={() => fold(foldKey)} />
            <Text> </Text>
            {isStack && <Text color={color}>{i === 0 ? '◆ ' : '◇ '}</Text>}
            <Button key={key('pr')} plain label={`#${pr.number}`} onPress={() => open(pr.url)} />
            <Text bold dimColor={isDim} color={color} wrap="truncate-end">
              {' '}
              {short(pr.title, titleRoom)}
            </Text>
          </Box>
          <Box flexShrink={0} marginLeft={1}>
            {isManual && <Text dimColor>✎ </Text>}
            <Text color={statusColor}>{status}</Text>
          </Box>
        </Box>
      )

      // the bar is an absolute Box pinned top and bottom, so it spans the card height whatever it holds; a long column of ┃ is clipped to it
      const bar = hasBar && (
        <Box position="absolute" top={0} bottom={0} left={0} width={1} overflow="hidden">
          {/* grouped by status, the headers say the status, so the bar carries the repo; ungrouped, it carries the status */}
          <Text color={grouping === 'status' ? repoColor(repoKey(pr)) : statusColor}>{'┃\n'.repeat(60)}</Text>
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
          {options.showSummary !== false && pr.summary && <Text dimColor wrap="wrap">{summaryOf(pr.summary, Number(options.summaryLength) || 150)}</Text>}
          <Box flexWrap="wrap" columnGap={1}>
            <Button key={key('copy-url')} label={label('⧉ copy link')} onPress={press => void $.ui.copy({ text: pr.url, surface: press.surface })} />
            <Button key={key('browser')} label={label('↗ open')} onPress={() => open(pr.url)} />
            <Button key={key('copy-num')} label={label(`# copy ${pr.number}`)} onPress={press => void $.ui.copy({ text: String(pr.number), surface: press.surface })} />
            <Button key={key('move')} label={label(`⇄ move: ${nextMove(manual[pr.url])?.slice(2) ?? 'auto'}`)} onPress={() => void saveOverride($, pr.url, nextMove(manual[pr.url]))} />
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
            {/* next action keeps its text in every buttonStyle, an arrow alone says nothing */}
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
                  submit(plain(str(options.fablePrompt).trim() || DEFAULT_FABLE_PROMPT, prVars(pr)))
                }
              />
            )}
            <Button key={key('work')} label={label(work.label)} onPress={() => work.prompt && submit(work.prompt)} />
            <Button key={key('switch')} label={label('⎇ Switch here')} onPress={() => void switchHere(pr)} />
            <Button key={key('new-session')} label={label('⧉ New session')} onPress={() => void newSession(pr, workAction(pr, action, false, str(options.workPrompt), statePrompts).prompt ?? '')} />
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {/* the header is a filled Box, so the strip spans the pane whatever its width; the empty row after it comes from the next block's marginTop */}
        <Box flexDirection="column" backgroundColor="userMessageBackground" marginTop={1}>
          <Box justifyContent="center">
            <Text wrap="truncate-end">
              <Text bold color="claude">
                PULL REQUESTS
              </Text>
              <Text bold> · {isAll ? 'ALL REPOS' : snap.project?.toUpperCase()} · {prs.length} OPEN · </Text>
              <Text bold color="warning">{moves.length} NEED YOU</Text>
              <Text dimColor> · updated {new Date(snap.updatedAt).toTimeString().slice(0, 5)}</Text>
            </Text>
          </Box>
          <Box justifyContent="center" flexWrap="wrap" columnGap={1}>
            {snap.project && <Button key="scope" label={label(isAll ? '◧ This repo' : '◨ All')} onPress={toggle} />}
            <Button key="group" label={label(`⊞ ${grouping}`)} onPress={() => update($, groupBy, () => (grouping === 'none' ? 'status' : 'none'))} />
            <Button
              key="colors"
              label={label(`◐ ${cardMode}`)}
              onPress={async () => {
                const next = cardModes[(cardModes.indexOf(cardMode) + 1) % cardModes.length] ?? 'attention'
                const { deny } = await $.config.set({ key: `${$.plugin.name}.cardColors`, value: next })
                if (deny) $.ui.toast(deny)
              }}
            />
            <Button key="collapse" label={label(`⊖ collapse ${foldLevel}/3`)} onPress={() => foldTo(collapseTo)} />
            <Button key="refresh" label={label('↻ Refresh')} onPress={() => refresh($, options)} />
            <Button key="config" label={label('⚙ Config')} onPress={() => update($, view, () => 'config')} />
          </Box>
        </Box>
        {!snap.project && <Text dimColor>no repo remote in this folder, showing all repos</Text>}
        {snap.error && <Text color="error">fetch failed: {short(snap.error, 200)}</Text>}
        {promptsError && <Text color="error">prompts file: {short(promptsError, 200)}</Text>}
        {prs.length === 0 && (
          <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1} marginTop={1}>
            <Text dimColor>{isAll ? 'No open PRs of yours.' : `No open PRs of yours in ${snap.project}.`}</Text>
            {!isAll && <Button key="show-all" label="Show all PRs" variant="primary" onPress={toggle} />}
          </Box>
        )}
        {pinMoves && (
          <Box flexDirection="column" marginTop={1}>
            <Button key={YOUR_MOVE} plain onPress={() => fold(YOUR_MOVE)}>
              <Text color="warning">{folded.has(YOUR_MOVE) ? '▸' : '▾'} </Text>
              <Text bold color="inverseText" backgroundColor="warning"> ● YOUR MOVE </Text>{' '}
              <Text dimColor>{moves.length}</Text>
            </Button>
            {!folded.has(YOUR_MOVE) &&
              [...new Set(moves.map(m => repoKey(m.pr)))].map(repo => {
                const mine = moves.filter(m => repoKey(m.pr) === repo)
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
                          {key && statusHeader(statusId, key, mine.filter(m => statusOf(m.pr, m.i) === key).length)}
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
              <Button key={`repo:${repo}`} plain onPress={() => fold(repo)}>
                <Text bold size="title" color="inverseText" backgroundColor={repoColor(repo)}>
                  {' '}
                  {folded.has(repo) ? '▸' : '▾'} {repo.toUpperCase()}{' '}
                </Text>{' '}
                <Text dimColor>{sections.filter(s => sectionRepo(s) === repo).reduce((n, s) => n + s.prs.length, 0)}</Text>
              </Button>
              <Text>  </Text>
              <Button
                key={`ignore:${repo}`}
                plain
                dimColor
                label="⊘ ignore"
                onPress={() => {
                  const name = snap.prs.find(pr => repoKey(pr) === repo)?.fullName ?? repo
                  void saveIgnored($, list => (list.includes(name) ? list : [...list, name]))
                }}
              />
            </Box>
            {/* viewport is the whole screen, not the pane: draw a long rule and clip it to one row of the pane's width */}
            <Box width="100%" height={1} overflow="hidden">
              <Text color={repoColor(repo)}>{'━'.repeat(500)}</Text>
            </Box>
            {[...new Set(sections.filter(s => sectionRepo(s) === repo && !folded.has(repo)).map(groupOf))]
              .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
              .map(key => {
                const group = sections.filter(s => sectionRepo(s) === repo && groupOf(s) === key)
                // status ids are prefixed so they never clash with repo names, stack: or pr: keys
                const statusId = `status:repo:${repo}:${key}`
                const isGroupFolded = key !== '' && folded.has(statusId)
                return (
                  <Box key={`${repo}:${key}`} flexDirection="column" marginTop={1}>
                    {key && statusHeader(statusId, key, group.reduce((n, s) => n + s.prs.length, 0))}
                    {!isGroupFolded && group.map(stack => {
                      const isStack = stack.prs.length > 1
                      // collapsed keys share one list with repos; stack keys are prefixed so they never clash
                      const stackId = `stack:${stack.prs[0]?.url}`
                      const isFolded = isStack && folded.has(stackId)
                      const top = stack.prs.at(-1)
                      return (
                        <Box key={stackId} flexDirection="column">
                          {isStack && (
                            <Button key={`stack:${stackId}`} plain onPress={() => fold(stackId)}>
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
                    onPress={() => void saveIgnored($, list => list.filter(x => x !== name))}
                  />
                </Box>
              ))}
          </Box>
        )}
      </Box>
    )
  })
}
