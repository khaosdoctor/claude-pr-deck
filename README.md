# pr-deck

A Claude Code mod that lists your open pull requests in a side pane. PRs are grouped by repository, and stacked PRs (a PR whose base is another of your PR branches) are drawn as a chain. It reads PRs from GitHub, GitLab, Gitea/Forgejo and Azure DevOps.

![pr-deck pane listing PRs from three repos, with YOUR MOVE grouped by repo](docs/pane-all.jpg)

Each card shows the PR number, title and state, a one-line summary taken from the PR body, and buttons to copy the link, open it in the browser or copy the PR number. The arrow before the number folds the card down to its title line.

![Folded cards and a folded stack](docs/folded.jpg)

Scoped to the session's repo, the pane shows that repo alone, with a stack of three PRs:

![pr-deck pane scoped to one repo, with a stack of three PRs](docs/pane.jpg)

Below the CI, review and diff stats come the ticket key, which links to the tracker, and the branch name, which opens the PR's files tab. Each card ends with an action row:

- ***→ Next action***: fix CI, rebase, address comments, request a review, mark ready or merge. Pressing it sends the matching prompt to the session.
- ***✦ Fable review***: asks the session to run a review subagent and report back without posting to the code host.
- ***❯ Work on it***: loads the PR into the session. On GitHub, once the PR is green, idle, has no unresolved threads and no Copilot review yet, it becomes ***✦ Copilot pass***, which requests a Copilot review and works through its comments.
- ***⎇ Switch here***: asks the current session to move to the PR's repo and branch. If the current folder is not a clone of that repo, the session finds the local clone or clones it, checks out the branch, summarizes the PR and waits for instructions.
- ***⧉ New session***: runs the new session command in the PR's clone folder with the same prompt as ***Work on it***, so the new session starts with the PR loaded. It opens where you work, using the first match in the detection order under Commands, and comes to the front. A toast names where it opened, for example "Opened #3109 in a herdr tab", or shows the error the command printed.

The pane scopes to the repository the session runs in, with a toggle for all repositories. Repos and stacks collapse, and repos can be ignored.

### Your move and card colours

With the default `attention` card colours, a PR needs you when its next action is something you can do now: mark ready, fix CI, rebase, address comments, request a review or merge. Those cards get a border in their status colour and a bar on the left. When grouped by status, the bar takes the repo's colour, the same one as the repo badge; with grouping off, it takes the status colour. Cards that only wait on CI, a reviewer or another PR get a muted border and dimmed text. The status label in the top-right corner keeps its own colour.

When `Pin "Your move" on top` is on, every PR that needs you is also listed in a ***● YOUR MOVE*** group above the repos. Inside it, PRs are grouped by repo under a coloured repo badge, the repo with the most urgent PR first, and by status when the grouping button is on `status`. Click the group title to collapse it.

