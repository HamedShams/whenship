---
name: whenship-insights
description: Turns a whenship schedule into advice someone can act on, such as which deadlines to protect, what to reorder, defer, cut or negotiate, whether more people would help, and how to phrase dates for clients or stakeholders. Use after a whenship plan exists, or when someone asks "what should we do", "what can we drop", "can we make it", "what do I tell the client", or wants a prioritisation recommendation for a small team, agency, consultancy, product squads or a solo founder.
---

# whenship insights: from dates to decisions

The engine tells you *what will happen*. This skill is about *what to do about it*. Every number you give must come from a whenship tool call (`show_plan`, `what_if`, `find_options`). Never promise that a change helps until `what_if` or `find_options` has shown it.

## How to recommend

1. **Start from the headline.** Late items (late even as planned) need a decision. Tight items (on time only if nothing slips) need a conscious "we accept the risk" or a buffer. Safe and likely items need nothing.
2. **Cheapest moves first.** Present options in this order, and only the ones the engine confirms:
   1. *Reorder*: moving a dated item ahead of undated or later work costs nothing.
   2. *Defer or cut*: postpone undated or less important work, or shrink scope (smaller first deliverable).
   3. *Protect time*: raise someone's availability (fewer meetings or support duty for two weeks).
   4. *Add a person*: the engine assumes they are productive from day one. For horizons under about six weeks, say that ramp-up and coordination usually eat much of the gain (Brooks's law).
   5. *Negotiate the date*: the engine tells you exactly how many working days to ask for.
3. **Say what it costs.** A reorder that saves one deadline often makes another tight. `what_if` shows both sides; report both.
4. **Dates for other people.** For a client or stakeholder, give two dates: the *likely* date and the *safe-bet* date (call `show_plan` with `lens: "likely"` and `lens: "safe"`, or read the badges). Recommend promising the safe-bet date and working to the likely one.
5. **Ask before changing their estimates.** The user's numbers are theirs. If an estimate looks off, say so and run a what-if; do not silently change it.
6. **Keep it short.** Three bullets beat a report. The chart has the details.

## Worked examples

Each example shows a realistic request, the plan you would send to `show_plan`, and the shape of a good answer. Dates in the answers are illustrative; always use the tool's numbers.

### 1. Two-person consultancy, many client deadlines

> "Sara and I run a grants consultancy. I'm only half-time on client work. Here's our list: quick fix for Acme (Sara, 1 day), Northwind appeal (Sara, 4 days, due the 14th), Brightside research (Sara 5 days, due the 20th), Lumen proposal (I prepare 1 day, then Sara 3 days, due the 20th), Orbit full application (Sara 6 days, due 10 Nov), Helix research (waiting for their questionnaire until the 15th; I do 1 day, then Sara 5, due 16 Nov). Are we OK?"

```json
{
  "title": "Client deliverables",
  "start": "2026-10-05",
  "lanes": [
    { "name": "Sara" },
    { "name": "Omar", "availability": 50 }
  ],
  "items": [
    { "name": "Quick fix for Acme", "who": "Sara", "days": 1 },
    { "name": "Appeal for Northwind", "who": "Sara", "days": 4, "deadline": "2026-10-14" },
    { "name": "Research for Brightside", "who": "Sara", "days": 5, "deadline": "2026-10-20" },
    { "name": "Revise Lumen proposal", "work": [{ "lane": "Omar", "days": 1 }, { "lane": "Sara", "days": 3, "after": "Omar" }], "deadline": "2026-10-20" },
    { "name": "Full application: Orbit", "who": "Sara", "days": 6, "deadline": "2026-11-10" },
    { "name": "Research for Helix", "work": [{ "lane": "Omar", "days": 1 }, { "lane": "Sara", "days": 5, "after": "Omar" }], "notBefore": "2026-10-15", "deadline": "2026-11-16" }
  ]
}
```

Good answer shape:
- "One deadline is late even as planned: **Lumen** finishes 21 Oct, a day after its deadline, because Sara is busy with Brightside and Northwind until 16 Oct. Three more are tight."
- Options from `find_options`, e.g. "Do the Acme quick fix after the dated work → Lumen makes it."
- The real constraint: "Almost everything queues behind Sara. Omar's prep work is never the bottleneck."
- What to tell clients: "Promise Orbit for the safe-bet date, not the as-planned one."

### 2. Product squads with back-end, front-end and data

> "Q4 roadmap. BE has 3 engineers but ~20% goes to support, FE has 2 at 75%, data has 1. Checkout redesign: BE 6 days and FE 10 days, two people can work on each side, due early November. Subscriptions MVP: BE 15 days (max 2 people), then FE 5 days, due end of November. Usage dashboard: data 8 days, then FE 4. Search relevance: BE 8 + data 4, no date. Audit log: BE 6 + FE 1, due 10 Dec. Can we ship Subscriptions by end of November?"

```json
{
  "title": "Q4 roadmap",
  "start": "2026-10-05",
  "lanes": [
    { "name": "Back-end", "size": 3, "availability": 80 },
    { "name": "Front-end", "size": 2, "availability": 75 },
    { "name": "Data", "size": 1, "availability": 80 }
  ],
  "items": [
    { "name": "Checkout redesign", "work": [{ "lane": "Back-end", "days": 6, "maxPeople": 2 }, { "lane": "Front-end", "days": 10, "maxPeople": 2 }], "deadline": "2026-11-06" },
    { "name": "Subscriptions MVP", "work": [{ "lane": "Back-end", "days": 15, "maxPeople": 2 }, { "lane": "Front-end", "days": 5, "after": "Back-end" }], "deadline": "2026-11-27" },
    { "name": "Usage dashboard", "work": [{ "lane": "Data", "days": 8 }, { "lane": "Front-end", "days": 4, "after": "Data" }], "deadline": "2026-11-20" },
    { "name": "Search relevance", "work": [{ "lane": "Back-end", "days": 8 }, { "lane": "Data", "days": 4 }] },
    { "name": "Audit log", "work": [{ "lane": "Back-end", "days": 6 }, { "lane": "Front-end", "days": 1 }], "deadline": "2026-12-10" }
  ]
}
```

Good answer shape:
- Answer the question first, with the tool's date and badge for Subscriptions: "Yes. As planned it lands on <date>; it is **<badge>**, so <what that means>."
- Name the bottleneck the tool shows ("front-end is the chain that sets the end date"), not a guess.
- Options: "Let a third back-end engineer join Subscriptions (`maxPeople: 3`)" only if `what_if` confirms it; "move undated Search relevance below Audit log"; "drop support duty to 10% for BE for four weeks (availability 90)".
- When someone suggests hiring: run `what_if` with `addLane`, then mention ramp-up honestly.

### 3. Solo founder before a launch

> "Just me, and maybe 70% of my week goes to building (rest is support and sales). Onboarding 4 days, billing 5 days (needs to be live by the 29th), landing page 2 days, launch post 1 day after the landing page, launch on 9 Nov."

```json
{
  "title": "Launch plan",
  "start": "2026-10-05",
  "lanes": [
    { "name": "Me", "availability": 70 }
  ],
  "items": [
    { "name": "Onboarding flow", "who": "Me", "days": 4 },
    { "name": "Billing", "who": "Me", "days": 5, "deadline": "2026-10-29" },
    { "name": "Landing page", "who": "Me", "days": 2 },
    { "name": "Launch post", "who": "Me", "days": 1, "deadline": "2026-11-09", "dependsOn": ["Landing page"] }
  ]
}
```

Good answer shape: the two dates, then "the cheapest fix is order: do billing before onboarding" if `what_if` confirms it, and "at 70% everything takes ~1.4× longer in calendar time; that is already in the dates".

### 4. Small agency with a holiday closure and client approvals

> "Design team of 2, dev team of 3. Three clients. Client A rebrand: design 8 days (2 designers can share it), then dev 6 days, due 13 Nov. Client B shop: dev 12 days (up to 3 devs), can't start before they send content on 12 Oct, due 20 Nov. Client C landing page: design 3 days then dev 2 days, due 23 Oct. We're closed 24–31 Dec. Who should I warn?"

```json
{
  "title": "Agency pipeline",
  "start": "2026-10-05",
  "calendar": { "holidays": [{ "from": "2026-12-24", "to": "2026-12-31", "label": "Studio closed" }] },
  "lanes": [
    { "name": "Design", "size": 2 },
    { "name": "Dev", "size": 3 }
  ],
  "items": [
    { "name": "Client C landing page", "work": [{ "lane": "Design", "days": 3 }, { "lane": "Dev", "days": 2, "after": "Design" }], "deadline": "2026-10-23" },
    { "name": "Client A rebrand", "work": [{ "lane": "Design", "days": 8, "maxPeople": 2 }, { "lane": "Dev", "days": 6, "after": "Design" }], "deadline": "2026-11-13" },
    { "name": "Client B shop", "work": [{ "lane": "Dev", "days": 12, "maxPeople": 3 }], "notBefore": "2026-10-12", "deadline": "2026-11-20" }
  ]
}
```

Good answer shape: "Warn nobody yet if everything is *likely* or *safe*; warn the client whose item is *tight* or *late*, and give them the safe-bet date." If content might arrive late, run `what_if` with `setNotBefore` to show what a one-week delay costs.

### 5. A team with a Saturday-to-Wednesday week and closure days

> "We're in Tehran: we work Saturday to Wednesday. There may be two closure days next week (heat). Reza does back-end, Neda front-end at 60%. Payment gateway: Reza 6 days then Neda 3, due 29 Oct. App redesign: Neda 8 days, due 10 Nov."

```json
{
  "title": "Release plan",
  "start": "2026-10-03",
  "calendar": { "workdays": ["sat", "sun", "mon", "tue", "wed"], "holidays": [{ "from": "2026-10-12", "to": "2026-10-13", "label": "Closure (heat)" }] },
  "lanes": [
    { "name": "Reza" },
    { "name": "Neda", "availability": 60 }
  ],
  "items": [
    { "name": "Payment gateway", "work": [{ "lane": "Reza", "days": 6 }, { "lane": "Neda", "days": 3, "after": "Reza" }], "deadline": "2026-10-29" },
    { "name": "App redesign", "who": "Neda", "days": 8, "deadline": "2026-11-10" }
  ]
}
```

Good answer shape: confirm the working week you used ("Saturday to Wednesday, 12–13 Oct closed"). Then run the plan with and without the closure days (`what_if` with `addHoliday`) and say what two lost days cost.

### 6. A team that leans on AI agents

> "Two devs, but most code is drafted by agents now. The bottleneck is review: Lina reviews everything and has about half her time for it. Feature A: dev 2 days, review 1 day. Feature B: dev 3, review 2. Feature C: dev 1, review 1. All due in two weeks."

Model human attention as the constrained lane, with the review as a hand-off:

```json
{
  "title": "Sprint with agents",
  "start": "2026-10-05",
  "lanes": [
    { "name": "Devs", "size": 2 },
    { "name": "Lina (review)", "availability": 50 }
  ],
  "items": [
    { "name": "Feature A", "work": [{ "lane": "Devs", "days": 2 }, { "lane": "Lina (review)", "days": 1, "after": "Devs" }], "deadline": "2026-10-16" },
    { "name": "Feature B", "work": [{ "lane": "Devs", "days": 3 }, { "lane": "Lina (review)", "days": 2, "after": "Devs" }], "deadline": "2026-10-16" },
    { "name": "Feature C", "work": [{ "lane": "Devs", "days": 1 }, { "lane": "Lina (review)", "days": 1, "after": "Devs" }], "deadline": "2026-10-16" }
  ]
}
```

Good answer shape: "Lina's review queue sets the last date, so faster drafting barely helps." Then test the real levers: more review time (`setLane` availability), a second reviewer (`addLane`), or smaller changes (`setEffort` on review).

## Phrases that work

- "As planned, X lands on <date>. If it runs long the way work usually does, expect <likely date>; <safe-bet date> is a date you can promise."
- "<Item> is late because <person> is busy with <items> until <date>." (from the tool's explanation)
- "Cheapest fix: <option>. Effect: <effect from find_options>."
- "This makes <other item> tight, so it's a trade, not a free win."

## Avoid

- Inventing percentages or dates. Even "about 80% likely" needs a tool call.
- Recommending "work harder" or overtime as a plan.
- Changing the user's estimates without asking.
- Long reports. Lead with the decision.
