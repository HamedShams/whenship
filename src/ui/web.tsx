import { render } from 'preact';
import { todayLocal } from '../engine/dates';
import type { LensId } from '../engine/lens';
import { compactPlan, validatePlan } from '../engine/validate';
import type { NormalizedPlan } from '../engine/types';
import { decodeShareLink } from '../io/format';
import { App, type Host } from './App';
import { boot, FALLBACK_URL, REPO_URL } from './config';
import { downloadBlob, store } from './lib';

const KEY = 'whenship:plan:v1';

/** The standalone app: local-first (browser storage + files + share links), no account, no server state. */
export function bootWeb(root: HTMLElement) {
  const today = todayLocal();
  let initial: NormalizedPlan | null = null;
  let lens: LensId | undefined;
  let notice: string | null = null;

  const fromLink = location.hash.length > 3 ? decodeShareLink(location.hash.slice(1)) : null;
  if (fromLink) {
    initial = validatePlan(fromLink.plan, { today }).plan;
    lens = fromLink.lens;
    notice = 'Opened from a shared link. Edits stay in this browser.';
    history.replaceState(null, '', location.pathname + location.search);
  } else {
    // The plan is remembered; the lens isn't: the app always reopens on the user's own numbers (As planned).
    const saved = store.get(KEY);
    if (saved) {
      try {
        initial = validatePlan(JSON.parse(saved), { today }).plan;
      } catch {
        initial = null;
      }
    }
  }
  if (!initial) initial = validatePlan({ items: [] }, { today }).plan;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const host: Host = {
    mode: 'web',
    async save(file) {
      downloadBlob(file.name, file.mime, file.data);
      return 'saved';
    },
    async copy(text) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        return false;
      }
    },
    baseUrl() {
      if (location.protocol === 'http:' || location.protocol === 'https:') return location.origin + location.pathname;
      return boot.publicUrl ?? FALLBACK_URL;
    },
    onChange(plan) {
      clearTimeout(timer);
      timer = setTimeout(() => store.set(KEY, JSON.stringify(compactPlan(plan))), 250);
    },
  };

  render(
    <App
      host={host}
      initialPlan={initial}
      {...(lens ? { initialLens: lens } : {})}
      today={today}
      notice={notice}
      footer={
        <footer class="footer">
          <span>Your plan is stored only in this browser. Save it as a file or share it with a link.</span>
          <span class="spacer" />
          <a href={REPO_URL} target="_blank" rel="noopener">
            Open source (MIT)
          </a>
          <a href={`${REPO_URL}#use-it-in-claude`} target="_blank" rel="noopener">
            Use it in Claude
          </a>
        </footer>
      }
    />,
    root,
  );
}
