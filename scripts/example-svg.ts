// Renders the README picture from the two-person sample (fixed dates, so it never changes by itself).
import { writeFileSync } from 'node:fs';
import { validatePlan } from '../src/engine/validate';
import { SAMPLES } from '../src/io/samples';
import { toSvg } from '../src/io/svg';

const today = '2026-10-05';
const plan = validatePlan(SAMPLES[0]!.build(today), { today }).plan;
writeFileSync('docs/example.svg', toSvg(plan, 'planned', { dark: false }));
console.log('docs/example.svg');
