# pr-deck

A Claude Code mod that lists your open pull requests in a side pane. PRs are grouped by repository, and stacked PRs (a PR whose base is another of your PR branches) are drawn as a chain.

Each PR is a card coloured by its state, with three buttons:

- **Next action**: fix CI, rebase, address comments, request a review, mark ready or merge. Pressing it sends the matching prompt to the session.
- **Fable review**: asks the session to run a review subagent and report back without posting to GitHub.
- **Work on it**: loads the PR into the session. Once the PR is green, idle and has no unresolved threads, it becomes **Copilot pass**, which requests a Copilot review and works through its comments.

The pane scopes to the repository the session runs in, with a toggle for all repositories. Repos and stacks collapse, and repos can be ignored.

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

## Requirements

- [`gh`](https://cli.github.com) signed in with `gh auth login`
- macOS, for the `open` command used by links and the config button

## Usage

Run `/prs` to open the pane. It refreshes every 2 minutes and on ***↻ Refresh***.

## Config

***⚙ Config*** opens `~/.config/pr-deck.json`:

```json
{
  "ignored": ["owner/repo"],
  "jiraBaseUrl": "https://yourcompany.atlassian.net/browse/"
}
```

- `ignored`: repositories hidden from the list and shown under ***Ignored*** at the bottom of the pane.
- `jiraBaseUrl`: when set, Jira keys found in a PR title or branch become links. When empty, the key shows as text.
