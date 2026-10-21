# The pane

[Back to README](../README.md)

- [Cards](#cards)
- [Status override](#status-override)
- [Your move](#your-move)
- [Collapse](#collapse)
- [Watching a PR](#watching-a-pr)

## Cards

![pr-deck pane scoped to one repo, with a stack of three PRs](pane.jpg)

The buttons send the prompts from [Prompts](prompts.md). ***⎇ Switch here*** and ***⧉ New session*** are covered in [Sessions](sessions.md). On GitHub, ***❯ Work on it*** becomes ***✦ Copilot pass*** once a PR is green, only waiting on people, and Copilot has not been asked yet.

## Status override

***⇄ move*** cycles a PR through ***○ waiting***, ***● needs you***, ***✓ approved*** and back to ***auto***, for when the automatic status is wrong. Colour, group, ***● YOUR MOVE*** and the ***NEED YOU*** count follow the override. It is saved in the [config file](configuration.md#config-file).

## Your move

A PR needs you when its next action is something you can do now: mark ready, fix CI, rebase, address comments, request a review or merge. With **Pin "Your move" on top**, those PRs are also listed in ***● YOUR MOVE*** in front of the repos. A stack where all PRs need you moves there whole. Otherwise the stack stays in its repo and the PRs that need you show in both places.

The states behind this are in [Prompts per state](prompts.md#prompts-per-state).

## Collapse

***⊖ collapse*** goes one level per press, then opens everything again:

1. Cards to their title line.
2. Status groups and stacks.
3. Repos and ***● YOUR MOVE***.

![Collapsed cards and a collapsed stack](folded.jpg)

![pr-deck pane listing PRs from three repos, with YOUR MOVE grouped by repo](pane-all.jpg)

## Watching a PR

***◉ watch*** and `/prs watch <pr>` ask the session to watch a PR until CI passes. The prompt is the **Watch prompt** option, see [Prompt options](prompts.md#prompt-options). `/prs watch` needs no open pane:

```
/prs watch acme/api#7
```

The PR can be a number, `owner/repo#number` or its URL. A bare number that is open in more than one repo picks the session's repo, and otherwise asks for `owner/repo#number`. A PR the session has not seen yet makes it refresh first.
