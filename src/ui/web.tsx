import { render } from 'preact';
import { todayLocal } from '../engine/dates';
import { toLensId, type LensId } from '../engine/lens';
import { compactPlan, validatePlan } from '../engine/validate';
import type { NormalizedPlan } from '../engine/types';
import { decodeShareLink } from '../io/format';
import { SAMPLES } from '../io/samples';
import { toZoom, type Zoom } from '../io/view';
import { App, type Host } from './App';
import { boot, FALLBACK_URL, REPO_URL } from './config';
import { downloadBlob, store } from './lib';

const KEY = 'whenship:plan:v1';
const LENS_KEY = 'whenship:lens:v1';
const ZOOM_KEY = 'whenship:zoom:v1';
/** Set once the first visit's example has been edited or dismissed: the intro strip never comes back. */
const INTRO_KEY = 'whenship:intro:v1';

/** The standalone app: local-first (browser storage + files + share links), no account, no server state. */
export function bootWeb(root: HTMLElement) {
  const today = todayLocal();
  let initial: NormalizedPlan | null = null;
  let lens: LensId | undefined;
  let zoom: Zoom | undefined;
  let notice: string | null = null;
  let intro = false;

  const fromLink = location.hash.length > 3 ? decodeShareLink(location.hash.slice(1)) : null;
  if (fromLink) {
    initial = validatePlan(fromLink.plan, { today }).plan;
    lens = fromLink.lens;
    zoom = fromLink.zoom;
    notice = 'Opened from a shared link. Edits stay in this browser.';
    history.replaceState(null, '', location.pathname + location.search);
  } else {
    // The plan and the view (lens, timeline zoom) are remembered, so a refresh or a later visit looks the same. (The
    // chart key says when a lens other than As planned is on, with a one-click way back.)
    lens = toLensId(store.get(LENS_KEY));
    zoom = toZoom(store.get(ZOOM_KEY));
    const saved = store.get(KEY);
    if (saved) {
      try {
        initial = validatePlan(JSON.parse(saved), { today }).plan;
      } catch {
        initial = null;
      }
    }
  }
  if (!initial) {
    // The first visit opens on an example plan: the chart itself is the welcome, with a strip that says so.
    if (!store.get(INTRO_KEY)) {
      initial = validatePlan(SAMPLES[0]!.build(today), { today }).plan;
      intro = true;
    } else initial = validatePlan({ items: [] }, { today }).plan;
  }

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
    onChange(plan, lens, _analysis, zoom) {
      clearTimeout(timer);
      timer = setTimeout(() => {
        store.set(KEY, JSON.stringify(compactPlan(plan)));
        store.set(LENS_KEY, lens);
        store.set(ZOOM_KEY, zoom ?? ''); // empty: picked from the plan's length
      }, 250);
    },
  };

  render(
    <App
      host={host}
      initialPlan={initial}
      {...(lens ? { initialLens: lens } : {})}
      {...(zoom ? { initialZoom: zoom } : {})}
      today={today}
      notice={notice}
      intro={intro}
      onIntroDone={() => store.set(INTRO_KEY, '1')}
      footer={
        <footer class="footer">
          <span>Your plan is stored only in this browser. Save it as a file or share it with a link.</span>
          <span class="spacer" />
          <a href={REPO_URL} target="_blank" rel="noopener">
            Open source
          </a>
          <a href={`${REPO_URL}#use-it-in-claude`} target="_blank" rel="noopener">
            Use it in Claude
          </a>
          <span class="credit">
            Made by{' '}
            <a href="https://hamedshams.com" target="_blank" rel="noopener author">
              Hamed Shams
            </a>
          </span>
        </footer>
      }
    />,
    root,
  );
}
