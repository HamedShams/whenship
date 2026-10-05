import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createHttpServer, withBoot } from '../mcp/http';
import { createServer } from '../mcp/server';

declare const __VERSION__: string;
const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : '0.0.0-dev';
const FALLBACK_URL = 'https://hamedshams.github.io/whenship/';

const HELP = `whenship ${VERSION}: when will it ship, honestly?

Usage:
  npx whenship                 Open whenship in your browser (local, nothing leaves your machine)
  npx whenship --stdio         Run as a local MCP server for Claude Desktop, Claude Code, Cursor, VS Code…

Options:
  --port <n>         Port for the local app (default 4545, or $PORT)
  --host <addr>      Address to listen on (default 127.0.0.1; use 0.0.0.0 to serve others)
  --public-url <u>   Public address used in share links (default: the address requests come in on, or $PUBLIC_URL)
  --no-open          Don't open the browser
  -v, --version      Print the version
  -h, --help         Show this help

The app is at /, the MCP endpoint at /mcp. Add it to Claude Code with:
  claude mcp add --transport http whenship http://localhost:4545/mcp
`;

interface Args {
  port: number;
  host: string;
  publicUrl?: string;
  open: boolean;
  stdio: boolean;
}

function parseArgs(argv: string[]): Args | null {
  const env = process.env;
  const args: Args = { port: Number(env.PORT) || 4545, host: env.HOST || '127.0.0.1', open: true, stdio: false };
  if (env.PUBLIC_URL) args.publicUrl = env.PUBLIC_URL;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const [flag, inline] = a.includes('=') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, undefined];
    const value = () => inline ?? argv[++i] ?? '';
    switch (flag) {
      case '--port':
      case '-p':
        args.port = Number(value());
        break;
      case '--host':
        args.host = value();
        break;
      case '--public-url':
        args.publicUrl = value();
        break;
      case '--no-open':
        args.open = false;
        break;
      case '--stdio':
        args.stdio = true;
        break;
      case '--version':
      case '-v':
        process.stdout.write(`${VERSION}\n`);
        return null;
      case '--help':
      case '-h':
        process.stdout.write(HELP);
        return null;
      default:
        process.stderr.write(`Unknown option: ${a}\n\n${HELP}`);
        process.exit(2);
    }
  }
  if (!Number.isInteger(args.port) || args.port < 0 || args.port > 65535) {
    process.stderr.write('--port must be a number between 0 and 65535\n');
    process.exit(2);
  }
  if (args.publicUrl && !/^https?:\/\//.test(args.publicUrl)) {
    process.stderr.write('--public-url must start with http:// or https://\n');
    process.exit(2);
  }
  if (args.publicUrl && !args.publicUrl.endsWith('/')) args.publicUrl += '/';
  return args;
}

function openBrowser(url: string) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const argv = process.platform === 'win32' ? ['/c', 'start', '""', url] : [url];
  try {
    spawn(cmd, argv, { stdio: 'ignore', detached: true }).on('error', () => undefined).unref();
  } catch {
    /* no browser: the URL is printed anyway */
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args) return;
  const html = readFileSync(new URL('./app.html', import.meta.url), 'utf8');
  const log = (msg: string) => process.stderr.write(`${msg}\n`);

  if (args.stdio) {
    // stdout belongs to the protocol: log to stderr only.
    const publicUrl = args.publicUrl ?? FALLBACK_URL;
    serveStdio(() => createServer({ html: withBoot(html, { mode: 'widget', publicUrl, version: VERSION }), publicUrl, version: VERSION }));
    return;
  }

  const local = args.host === '127.0.0.1' || args.host === 'localhost' || args.host === '::1';
  const server = createHttpServer({ html, version: VERSION, local, log, ...(args.publicUrl ? { publicUrl: args.publicUrl } : {}) });
  server.on('error', (err: NodeJS.ErrnoException) => {
    log(err.code === 'EADDRINUSE' ? `Port ${args.port} is busy. Try: npx whenship --port ${args.port + 1}` : err.message);
    process.exit(1);
  });
  server.listen(args.port, args.host, () => {
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : args.port;
    const shown = local ? `http://localhost:${port}/` : args.publicUrl ?? `http://${args.host}:${port}/`;
    log(`whenship ${VERSION}\n  App:  ${shown}\n  MCP:  ${shown}mcp\n  Stop: Ctrl+C`);
    if (args.open && local) openBrowser(shown);
  });
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main();
