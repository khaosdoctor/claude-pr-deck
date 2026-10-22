import { expect, test } from 'claude-code/testing'

const CONFIG = '/home/me/.config/pr-deck.json'
const URL = 'https://github.com/Acme/Api/pull/7'
const GH = JSON.stringify({
  data: { viewer: { pullRequests: { nodes: [{
    number: 7, title: 'add thing', bodyText: '', url: URL,
    isDraft: false, headRefName: 'feat/x', baseRefName: 'main', reviewDecision: null, mergeable: 'MERGEABLE',
    changedFiles: 1, additions: 1, deletions: 0,
    repository: { name: 'Api', nameWithOwner: 'Acme/Api', viewerPermission: 'WRITE', defaultBranchRef: { name: 'main' } },
    reviewRequests: { totalCount: 0, nodes: [] }, reviews: { nodes: [] }, reviewThreads: { nodes: [] }, commits: { nodes: [] },
  }] } } },
})

test('a save keeps an edit made to the config file after the last refresh', async ($, on) => {
  const files: Record<string, string> = { [CONFIG]: '{ "ignored": [], "overrides": {} }' }
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
  on('fs.exists', (_, e) => ({ value: e.path in files }))
  on('fs.read', (_, e) => ({ value: files[e.path] ?? '' }))
  on('fs.write', (_, e) => {
    files[e.path] = e.text
    return { value: undefined }
  })
  // the gh fetch answers; the git remote lookup fails, so the pane shows every repo
  on('process.run', (_, e) => ({ value: e.argv.join(' ').includes('graphql') ? { exitCode: 0, stdout: GH, stderr: '' } : { exitCode: 1, stdout: '', stderr: '' } }))
  on('clock.now', () => ({ value: 0 }))
  on('prompt.submit', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))

  // watching a PR the session has not fetched yet waits for a refresh
  await $.command.run({ command: 'prs', args: `watch ${URL}` })
  // another session, or the person by hand, ignores a repo after that refresh
  files[CONFIG] = '{ "ignored": ["other/repo"], "overrides": {} }'

  const ui = await $.ui.mount({
    plugin: 'pr-deck',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'pr-deck',
    props: { title: 'Pull requests', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
  })
  // the PR needs a review request, so its card is in Your move, whose keys carry "move:"
  await ui.press({ key: `move:move:${URL}` })
  await ui.unmount()

  expect(JSON.parse(files[CONFIG] ?? '')).toEqual({ ignored: ['other/repo'], overrides: { [URL]: '○ waiting' } })
})
