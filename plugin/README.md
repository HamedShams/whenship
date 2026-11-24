# whenship

**When will it ship, honestly?** These skills teach Claude to plan small-team work with the whenship scheduling engine, so the dates in your conversation are worked out, not guessed.

Tell Claude who is on the team, what needs doing, roughly how long each thing takes and what is due when. You get real finish dates, the deadlines that will slip and why, and the changes that would fix it, drawn as a chart you can work in.

## What is inside

- **whenship**: turns a task list, pasted spreadsheet rows or a plain description into a clean plan, runs it through the engine and explains the answer in plain words. Dates always come from the engine, never from mental arithmetic.
- **whenship-insights**: turns the schedule into decisions: which deadlines to protect, what to reorder, defer, cut or negotiate, whether another person would help, and how to say it to a client.
- **The whenship connector** (on this plugin's Connectors tab, no sign-in): the engine itself and the interactive chart.

## Install

From the Claude directory, or in Claude Code:

```
/plugin install whenship --marketplace HamedShams/whenship
```

## How to use it

Connect the whenship connector, then ask in your own words:

- "Sara has five client deliverables due this month. Will she make the deadlines?"
- "Here is our launch list with owners and estimates. What is at risk?"
- "One deadline is slipping. What are my options?"
- "How does this plan look if things take longer than we think?"

In the chart you can drag an item to a new priority and watch every date change before you let go, drag a bar's edge to change an estimate, try an option with one click, and export the result. Claude sees the edits you make.

## What data it sends

The skills are instructions only: they run no code and send nothing by themselves. When Claude calls the connector at `https://whenship.app/mcp`, the plan you asked about (people's and items' names, effort, dates) is sent there, scheduled in memory and returned. It is not stored or logged, and there are no accounts. See the [privacy page](https://whenship.app/privacy).

## More

Website: [whenship.app](https://whenship.app) · Source and documentation: [github.com/HamedShams/whenship](https://github.com/HamedShams/whenship) · License: BSD 3-Clause · Made by [Hamed Shams](https://hamedshams.com)
