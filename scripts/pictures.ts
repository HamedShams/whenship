// Takes the two pictures of the app with headless Chrome: the README's (docs/screenshot.png: the real app, dark, showing
// docs/example.whenship.json) and the link preview's (docs/og.png, from scripts/og.html, which frames that screenshot).
// Run `npm run build` first, then `npm run docs:pictures`. Chrome is looked for in its usual place on a Mac; set CHROME
// to its path anywhere else. The example's dates are fixed, so only the "today" marker moves between runs.
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { todayLocal } from '../src/engine/dates';
import { validatePlan } from '../src/engine/validate';
import { shareUrl } from '../src/io/format';

const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 4599;

function shot(url: string, out: string, width: number, height: number, scale: number) {
  execFileSync(
    chrome,
    [
      '--headless',
      '--hide-scrollbars',
      `--window-size=${width},${height}`,
      `--force-device-scale-factor=${scale}`,
      '--blink-settings=preferredColorScheme=0', // dark
      '--virtual-time-budget=8000', // long enough for the chart to fit itself and the "opened from a link" note to go
      `--screenshot=${resolve(out)}`,
      url,
    ],
    { stdio: 'ignore' },
  );
  console.log(out);
}

async function main() {
  const plan = validatePlan(JSON.parse(readFileSync('docs/example.whenship.json', 'utf8')), { today: todayLocal() }).plan;
  const server = spawn(process.execPath, ['dist/cli.js', '--port', String(port), '--no-open'], { stdio: 'ignore' });
  try {
    for (let i = 0; ; i++) {
      const up = await fetch(`http://localhost:${port}/healthz`).then((r) => r.ok, () => false);
      if (up) break;
      if (i > 50) throw new Error('the app did not start: run `npm run build` first');
      await new Promise((r) => setTimeout(r, 100));
    }
    shot(shareUrl(`http://localhost:${port}/`, plan), 'docs/screenshot.png', 1280, 880, 2);
    shot(pathToFileURL(resolve('scripts/og.html')).href, 'docs/og.png', 1200, 630, 1);
  } finally {
    server.kill();
  }
}

void main();