A stack where every PR needs you moves to ***YOUR MOVE*** entirely. A stack where only some PRs need you stays whole in its repo, and the PRs that need you also appear in ***YOUR MOVE***.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install pr-deck --marketplace khaosdoctor/claude-pr-list-mod
```

Answer `y` to add the marketplace, then pick a scope.

From a shell:

```bash
claude plugin install pr-deck --marketplace khaosdoctor/claude-pr-list-mod
```

In the desktop app, click + next to the prompt box, then ***Plugins -> Add marketplace*** with `khaosdoctor/claude-pr-list-mod`, then ***Add plugin***.

### Install from a local clone

Point the marketplace at the clone, then install from it:

```bash
claude plugin marketplace add <path to clone>
claude plugin install pr-deck@claude-pr-list-mod
```

After you pull changes, refresh the marketplace and update the plugin, then restart Claude Code to apply them:

```bash
claude plugin marketplace update claude-pr-list-mod
claude plugin update pr-deck@claude-pr-list-mod
```

For development, `claude --plugin-dir <path to clone>` loads the mod for that session only and reloads it when you edit the files.

## Requirements

The CLI of each code host you enable, signed in:

| Host | CLI | Sign in |
| --- | --- | --- |
| GitHub | [`gh`](https://cli.github.com) | `gh auth login` |
| GitLab | [`glab`](https://gitlab.com/gitlab-org/cli) | `glab auth login` |
| Gitea, Forgejo | [`tea`](https://gitea.com/gitea/tea) and `jq` | `tea login add` |
| Azure DevOps | [`az`](https://learn.microsoft.com/cli/azure) with the `azure-devops` extension | `az login`, then `az extension add --name azure-devops` |

The defaults for opening links and the config file use macOS `open`, the current repo command uses `git`, and new sessions pick a terminal automatically (see Commands), which uses `osascript` for iTerm and Terminal and needs `jq` for herdr. On another system, change the commands under Options.

Gitea, Forgejo and Azure DevOps do not expose CI state or unresolved threads through the calls the mod makes, so their cards show no CI and zero unresolved threads. Azure DevOps cards also show no diff stats. Azure DevOps lists the PRs of the project `az` detects from the git remote or from `az devops configure`.

## Usage

Run `/prs` to open the pane. It refreshes on the configured interval (every 2 minutes by default) and on ***↻ Refresh***.

## Options

Set these in `/config` under pr-deck.

### Display

| Option | Values | Default |
| --- | --- | --- |
| Open on start | on, off | off |
| Start collapsed | on, off | off |
| Always show all projects | on, off | off |
| Card colors | `attention`, `status`, `repo`, `random` | `attention` |
| Pin "Your move" on top | on, off | on |
| Button labels | `both`, `icons`, `text` | `both` |
| Default grouping | `status`, `none` | `status` |
| Refresh every (minutes) | `1`, `2`, `5`, `10`, `15`, `30` | `2` |
| Show summary | on, off | on |
| Summary length | `30`, `60`, `100`, `150`, `200`, `300` | `150` |
| Show Fable review button | on, off | on |
| Offer Copilot pass | on, off | on |

- **Open on start**: opens the pane when a session starts, without taking focus from the prompt. `/prs` opens it with focus.
- **Start collapsed**: cards open folded to their title line. The arrow before the number unfolds one.
- **Always show all projects**: start with PRs from every repo instead of only the repo of the session's folder. The scope button still toggles it.
- **Card colors**: `attention` is described under Your move and card colours. `status` colours the border by PR state, `repo` uses one colour per repository, and `random` gives each PR its own. The status label keeps its state colour in every mode. The colour button in the pane header cycles through the four modes and saves the choice.
- **Button labels**: the next-action button keeps its text in `icons` mode, since its arrow alone does not say which action it is.
- **Default grouping**: how PRs inside a repo are grouped when the pane opens. `status` groups by state, `none` lists them flat. The grouping button toggles it for the session.
- **Show summary**: the first sentence of the first prose line of the PR body, under each title. Headings, code fences, tables, link references and lines that hold only ticket keys are skipped. It wraps to the card width, and **Summary length** caps it in characters, ending with an ellipsis when cut.
- **Offer Copilot pass**: GitHub only. Turn it off to keep ***Work on it*** as the work button on green, idle PRs.

### Code hosts and trackers

| Option | Values | Default |
| --- | --- | --- |
| Code hosts | comma-separated: `github`, `gitlab`, `gitea`, `azdo` | `github` |
| Issue tracker | `jira`, `linear`, `none` | `jira` |
| Issue tracker URL | URL | empty |
| GitHub fetch command | shell template | empty |
| GitLab fetch command | shell template | empty |
| Gitea/Forgejo fetch command | shell template | empty |
| Azure DevOps fetch command | shell template | empty |

- **Code hosts**: the hosts to fetch from, for example `github,gitlab`. PRs from all of them show in one list, and a host that fails reports its error in the pane while the others still load. When every host fails, the last list stays on screen next to the error.
- **Issue tracker URL**: the base URL the ticket key, found in the PR title or branch name, is appended to. For Jira, `https://yourcompany.atlassian.net` becomes `https://yourcompany.atlassian.net/browse/ABC-123`, and a URL that already contains `/browse` is used as given. For Linear, use `https://linear.app/yourteam/issue/`. When empty, or when the tracker is `none`, the key shows as text.
- **Fetch commands**: empty uses the built-in call for that host (`gh api graphql`, `glab api graphql`, `tea api` with `jq`, `az repos pr list`). Set one to replace it, for example to use another account or a self-hosted instance. The command must print what the built-in call prints. `{query}` is the GraphQL query for GitHub and GitLab.

### Commands

| Option | Default |
| --- | --- |
| Open URL command | `open {url}` |
| Open config file command | `open -t {path}` |
| Current repo command | `git remote get-url origin` |
| Local clone folder | empty |
| New session command | empty, which picks a terminal automatically |
| Auto rename sessions | on |

Each command is a shell template run with `sh -c`. Placeholders in braces are replaced with the value wrapped in single quotes, so a URL or prompt with spaces or quotes is safe to pass as one argument. Do not add your own quotes around a placeholder.

| Option | Placeholders |
| --- | --- |
| Open URL command | `{url}` |
| Open config file command | `{path}` |
| Current repo command | none |
| New session command | `{claude}`, `{dir}`, `{prompt}`, `{label}`, `{url}`, `{branch}`, `{repo}`, `{name}` |
| Fetch commands | `{query}` (GitHub and GitLab) |

