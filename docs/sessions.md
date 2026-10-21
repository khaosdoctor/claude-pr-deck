# Sessions

[Back to README](../README.md)

- [Local clone folder](#local-clone-folder)
- [Terminal detection](#terminal-detection)
- [New session command](#new-session-command)

***⎇ Switch here*** moves the current session to the PR's repo and branch. ***⧉ New session*** opens a new Claude session in the PR's clone folder with the ***Work on it*** prompt, and a toast says where it went or what failed. Both name the session as described in [Session name](prompts.md#session-name).

## Local clone folder

A path template like `~/code/{host}/{owner}/{repo}`, with a leading `~` as your home folder. ***New session*** starts there and ***Switch here*** tells the session to look there first. When empty, new sessions start in the current folder and ***Switch here*** has the session look around nearby folders, or clone the repo.

## Terminal detection

With an empty **New session command**, the terminal comes from the session's environment, in this order:

1. A herdr, tmux, zellij, WezTerm or kitty tab.
2. An Alacritty, Rio, Ghostty or iTerm window.
3. Terminal.

- herdr needs `jq`.
- kitty needs `allow_remote_control yes` (or `listen_on`) in `kitty.conf`.
- Warp cannot start a command in a new tab and ends up in Terminal. Set your own command.
- Rio and Ghostty start `$SHELL` and pass the prompt in a `PR_DECK_PROMPT` variable, which works in sh-style shells and fish. With nushell, set your own command.

## New session command

A non-empty command replaces detection. Put `--` between `{claude}` and `{prompt}`, as the built-in ones do, so a prompt that starts with a dash is not read as an option. Quoting works as in [Templates](configuration.md#templates).

| Placeholder | Value |
| --- | --- |
| `{claude}` | `claude`, with the session name flag |
| `{dir}` | the clone folder |
| `{prompt}` | the first prompt |
| `{shellPrompt}` | the prompt quoted for the terminal's own shell, for commands that type it into a pane like herdr does |
| `{label}` | the PR name, such as `#3109 repo` |
| `{url}` | the PR link |
| `{branch}` | its head branch |
| `{repo}` | the `owner/repo` name |
| `{name}` | the session name |
