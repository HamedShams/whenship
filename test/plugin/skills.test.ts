import { readFileSync, readdirSync } from 'node:fs';
import YAML from 'yaml';
import { describe, expect, it } from 'vitest';
import { analyze, findInsights, headline, validatePlan } from '../../src/engine';

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
    expect(findInsights(plans[0]!)[0]).toMatchObject({ title: 'Do "Quick fix for Acme" after the dated work', effect: expect.stringMatching(/^1 more deadline met \(Revise Lumen proposal\)/) });
    // values are switched off, so no example may rely on them
    for (const p of planBlocks(skills.map((x) => x.text).join('\n'))) expect(JSON.stringify(p)).not.toMatch(/"value"|"currency"/);

    expect(plans[3]!.calendar.holidays).toHaveLength(1);
    expect(plans[4]!.calendar.workdays).toEqual(['mon', 'tue', 'wed', 'thu', 'sun']);
    expect(plans[4]!.start).toBe('2026-10-04'); // a Sunday: a working day for that team

    const agents = analyze(plans[5]!);
    const review = agents.planned.items.flatMap((r) => r.parts).filter((p) => p.lane === 'lina-review');
    expect(review.every((p) => p.reason === 'handoff')).toBe(true);
    const last = agents.planned.items.reduce((a, b) => (b.end! > a.end! ? b : a));
    expect(last.driver).toMatchObject({ kind: 'capacity', lane: 'lina-review' });
  });

  it('the plugin folder is what the Claude directory asks of a bundle: a manifest, a readme, a license, the connector by address, and nothing stray', () => {
    const manifest = JSON.parse(readFileSync('plugin/.claude-plugin/plugin.json', 'utf8')) as Record<string, unknown>;
    expect(manifest).toMatchObject({ name: 'whenship', displayName: 'whenship', license: 'BSD-3-Clause', author: { name: 'Hamed Shams' } });
    expect(String(manifest.name)).toMatch(/^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/);
    // the skills point at the same connector the directory lists, so someone with both sees one set of tools
    expect(JSON.parse(readFileSync('plugin/.mcp.json', 'utf8'))).toEqual({ mcpServers: { whenship: { type: 'http', url: 'https://whenship.app/mcp' } } });
    // a readme of at least 40 words outside code blocks, saying what it does, how to use it and what it sends
    const readme = readFileSync('plugin/README.md', 'utf8');
    expect(readme.replace(/```[\s\S]*?```/g, '').split(/\s+/).filter(Boolean).length).toBeGreaterThan(40);
    for (const part of [/^# whenship\n/, /## How to use it/, /## What data it sends/, /not stored or logged/, /https:\/\/whenship\.app\/privacy/]) expect(readme).toMatch(part);
    // only text files the directory's scan can read, each well under its size limit, and no secrets in the connector file
    const files = (readdirSync('plugin', { recursive: true }) as string[]).filter((f) => /\.[a-z]+$/i.test(f) && !f.endsWith('.DS_Store'));
    expect(files.sort()).toEqual(['.claude-plugin/plugin.json', '.mcp.json', 'README.md', 'skills/whenship-insights/SKILL.md', 'skills/whenship/SKILL.md']);
    for (const f of files) expect(readFileSync(`plugin/${f}`).length).toBeLessThan(256 * 1024);
    expect(readFileSync('plugin/.mcp.json', 'utf8')).not.toMatch(/key|token|secret|authorization/i);
  });
});
