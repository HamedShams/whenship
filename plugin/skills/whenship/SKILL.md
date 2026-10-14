---
name: whenship
description: Plans and forecasts work for small teams with the whenship scheduling engine. Use whenever someone asks when work will be done or will ship, whether deadlines will hold, which deadlines are at risk, how to prioritise several projects, clients or features with limited people, what to move, drop or add, capacity or roadmap planning, or shares a list, table, spreadsheet or screenshot of tasks with estimates, owners or due dates. Dates come from the engine, never from mental arithmetic.
---

# whenship: when will it ship, honestly?

whenship is a deterministic scheduler. It takes people or teams ("lanes"), work items in priority order with effort in working days, and deadlines, and returns exact finish dates, which deadlines slip and why, and the changes that would help. Your job is to turn the user's mess into a clean plan, call the engine, and explain its answer in plain words.

**Do not calculate dates, capacity or probabilities yourself.** Even simple-looking plans have weekends, part-time people, hand-offs and queues that make mental math wrong. Call the tools and repeat their numbers exactly.

## Tools (from the whenship connector)

| Tool | Use it to |
|---|---|
| `show_plan` | Schedule a plan and show the interactive chart. Always the first call. |
| `what_if` | Compare changes against the current plan (reorder, effort, deadline, people, holidays, working days). |
| `find_options` | Find the changes that meet more deadlines, each with its exact effect. |
| `export_plan` | Get the plan as JSON (the save file), CSV, iCalendar, Markdown or a share link. |

If no whenship tools are available, say so in one line and offer two ways forward: add the connector (custom connector URL from the whenship README), or open the web app and paste the plan. Then write the plan as a JSON file (format below) so nothing is lost. Do not fall back to computing dates by hand.

## Workflow

1. **Collect the plan from whatever the user gave you**: a list, a table, a screenshot, a tracker export, a few sentences. Map it to:
   - `lanes`: who does the work. A person (`{name: "Sara"}`), or a team or role with several people (`{name: "Back-end", size: 3}`). Add `availability` (percent of their time for this plan) when the user says someone is part-time or busy with other things.
   - `items`: in **priority order** (earlier items get people first; an item's prerequisites in `dependsOn` are worked on at its priority). Each item has `work`: one entry per lane with `days` of effort, or the shorthand `who` + `days`.
   - Optional: `deadline`, `dependsOn` (items that must finish first), `notBefore` (waiting on something external), hand-offs (`after: "<lane>"` inside `work`), `calendar.workdays`, `calendar.holidays`.
2. **Keep estimates exactly as given.** Never pad, round or "correct" them. If an estimate is missing, ask once, briefly, for the missing ones only. If the user wants a quick answer anyway, use a clearly labelled placeholder and say which items it affects.
3. **Working days**: default Monday to Friday. Use the user's weekend when they mention it or it is clear from context (for example Saturday–Wednesday working weeks with Thursday and Friday off). Put public holidays and closures in `calendar.holidays`.
4. **Call `show_plan`.** Pass `start` only if the user gave one (otherwise it is today). The chart appears for the user; your text answer should still stand on its own.
5. **Answer briefly**, in this order:
   - the headline the tool returned (deadlines late or tight, end date);
   - the items that are late or tight and, in a few words, why (the tool explains who was busy with what);
   - the best one to three options. Call `find_options` when anything is late or tight, and quote its effects;
   - one line on what the user can do in the chart: drag to reprioritise, click to edit, switch the forecast lens.
6. **Follow-ups**: for "what if we…", call `what_if` with explicit changes and report the difference. When the user wants to keep a change, call `show_plan` with the changed plan.
7. **The user can edit the chart directly.** Their latest edits reach you automatically as the current plan (a context update from the chart). Always build on that latest plan, not on an older one from earlier in the conversation.

## Forecast lenses (explain only when asked or when it matters)

The plan shows the user's own estimates by default ("As planned", 1×). Their numbers are never stretched. The lenses show how the same plan looks when work runs long the way it usually does:

- **Likely (1.6×)**: about half of comparable work is done by here.
- **Safe bet (3.1×)**: about 9 in 10 are done by here. A date you can promise.

Deadline badges use the same scale: *safe* means on time even at 3.1×, *likely* means on time at 1.6×, *tight* means on time only if nothing slips, *late* means late even as planned. With a lens on, any deadline that lens's dates miss shows as late. "Chance" is a rough reading of the same scale.

Method, if asked: a blended outside-view heuristic (Todd Little's 2006 lognormal model of software estimation error, combined with Flyvbjerg et al.'s 2022 power-law findings on IT project overruns; P50 1.6×, P90 3.1×), sanity-checked by simple/geometric averaging and a 50/50 Monte Carlo mixture. The chance is a smooth curve through those two points. It is a practical, generic rule of thumb, not a formal industry standard; the team's own track record beats it.

## Saving and sharing

- whenship stores nothing on its servers. The plan lives in the chat, in the user's files, or in a link.
- If you can write files (for example Claude Code, or Claude with file access), save `<title>.whenship.json` from `export_plan` with `format: "json"` when the user asks to save, or at the end of a planning session. The file opens again on the whenship website and in Claude.
- Otherwise, offer the share link (`export_plan` with `format: "link"`) and the JSON in a code block or document the user can keep. The chart's Export menu also gives Excel (with a Gantt sheet), PNG, calendar and CSV files.

## Plan format

```json
{
  "title": "Client deliverables",
  "start": "2026-10-05",
  "calendar": {
    "workdays": ["mon", "tue", "wed", "thu", "fri"],
    "holidays": [{ "from": "2026-12-24", "to": "2026-12-26", "label": "Holidays" }]
  },
  "lanes": [
    { "name": "Sara" },
    { "name": "Omar", "availability": 50 },
    { "name": "Back-end", "size": 3 }
  ],
  "items": [
    { "name": "Appeal for Northwind", "who": "Sara", "days": 4, "deadline": "2026-10-14" },
    { "name": "Revise Lumen proposal", "work": [{ "lane": "Omar", "days": 1 }, { "lane": "Sara", "days": 3, "after": "Omar" }], "deadline": "2026-10-20" },
    { "name": "Checkout redesign", "work": [{ "lane": "Back-end", "days": 6, "maxPeople": 2 }], "dependsOn": ["Appeal for Northwind"], "notBefore": "2026-10-12" }
  ]
}
```

- `start` is optional (default today).
- `availability` is the percent of someone's working time available for this plan; `size` makes a lane a team.
- `items` are in priority order. `after` inside `work` is a hand-off (Sara starts when Omar is done); `maxPeople` lets several people of a team work on one item at once; `notBefore` means waiting on something external.

For advice on what to recommend and worked examples for different kinds of teams, see the `whenship-insights` skill.
