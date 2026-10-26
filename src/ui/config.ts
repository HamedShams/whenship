/** Injected by the server into the page (`window.__WHENSHIP__`); absent in the offline file. */
export interface BootConfig {
  mode?: 'web' | 'widget';
  /** Public address of this whenship instance, used for share links and "Open in whenship". */
  publicUrl?: string;
  version?: string;
}

export const boot: BootConfig = (globalThis as { __WHENSHIP__?: BootConfig }).__WHENSHIP__ ?? {};

/** Where share links point when the app runs from a local file and no address is known. */
export const FALLBACK_URL = 'https://hamedshams.github.io/whenship/';
export const REPO_URL = 'https://github.com/HamedShams/whenship';
/** Keep in step with package.json (a test checks it). */
export const VERSION = boot.version ?? '1.3.1';
