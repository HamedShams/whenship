import { useMemo, useState } from 'preact/hooks';
import { analyze } from '../engine/analysis';
import { addDays, dayParts, formatDay, parseISO } from '../engine/dates';
import { findInsights } from '../engine/insights';
import type { Badge } from '../engine/lens';
import type { NormalizedPlan, PlanInput } from '../engine/types';
import { validatePlan } from '../engine/validate';
import { nextMonday, SAMPLES } from '../io/samples';
import { REPO_URL, VERSION } from './config';
import { cx, Icon, Logo } from './lib';
import { OpenDialog, type OpenTab } from './Welcome';

/**
 * The plan drawn on the home page: small enough to read in a glance, and still a real plan (the engine works out
 * every date on it). Three people, two hand-offs, one promise that is late, one that is tight. It starts this week,
 * so the today line is on it.
 */
export function heroPlan(today: string): PlanInput {
  const s = addDays(nextMonday(today), -7);
  const at = (n: number) => addDays(s, n);
  return {
    title: 'App launch',
    start: s,
    lanes: [{ name: 'Maya' }, { name: 'Leo' }, { name: 'Priya' }],
    items: [
      { name: 'Onboarding', work: [{ lane: 'Maya', days: 4 }, { lane: 'Priya', days: 5, after: 'Maya' }], deadline: at(23) },
      { name: 'Checkout', work: [{ lane: 'Leo', days: 6 }, { lane: 'Priya', days: 4, after: 'Leo' }], deadline: at(15) },
      { name: 'Notifications', work: [{ lane: 'Leo', days: 5 }], deadline: at(31) },
      { name: 'Store page', work: [{ lane: 'Maya', days: 5 }], deadline: at(15) },
      { name: 'Beta fixes', work: [{ lane: 'Leo', days: 3 }, { lane: 'Priya', days: 4 }], dependsOn: ['Onboarding'], deadline: at(25) },
    ],
  };
}

const BADGE_VAR: Record<Badge, string> = { safe: 'var(--ok)', likely: 'var(--ok)', tight: 'var(--warn)', late: 'var(--danger)', unknown: 'var(--fg3)' };

/**
 * A plan as a picture: one row an item, a bar for each person's part, a diamond for the deadline, hatching where the
 * work runs past it. Drawn from the engine's own schedule; not interactive. `compact` leaves out the names and dates
 * (the small pictures on the example cards).
 */
export function PlanSketch({ plan, today, compact }: { plan: NormalizedPlan; today: string; compact?: boolean }) {
  const a = useMemo(() => analyze(plan, 'planned'), [plan]);
  const start = parseISO(plan.start)!;
  let end = start + 13;
  for (const r of a.current.items) if (r.endDate) end = Math.max(end, parseISO(r.endDate)!);
  for (const it of plan.items) if (it.deadline) end = Math.max(end, parseISO(it.deadline)!);
  const span = end - start + 2;
  const pct = (iso: string, plus = 0) => `${(((parseISO(iso)! - start + plus) / span) * 100).toFixed(2)}%`;
  const width = (from: string, to: string) => `${(((parseISO(to)! - parseISO(from)! + 1) / span) * 100).toFixed(2)}%`;
  const color = (lane: string) => plan.lanes.find((l) => l.id === lane)?.color ?? '#868e96';
  const year = dayParts(plan.start).year;
  const t = parseISO(today);
  return (
    <div class={cx('sketch', compact && 'compact')} aria-hidden="true">
      {plan.items.map((it) => {
        const r = a.current.byId.get(it.id)!;
        const badge = a.status.get(it.id);
        const late = it.deadline && r.endDate && r.endDate > it.deadline;
        return (
          <div key={it.id} class="sk-row">
            {!compact && <span class="sk-name">{it.name}</span>}
            {!compact && <span class={cx('sk-date', badge)}>{r.endDate ? formatDay(r.endDate, year) : ''}</span>}
            <span class="sk-track">
              {late && r.endDate && it.deadline && <i class="sk-late" style={{ left: pct(it.deadline, 1), width: width(addDays(it.deadline, 1), r.endDate) }} />}
              {r.parts
                .filter((p) => p.start !== undefined && p.end !== undefined)
                .map((p, k, all) => {
                  const from = a.current.calendar.dateAt(p.start!);
                  const to = a.current.calendar.dateAt(p.end!);
                  return <i key={p.lane} class="sk-bar" style={{ left: pct(from), width: width(from, to), background: color(p.lane), top: `${all.length > 1 ? 22 + k * 30 : 30}%`, height: all.length > 1 ? '26%' : '40%' }} />;
                })}
              {it.deadline && <i class="sk-due" style={{ left: pct(it.deadline, 0.5), background: badge ? BADGE_VAR[badge] : 'var(--fg3)' }} />}
            </span>
          </div>
        );
      })}
      {t !== null && t >= start && t <= end && <i class="sk-today" style={{ '--x': ((t - start + 0.5) / span).toFixed(4) }} />}
    </div>
  );
}

/**
 * The home page, for a browser with no plan in it yet (and from the logo, any time): what whenship is in one line, a
 * small real plan as the picture, and the three ways in: an example, your own list or file, or an empty plan. Then
 * where else it runs (inside Claude; offline or on your own server, from GitHub).
 */
