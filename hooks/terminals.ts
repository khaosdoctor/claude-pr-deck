import { quote } from './run'

// Where the session itself runs, read from its environment by register.tsx.
export type TerminalEnv = { program?: string; bundleId?: string; tmux?: string; zellij?: string; kittyWindow?: string; alacrittyWindow?: string }
type Terminal = { name: string; test: (env: TerminalEnv) => boolean; command: string }

// Shell templates for opening a new Claude session, filled by run().
// {claude} is replaced before fill with `claude` or `claude -n <session name>`.
// {dir} {prompt} {label} are single-quoted by fill; {shellPrompt} is already quoted for the
// terminal's own shell, so it comes out quoted twice and survives being typed into a pane.
const osascript = (...lines: string[]) => `osascript ${['on run argv', ...lines, 'end run'].map(line => `-e ${quote(line)}`).join(' ')} {dir} {prompt}`

// Multiplexers come before terminal apps, first match wins; the last entry matches anything.
export const TERMINALS: Terminal[] = [
  // waits for the first shell prompt, then a second, because typing during shell startup garbles the command; needs jq
  {
    name: 'a herdr tab',
    test: env => env.program === 'herdr',
    command:
      "pane=$(herdr tab create --cwd {dir} --label {label} --focus | jq -r .result.root_pane.pane_id) && { herdr pane wait-output \"$pane\" --regex '[❯$%#>]\\s*$' --timeout 10000 >/dev/null; sleep 1; herdr pane run \"$pane\" {claude} {shellPrompt}; }",
  },
  { name: 'a tmux window', test: env => Boolean(env.tmux), command: 'tmux new-window -c {dir} -n {label} {claude} {prompt}' },
  { name: 'a zellij tab', test: env => Boolean(env.zellij), command: 'zellij action new-tab --cwd {dir} --name {label} -- {claude} {prompt}' },
  { name: 'a WezTerm tab', test: env => env.program === 'WezTerm', command: 'wezterm cli spawn --cwd {dir} -- {claude} {prompt}' },
  // kitty needs allow_remote_control (or listen_on) in kitty.conf; without it the toast shows kitty's error
  { name: 'a kitty tab', test: env => Boolean(env.kittyWindow), command: 'kitty @ launch --type=tab --cwd={dir} --tab-title={label} {claude} {prompt}' },
  // Alacritty has no tabs, so a new window through its IPC socket
  {
    name: 'an Alacritty window',
    test: env => Boolean(env.alacrittyWindow),
    command: 'alacritty msg create-window --working-directory {dir} -e {claude} {prompt}',
  },
  // always a new Rio instance, like Ghostty; flags written from Rio's docs
  // the prompt travels in an environment variable: the login shell is the user's own, and fish gives -c arguments to $argv with no $0
  {
    name: 'Rio',
    test: env => env.program === 'rio',
    command: 'open -na Rio --env PR_DECK_PROMPT={prompt} --args --working-dir {dir} -e "${SHELL:-/bin/sh}" -lic \'exec {claude} "$PR_DECK_PROMPT"\'',
  },
  // always a new Ghostty instance, since the macOS CLI cannot add a window to a running one; a login shell finds claude on PATH
  {
    name: 'Ghostty',
    test: env => env.bundleId === 'com.mitchellh.ghostty' || env.program === 'ghostty',
    command: 'open -na Ghostty --env PR_DECK_PROMPT={prompt} --args --working-directory={dir} -e "${SHELL:-/bin/sh}" -lic \'exec {claude} "$PR_DECK_PROMPT"\'',
  },
  {
    name: 'iTerm',
    test: env => env.program === 'iTerm.app',
    command: osascript(
      'tell application "iTerm"',
      'activate',
      'set w to (create window with default profile)',
      'tell current session of w to write text "cd " & quoted form of item 1 of argv & " && {claude} " & quoted form of item 2 of argv',
      'end tell',
    ),
  },
  {
    name: 'Terminal',
    test: () => true,
    command: osascript(
      'tell application "Terminal"',
      'activate',
      'do script "cd " & quoted form of item 1 of argv & " && {claude} " & quoted form of item 2 of argv',
      'end tell',
    ),
  },
]
