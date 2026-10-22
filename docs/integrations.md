# External integrations

[Back to README](../README.md)

pr-deck keeps a JSON file with its PRs and their states, so a status bar, script or dashboard can react without asking the code hosts again.

- [State file](#state-file)
- [Watching the file](#watching-the-file)
- [Common use cases](#common-use-cases)

## State file

```json
{
  "updatedAt": "2026-10-21T09:30:00.000Z",
  "repos": {
    "acme/api": [
      {
        "number": 7,
        "title": "ABC-12 add thing",
        "url": "https://github.com/acme/api/pull/7",
        "branch": "feat/x",
        "base": "main",
        "provider": "github",
        "host": "github.com",
        "draft": false,
        "ci": "FAILURE",
        "review": "REVIEW_REQUIRED",
        "mergeable": "MERGEABLE",
        "unresolved": 0,
        "state": "ci-failed",
        "status": "broken",
        "needsYou": true,
        "nextAction": "Fix CI",
        "ignored": false
      }
    ]
  }
}
```

The path is the **State file** option, `~/.cache/pr-deck/state.json` by default.

- A leading `~` is your home folder, and the folder is created when missing.
- `off` turns the file off. An empty value uses the default.
- PRs are grouped by `owner/repo`: the full group path on GitLab, `org/project/repo` on Azure DevOps.
- PRs of ignored repos and of repos outside the session's project are listed too.
- A PR stacked on another one lists the bottom of the stack first.

| Field | Value |
| --- | --- |
| `updatedAt` | when the refresh finished, in ISO 8601 |
| `error` | only when a host failed to load, with the reason |
| `state` | one of the ids in [Prompts per state](prompts.md#prompts-per-state), like `ci-failed` or `in-review` |
| `status` | the status the card shows, without its symbol: `broken`, `conflicts`, `needs you`, `waiting` or `approved` |
| `needsYou` | `true` when the PR needs you. Pair it with `ignored` to match the pane's ***NEED YOU*** count |
| `nextAction` | the label of the card's next-action button |
| `ignored` | `true` for a PR in a repo on your ignored list |
| `override` | only on a PR whose status you set with ***⇄ move***: the status you picked |
| `ci` | `SUCCESS`, `FAILURE`, `ERROR`, `PENDING`, `EXPECTED` or `NONE`. `ERROR` counts as failed and `EXPECTED` as running |
| `review` | `APPROVED`, `CHANGES_REQUESTED`, `REVIEW_REQUIRED` or `NONE` |
| `mergeable` | `MERGEABLE`, `CONFLICTING` or `UNKNOWN` |
| `unresolved` | open review threads |

Writes:

- The file is rewritten on every refresh, and only a refresh writes it. A status set with ***⇄ move*** reaches it on the next one.
- With several sessions open, the last one to refresh wins.
- A refresh where every host failed and the session knows no PRs yet leaves the file alone.
- A host that failed to load keeps its last PRs.
- A host that cannot report CI or review state (Gitea, for one) leaves them at `NONE`.

## Watching the file

The file is written in place, so a parse error means a write is in progress. Retry and keep the last good copy.

With [entr](https://github.com/eradman/entr):

```sh
echo ~/.cache/pr-deck/state.json | entr -n sh ~/bin/pr-deck-notify.sh
```

With [fswatch](https://github.com/emcrisostomo/fswatch) on macOS:

```sh
fswatch -o ~/.cache/pr-deck/state.json | while read -r _; do sh ~/bin/pr-deck-notify.sh; done
```

`pr-deck-notify.sh` is in [Notify on a state change](#notify-on-a-state-change).

## Common use cases

### Count in the tmux status bar

```sh
set -g status-right '#(jq "[.repos[][] | select(.needsYou and (.ignored | not))] | length" ~/.cache/pr-deck/state.json)'
```

Counts PRs that need you and skips ignored repos, like the pane's ***NEED YOU*** count.

### List PRs ready to merge

```sh
jq -r '.repos[][] | select(.state == "mergeable") | .url' ~/.cache/pr-deck/state.json
```

### Notify on a state change

```sh
f=~/.cache/pr-deck/state.json
prev=~/.cache/pr-deck/state.prev.json
[ -f "$prev" ] || cp "$f" "$prev"
jq -rn --slurpfile old "$prev" --slurpfile new "$f" '
  ($old[0].repos | [.[][]] | map({(.url): .state}) | add // {}) as $was
  | $new[0].repos[][]
  | select($was[.url] == "ci-running" and .state != "ci-running")
  | "\(.url) is now \(.state)"' | while read -r msg; do
  osascript -e "display notification \"$msg\" with title \"pr-deck\""
  # Linux: notify-send pr-deck "$msg"
done
cp "$f" "$prev"
```

Keeps the previous copy, compares by `url` and notifies when a PR leaves `ci-running`.

### Warn before pushing a failing branch

```sh
jq -r --arg b "$(git branch --show-current)" \
  '.repos[][] | select(.branch == $b and .state == "ci-failed") | "CI is failing on \(.url)"' \
  ~/.cache/pr-deck/state.json
```

Put it in `.git/hooks/pre-push` to match the current branch to its PR.
