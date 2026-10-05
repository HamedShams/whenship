// Bundles the CLI (web server + MCP server + engine) into one file, dist/cli.js, so `npx whenship` installs nothing else.
import { build } from 'esbuild';
import { chmodSync, readFileSync, existsSync } from 'node:fs';

if (!existsSync('dist/app.html')) throw new Error('run `npm run build:ui` first (dist/app.html is missing)');
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));

await build({
  entryPoints: ['src/cli/index.ts'],
  outfile: 'dist/cli.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  minify: true,
  legalComments: 'linked',
  define: { __VERSION__: JSON.stringify(version) },
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'warning',
});
chmodSync('dist/cli.js', 0o755);
console.log(`dist/cli.js (whenship ${version})`);
