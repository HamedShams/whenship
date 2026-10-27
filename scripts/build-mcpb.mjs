// Packs whenship as a Claude Desktop extension (dist/whenship.mcpb): the same connector, run locally over stdio by
// Claude Desktop's built-in Node. Set WHENSHIP_PUBLIC_URL to the website that share links and "Open in browser"
// should point to (default: the public GitHub Pages address).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';

for (const f of ['dist/cli.js', 'dist/app.html']) if (!existsSync(f)) throw new Error(`run \`npm run build\` first (${f} is missing)`);
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
let publicUrl = process.env.WHENSHIP_PUBLIC_URL || 'https://hamedshams.github.io/whenship/';
if (!publicUrl.endsWith('/')) publicUrl += '/';

const manifest = {
  manifest_version: '0.2',
  name: 'whenship',
  display_name: 'whenship',
  version: pkg.version,
  description: 'When will it ship, honestly? Plan small-team work: real finish dates, deadline risk and what-ifs in an interactive chart.',
  long_description:
    'whenship schedules work for small teams (people or teams, items in priority order, effort in working days, deadlines) and shows an interactive Gantt chart right in the conversation: finish dates, which deadlines slip and why, and the changes that would help. Edits in the chart reach Claude automatically. Nothing is stored on any server: this extension runs on your computer.',
  author: { name: 'Hamed Shams', url: 'https://github.com/HamedShams' },
  homepage: pkg.homepage,
  repository: { type: 'git', url: 'https://github.com/HamedShams/whenship.git' },
  support: 'https://github.com/HamedShams/whenship/issues',
  icon: 'icon.png',
  server: {
    type: 'node',
    entry_point: 'server/whenship.mjs',
    mcp_config: { command: 'node', args: ['${__dirname}/server/whenship.mjs', '--stdio', '--public-url', publicUrl], env: {} },
  },
  tools: [
    { name: 'show_plan', description: 'Schedule a plan and show the interactive chart: finish dates, deadline risk and options.' },
    { name: 'what_if', description: 'Compare a plan with a changed version of it: simple changes, or a whole alternative plan (moving work, splitting or cutting items, combinations).' },
    { name: 'find_options', description: 'Find changes that meet more deadlines, each re-planned exactly.' },
    { name: 'export_plan', description: 'The plan as JSON, CSV, iCalendar, Markdown or a share link.' },
  ],
  keywords: pkg.keywords,
  license: 'MIT',
  compatibility: { platforms: ['darwin', 'win32', 'linux'], runtimes: { node: '>=20.0.0' } },
};

const files = {
  'manifest.json': strToU8(JSON.stringify(manifest, null, 2) + '\n'),
  'server/whenship.mjs': readFileSync('dist/cli.js'), // .mjs: an ES module even without a package.json next to it
  'server/app.html': readFileSync('dist/app.html'),
  'icon.png': readFileSync('packaging/icon.png'),
  'LICENSE': readFileSync('LICENSE'),
};
writeFileSync('dist/whenship.mcpb', zipSync(files, { level: 9 }));
console.log(`dist/whenship.mcpb (whenship ${pkg.version}, links to ${publicUrl})`);
