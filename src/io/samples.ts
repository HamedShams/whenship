import { addDays, parseISO, weekdayIndex } from '../engine/dates';
import type { PlanInput } from '../engine/types';

/** Next Monday on or after `today`, so samples always start "now". */
export function nextMonday(today: string): string {
  const d = parseISO(today)!;
  const wd = weekdayIndex(d);
  return addDays(today, wd === 0 ? 0 : 7 - wd);
}

export interface Sample {
  id: string;
  label: string;
  blurb: string;
  build: (today: string) => PlanInput;
}

const at = (start: string, n: number) => addDays(start, n);

export const SAMPLES: Sample[] = [
  {
    id: 'two-person',
    label: 'Two people, many deadlines',
    blurb: 'A small consultancy juggling client deliverables, with hand-offs and work waiting on clients.',
    build: (today) => {
      const s = nextMonday(today);
      return {
        title: 'Client deliverables',
        start: s,
        currency: '€',
        lanes: [{ name: 'Sara' }, { name: 'Omar', availability: 50 }],
        items: [
          { name: 'Quick fix for Acme', who: 'Sara', days: 1, value: 15000 },
          { name: 'Appeal for Northwind', who: 'Sara', days: 4, deadline: at(s, 9), value: 20000 },
          { name: 'Research for Brightside', who: 'Sara', days: 5, deadline: at(s, 15), value: 85000 },
          { name: 'Revise Lumen proposal', work: [{ lane: 'Omar', days: 1 }, { lane: 'Sara', days: 3, after: 'Omar' }], deadline: at(s, 15), value: 24000 },
          { name: 'Appeal for Kestrel', who: 'Sara', days: 5, deadline: at(s, 30), value: 20000 },
          { name: 'Full application: Orbit', who: 'Sara', days: 6, deadline: at(s, 36), value: 100000 },
          { name: 'Research for Helix', work: [{ lane: 'Omar', days: 1 }, { lane: 'Sara', days: 5, after: 'Omar' }], deadline: at(s, 42), value: 100000, notBefore: at(s, 10), note: 'Waiting for the client questionnaire' },
        ],
      };
    },
  },
  {
    id: 'squads',
    label: 'Product squads',
    blurb: 'Back-end, front-end and data teams sharing a roadmap; some work can take two engineers at once.',
    build: (today) => {
      const s = nextMonday(today);
      return {
        title: 'Q4 roadmap',
        start: s,
        lanes: [
          { name: 'Back-end', size: 3, availability: 80 },
          { name: 'Front-end', size: 2, availability: 75 },
          { name: 'Data', size: 1, availability: 80 },
        ],
        items: [
          { name: 'Checkout redesign', work: [{ lane: 'Back-end', days: 6, maxPeople: 2 }, { lane: 'Front-end', days: 10, maxPeople: 2 }], deadline: at(s, 25) },
          { name: 'Subscriptions MVP', work: [{ lane: 'Back-end', days: 15, maxPeople: 2 }, { lane: 'Front-end', days: 5, after: 'Back-end' }], deadline: at(s, 45) },
          { name: 'Usage dashboard', work: [{ lane: 'Data', days: 8 }, { lane: 'Front-end', days: 4, after: 'Data' }], deadline: at(s, 40) },
          { name: 'Search relevance', work: [{ lane: 'Back-end', days: 8 }, { lane: 'Data', days: 4 }] },
          { name: 'Dark mode', work: [{ lane: 'Front-end', days: 5 }] },
          { name: 'Audit log', work: [{ lane: 'Back-end', days: 6 }, { lane: 'Front-end', days: 1 }], deadline: at(s, 50) },
        ],
      };
    },
  },
  {
    id: 'solo',
    label: 'Solo founder',
    blurb: 'One person at 70% (the rest is support and sales), shipping toward a launch date.',
    build: (today) => {
      const s = nextMonday(today);
      return {
        title: 'Launch plan',
        start: s,
        lanes: [{ name: 'Me', availability: 70 }],
        items: [
          { name: 'Onboarding flow', who: 'Me', days: 4 },
          { name: 'Billing', who: 'Me', days: 5, deadline: at(s, 18) },
          { name: 'Landing page', who: 'Me', days: 2 },
          { name: 'Launch post', who: 'Me', days: 1, deadline: at(s, 25), dependsOn: ['Landing page'] },
        ],
      };
    },
  },
];