- **Current repo command**: prints the remote URL of the session's repo. The pane uses it to scope to that repo.
- **Local clone folder**: where a repo is cloned, for example `~/code/{host}/{owner}/{repo}`. `{host}`, `{owner}` and `{repo}` are filled in as plain text, and a leading `~` becomes your home folder. ***⧉ New session*** starts there, and ***⎇ Switch here*** tells the session to look there first. When empty, ***⧉ New session*** starts in the session's current folder and ***⎇ Switch here*** asks the session to look in nearby folders.
- **New session command**: when empty, the first row that matches the session's environment wins. Multiplexers come before terminal apps.

  | Order | Opens | Matches when |
  | --- | --- | --- |
  | 1 | herdr tab | `TERM_PROGRAM` is `herdr` |
  | 2 | tmux window | `TMUX` is set |
  | 3 | zellij tab | `ZELLIJ` is set |
  | 4 | WezTerm tab | `TERM_PROGRAM` is `WezTerm` |
  | 5 | kitty tab | `KITTY_WINDOW_ID` is set |
  | 6 | Alacritty window | `ALACRITTY_WINDOW_ID` is set |
  | 7 | Rio window | `TERM_PROGRAM` is `rio` |
  | 8 | Ghostty window | `TERM_PROGRAM` is `ghostty`, or the app is Ghostty |
  | 9 | iTerm window | `TERM_PROGRAM` is `iTerm.app` |
  | 10 | Terminal window | anything else |

  The herdr row needs `jq`. The kitty row needs `allow_remote_control yes` (or `listen_on`) in `kitty.conf`. Warp has no way to start a command in a new tab, so it falls through to Terminal; set your own command there. A non-empty command replaces all of this. In it, `{dir}` is the folder from above, `{prompt}` the first prompt, `{label}` the PR name such as `#3109 repo`, `{url}` the PR link, `{branch}` its head branch, `{repo}` the `owner/repo` name and `{name}` the session name. `{shellPrompt}` is the prompt already quoted for the terminal's own shell, for commands that type it into a pane, as the herdr row does.

### Prompts

| Option | Default |
| --- | --- |
| Session name | `pr-{pr}-worker` |
| Fable review prompt | `Spawn a subagent with model fable to review {url} against the repo's own standards. Report findings to me, do not post anything to {host}.` |
| Work on it prompt | `Load context for {url}: check out branch {branch} in the {repo} repo, read the PR description, diff, CI status and review comments ({cli} reads them), then wait for my instructions.` |

These three are templates. Placeholders in braces are filled in as plain text, not shell-quoted, and one that is not in the list below stays as written.

| Placeholder | Value |
| --- | --- |
| `{pr}`, `{number}` | PR number |
| `{url}` | PR link |
| `{title}` | PR title |
| `{branch}` | head branch |
| `{base}` | base branch |
| `{repo}` | repo name |
| `{fullName}` | `owner/repo` |
| `{host}` | code host name, such as `github.com` |
| `{cli}` | the host's command line tool, such as `gh` |

- **Session name**: ***⧉ New session*** starts `claude -n <name>`, and ***⎇ Switch here*** runs `/rename <name>` on the current session. Characters other than letters, digits, `.`, `_` and `-` become `-`. Turn ***Auto rename sessions*** off, or leave the name empty, to skip naming. In your own new session command, `{claude}` is `claude` with that name flag.
- **Fable review prompt**: sent by ***✦ Fable review***. An empty value uses the default.
- **Work on it prompt**: sent by ***❯ Work on it*** and used as the first prompt of ***⧉ New session***. An empty value uses the default. The ***✦ Copilot pass*** prompt is not configurable.

## Config screen

***⚙ Config*** swaps the pane for a screen with every option above: toggles for on/off options and one button per value for pickers, saved on press. Text options show their value with ***⚙ edit in /config*** and ***✎ edit in file*** links. ***← Back*** returns to the list.

![The config screen](docs/config.jpg)

 ***⚙ Open in Claude /config*** runs the built-in `/config` menu, ***✎ Open file*** opens `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`) with the open config file command, and ***✎ open ignored list*** opens the file below.

## Config file

`~/.config/pr-deck.json` holds the ignored repositories:

```json
{
  "ignored": ["owner/repo"]
}
```

- `ignored`: repositories hidden from the list and shown under ***Ignored*** at the bottom of the pane. ***⊘ ignore*** next to a repo name adds it, and ***↺ unignore*** removes it. Edits to the file apply on the next refresh.
