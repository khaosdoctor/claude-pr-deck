# External integrations

pr-deck keeps a JSON file with every PR it picked up and the state each one is in. It exists so other tools can react to your PRs without asking the code hosts again: a status bar counting what needs you, a script that pings you when a PR goes green, a notifier, a dashboard. Watch the file and act when it changes.

## State file

The path is the ***State file*** option in `/config`, `~/.cache/pr-deck/state.json` by default. A leading `~` is your home folder, the folder is created when missing, and an empty value turns the file off.

The file is rewritten on every refresh: when a session starts, on the ***Refresh every*** timer, and when you press ***↻ Refresh***. Every open session with pr-deck loaded refreshes on its own, so with several sessions open the file updates more often, and the last one to refresh wins. Nothing writes it while no session is running.

It holds every PR, including repos you ignore and repos outside the session's current project, so a watcher sees the same list in every session. PRs are grouped by `owner/repo` (on GitLab the full group path, on Azure DevOps `org/project/repo`).

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
        "nextAction": "Fix CI"
      }
    ]
  }
}
```

| Field | Value |
| --- | --- |
| `updatedAt` | when the refresh finished, in ISO 8601 |
| `error` | only when a host failed to load, with the reason |
| `state` | one of the ids in [Prompts per state](../README.md#prompts-per-state), like `ci-failed` or `in-review` |
| `status` | the status the card shows, without its symbol: `broken`, `conflicts`, `needs you`, `waiting` or `approved` |
| `needsYou` | `true` for the PRs counted in ***NEED YOU*** |
| `nextAction` | the label of the card's next-action button |
| `override` | only on a PR whose status you set with ***⇄ move***, the status you picked |
| `ci` | `SUCCESS`, `FAILURE`, `PENDING` or `NONE` |
| `review` | `APPROVED`, `CHANGES_REQUESTED`, `REVIEW_REQUIRED` or `NONE` |
| `mergeable` | `MERGEABLE`, `CONFLICTING` or `UNKNOWN` |
| `unresolved` | open review threads |

A PR stacked on another one lists the bottom of the stack first. A host that cannot report CI or review state (Gitea, for one) leaves them at `NONE`.

## Watching the file

The file is written in place, so a reader can catch it halfway through a write. Treat a parse error as "try again in a moment" and keep the last good copy.

Count the PRs that need you, for a status bar:

```sh
jq '[.repos[][] | select(.needsYou)] | length' ~/.cache/pr-deck/state.json
```

Run a command every time the file changes, with [entr](https://github.com/eradman/entr):

```sh
echo ~/.cache/pr-deck/state.json | entr -n sh -c 'jq -r ".repos[][] | select(.needsYou) | .url" ~/.cache/pr-deck/state.json'
```

Or with [fswatch](https://github.com/emcrisostomo/fswatch) on macOS:

```sh
fswatch -o ~/.cache/pr-deck/state.json | while read -r _; do
  jq -r '.repos[][] | select(.ci == "SUCCESS" and .review == "APPROVED") | "\(.url) is ready to merge"' ~/.cache/pr-deck/state.json
done
```

To act only on changes, keep the previous copy and compare by `url`, for example to notify when a PR's `state` goes from `ci-running` to anything else.

## Watch button

***◉ watch*** on a card works from inside Claude instead: it asks the current session to keep checking that PR's CI and reviews, tell you about each change in one line, and stop once CI passes and nothing else needs you. Its prompt is the ***Watch prompt*** option, and the prompts file can give each state its own `watch` prompt, see [Prompts per state](../README.md#prompts-per-state).
