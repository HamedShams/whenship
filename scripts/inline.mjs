// Inlines the built JS and CSS into one HTML file: dist/app.html (served as the website and the Claude widget)
// and dist/whenship.html (the offline, double-click version), plus dist/og.png for link previews and dist/icon.png.
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'dist/ui';
let html = readFileSync(join(dir, 'index.html'), 'utf8');
html = html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g, (_, src) => {
  const js = readFileSync(join(dir, src), 'utf8').replace(/<\/script/gi, '<\\/script');
  return `<script type="module">${js}</script>`;
});
html = html.replace(/<link rel="stylesheet" crossorigin href="([^"]+)">/g, (_, href) => `<style>${readFileSync(join(dir, href), 'utf8')}</style>`);
if (/src="\/assets|href="\/assets/.test(html)) throw new Error('an asset was not inlined');
writeFileSync('dist/app.html', html);
copyFileSync('dist/app.html', 'dist/whenship.html');
copyFileSync('docs/og.png', 'dist/og.png'); // the link-preview image, served at /og.png
copyFileSync('packaging/icon-192.png', 'dist/icon.png'); // the app icon for search results and home screens, served at /icon.png
console.log(`dist/app.html ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB`);
