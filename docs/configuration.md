# Configuration

[Back to README](../README.md)

- [Options](#options)
- [Templates](#templates)
- [Config screen](#config-screen)
- [Config file](#config-file)

## Options

Set them in `/config` under pr-deck. Each has a description there. Prompt options are in [Prompts](prompts.md).

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
| Code hosts | comma-separated: `github`, `gitlab`, `gitea`, `azdo` | `github` |
| Issue tracker | `jira`, `linear`, `none` | `jira` |
| Issue tracker URL | URL | empty |
| GitHub, GitLab, Gitea/Forgejo and Azure DevOps fetch commands | shell template | empty |
| Open URL command | shell template | `open {url}` |
| Open config file command | shell template | `open -t {path}` |
| Current repo command | shell template | `git remote get-url origin` |
| Local clone folder | path template | empty |
| New session command | shell template | empty |
| Auto rename sessions | on, off | on |
| State file | path | `~/.cache/pr-deck/state.json` |

- **Issue tracker URL** is the base the ticket key is appended to. `https://yourcompany.atlassian.net` gives `https://yourcompany.atlassian.net/browse/ABC-123`, and a URL that already has `/browse` is used as is. For Linear, use `https://linear.app/yourteam/issue/`.
- Gitea, Forgejo and Azure DevOps do not report CI state or unresolved threads, so those cards show none.
- Azure DevOps also has no diff stats, and lists the project `az` detects from the git remote or from `az devops configure`.
- **Local clone folder** and **New session command**: [Sessions](sessions.md).
- **Auto rename sessions**: [Session name](prompts.md#session-name).
- **State file**: [External integrations](integrations.md#state-file).

## Templates

Commands are shell templates run with `sh -c`.

| Option | Placeholders |
| --- | --- |
| Open URL command | `{url}` |
| Open config file command | `{path}` |
| Fetch commands | `{query}` (GitHub and GitLab: the GraphQL query) |
| Local clone folder | `{host}`, `{owner}`, `{repo}` |
| New session command | see [Sessions](sessions.md#new-session-command) |

- Placeholders in braces get the value wrapped in single quotes, so do not add your own quotes. **Local clone folder** is the exception, its placeholders are plain text.
- An empty fetch command uses the built-in call: `gh api graphql`, `glab api graphql`, `tea api` with `jq`, `az repos pr list`. A custom one has to print what the built-in call prints.
- The default commands are macOS ones, so change them on another system.

## Config screen

![The config screen](config.jpg)

***⚙ Config*** in the pane shows the options with toggles and one button per value.

- ***✎ Open file*** opens `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`), where the options are stored.
- ***✎ open ignored list*** opens the config file.

## Config file

```json
{
  "ignored": ["owner/repo"],
  "overrides": { "https://github.com/owner/repo/pull/12": "✓ approved" }
}
```

`~/.config/pr-deck.json` holds the ignored repos and the status overrides.

- `overrides` maps a PR URL to `○ waiting`, `● needs you` or `✓ approved`.
- Entries for PRs that are no longer open are dropped on save.
- Edits apply on the next refresh.