export function Landing({
  today,
  onStart,
  resume,
  claudeUrl,
  privacyUrl,
}: {
  today: string;
  /** Open the app on this plan. `example` shows the note that it is one; `fresh` puts the cursor in its first item. */
  onStart: (plan: NormalizedPlan, how?: { example?: boolean; fresh?: boolean; note?: string }) => void;
  /** A plan already kept in this browser: offered first. */
  resume?: { title: string; onContinue: () => void } | undefined;
  /** Where "Add it to Claude" goes: this server's connector page, or the README from a local file. */
  claudeUrl: string;
  privacyUrl: string;
}) {
  const [dialog, setDialog] = useState<OpenTab | null>(null);
  const hero = useMemo(() => validatePlan(heroPlan(today), { today }).plan, [today]);
  const tip = useMemo(() => findInsights(hero, 'planned')[0], [hero]);
  const samples = useMemo(() => SAMPLES.map((s) => ({ ...s, plan: validatePlan(s.build(today), { today }).plan })), [today]);
  const blank = () => onStart(validatePlan({ title: 'My plan', start: nextMonday(today), lanes: [{ name: 'Me' }], items: [{ name: 'First item', who: 'Me', days: 3 }] }, { today }).plan, { fresh: true });

  return (
    <div class="landing">
      <header class="lp-top">
        <span class="lp-brand">
          <Logo size={30} />
          <span>whenship</span>
        </span>
        <nav class="lp-nav" aria-label="Elsewhere">
          <a href={claudeUrl} target="_blank" rel="noopener">
            Use it in Claude
          </a>
          <a href={REPO_URL} target="_blank" rel="noopener">
            GitHub
          </a>
        </nav>
      </header>

      <main>
        <section class="lp-hero">
          <div class="lp-pitch">
            <h1>When will it ship, honestly?</h1>
            <p class="lp-lede">A live what-if Gantt for small teams. List the work, who does it and roughly how long it takes. whenship shows which deadlines will slip, why, and what would fix it.</p>
            <p class="lp-trust">Free and open source. No sign-up: your plan stays in your browser.</p>
            <div class="lp-cta">
              {resume ? (
                <button class="btn primary" onClick={resume.onContinue}>
                  Continue with "{resume.title}" <span aria-hidden="true">→</span>
                </button>
              ) : (
                <button class="btn primary" onClick={() => onStart(samples[0]!.plan, { example: true })}>
                  Try it with an example <span aria-hidden="true">→</span>
                </button>
              )}
              <button class="btn" onClick={() => setDialog('paste')}>
                <Icon.paste /> Paste your list
              </button>
            </div>
          </div>
          {/* The picture is a way in, not a dead end: it looks like the app, so pressing it opens this very plan in the
              app. A tag says so; nothing on this page looks pressable without being it. */}
          <button class="lp-picture" onClick={() => onStart(hero, { example: true })} aria-label={`Open this example plan: ${hero.title}`}>
            <span class="lp-tag">
              Example plan <b>Open it <span aria-hidden="true">→</span></b>
            </span>
            <PlanSketch plan={hero} today={today} />
            {tip && (
              <span class="lp-option" aria-hidden="true">
                <span class="lp-option-kind">An option whenship found</span>
                <b>{tip.title}</b>
                <span>{tip.effect}</span>
              </span>
            )}
          </button>
        </section>

        <section class="lp-start" aria-labelledby="lp-start-h">
          <h2 id="lp-start-h">Start with an example</h2>
          <div class="lp-examples">
            {samples.map((s) => (
              <button key={s.id} class="lp-example" onClick={() => onStart(s.plan, { example: true })}>
                <PlanSketch plan={s.plan} today={today} compact />
                <b>{s.label}</b>
                <span>{s.blurb}</span>
                <span class="lp-go">
                  Open this example <span aria-hidden="true">→</span>
                </span>
              </button>
            ))}
          </div>
          <div class="lp-own">
            <span class="lp-or">or bring your own</span>
            <button class="btn" onClick={() => setDialog('paste')}>
              <Icon.paste /> Paste a list
            </button>
            <button class="btn" onClick={() => setDialog('file')}>
              <Icon.open /> Open a file
            </button>
            <button class="btn" onClick={blank}>
              <Icon.plus /> Start from scratch
            </button>
          </div>
        </section>

        <section class="lp-more">
          <div class="lp-card">
            <h3>Inside Claude</h3>
            <p>Ask "will we make the deadline?" and get this chart in the conversation. Claude calls the same engine for every date, and sees the edits you make on the chart.</p>
            <a class="btn" href={claudeUrl} target="_blank" rel="noopener">
              Add it to Claude
            </a>
          </div>
          <div class="lp-card">
            <h3>Yours to run</h3>
            <p>One small open-source app. Use it offline as a single file, host it yourself, or install the Claude Desktop extension. Everything is on GitHub.</p>
            <a class="btn" href={REPO_URL} target="_blank" rel="noopener">
              Open GitHub
            </a>
          </div>
        </section>
      </main>

      <footer class="footer lp-foot">
        <span>whenship {VERSION}</span>
        <a href={privacyUrl} target="_blank" rel="noopener">
          Privacy
        </a>
        <span class="spacer" />
        <span class="credit">
          Made by{' '}
          <a href="https://hamedshams.com" target="_blank" rel="noopener author">
            Hamed Shams
          </a>
        </span>
      </footer>

      {dialog && <OpenDialog today={today} tab={dialog} tabs={['paste', 'file']} onLoad={(p, note) => onStart(p, note ? { note } : undefined)} onClose={() => setDialog(null)} />}
    </div>
  );
}
