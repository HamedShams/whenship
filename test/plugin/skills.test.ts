import { readFileSync, readdirSync } from 'node:fs';
import YAML from 'yaml';
import { describe, expect, it } from 'vitest';
import { analyze, explain, findInsights, headline, validatePlan } from '../../src/engine';

const dir = 'plugin/skills';
const skills = readdirSync(dir).map((name) => ({ name, text: readFileSync(`${dir}/${name}/SKILL.md`, 'utf8') }));
// Strict YAML, like the skill loader: an unquoted ": " in a description breaks loading.
const front = (text: string) => YAML.parse(/^---\n([\s\S]*?)\n---/.exec(text)![1]!) as { name: string; description: string };
const planBlocks = (text: string) => [...text.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]!) as unknown);

describe('plugin skills', () => {
  it.each(skills)('$name has valid frontmatter', ({ name, text }) => {
    const f = front(text);
    expect(f.name).toBe(name);
    expect(f.description.length).toBeGreaterThan(100);
    expect(f.description.length).toBeLessThan(1024);
  });

  it('every example plan in the skills is valid as written', () => {
    const plans = skills.flatMap((s) => planBlocks(s.text));
    expect(plans.length).toBeGreaterThanOrEqual(7); // the format example plus six worked examples
    for (const p of plans) {
      const v = validatePlan(p, { today: '2026-10-05' });
      expect(v.errors, JSON.stringify(v.errors)).toEqual([]);
      expect(v.warnings, JSON.stringify(v.warnings)).toEqual([]);
      expect(v.plan.items.length).toBeGreaterThan(0);
    }
  });

  it('the worked examples say what the engine actually computes', () => {
    const plans = planBlocks(skills.find((s) => s.name === 'whenship-insights')!.text).map((p) => validatePlan(p, { today: '2026-10-05' }).plan);
    const consultancy = analyze(plans[0]!);
    expect(headline(consultancy)).toMatch(/^1 of 5 deadlines late even as planned · 3 tight/);
    const lumen = consultancy.planned.byId.get('revise-lumen-proposal')!;
    expect([lumen.endDate, lumen.late]).toEqual(['2026-10-21', true]);
    expect(consultancy.planned.byId.get('research-for-brightside')!.endDate).toBe('2026-10-16');
    expect(findInsights(plans[0]!)[0]).toMatchObject({ title: 'Do "Quick fix for Acme" after the dated work', effect: expect.stringMatching(/^1 more deadline met \(Revise Lumen proposal\) · 24k € less at risk/) });

    expect(plans[3]!.calendar.holidays).toHaveLength(1);
    expect(plans[4]!.calendar.workdays).toEqual(['mon', 'tue', 'wed', 'sat', 'sun']);
    expect(plans[4]!.start).toBe('2026-10-03'); // a Saturday: a working day for that team

    const agents = analyze(plans[5]!);
    const review = agents.planned.items.flatMap((r) => r.parts).filter((p) => p.lane === 'lina-review');
    expect(review.every((p) => p.reason === 'handoff')).toBe(true);
    const last = agents.planned.items.reduce((a, b) => (b.end! > a.end! ? b : a));
    expect(last.driver).toMatchObject({ kind: 'capacity', lane: 'lina-review' });
  });
});
