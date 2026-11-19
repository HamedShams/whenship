import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { todayLocal } from '../engine/dates';
import { toLensId, type LensId } from '../engine/lens';
import { compactPlan, validatePlan } from '../engine/validate';
import type { NormalizedPlan } from '../engine/types';
import { decodeShareLink } from '../io/format';
import { toZoom, type Zoom } from '../io/view';
import { App, type Host } from './App';
import { boot, FALLBACK_URL, REPO_URL, VERSION } from './config';
import { Landing } from './Landing';
import { downloadBlob, store } from './lib';

const KEY = 'whenship:plan:v1';
const LENS_KEY = 'whenship:lens:v1';
const ZOOM_KEY = 'whenship:zoom:v1';
/** Set once an example's note has been edited away or dismissed: it never comes back. */
const INTRO_KEY = 'whenship:intro:v1';

const online = () => location.protocol === 'http:' || location.protocol === 'https:';

/** What the page opens on: the plan in a share link, else the plan kept in this browser, else nothing (the home page). */
function firstPlan(today: string): { plan: NormalizedPlan | null; lens?: LensId | undefined; zoom?: Zoom | undefined; notice: string | null } {
  const fromLink = location.hash.length > 3 ? decodeShareLink(location.hash.slice(1)) : null;
  if (fromLink) {
    history.replaceState(null, '', location.pathname + location.search);
    return { plan: validatePlan(fromLink.plan, { today }).plan, lens: fromLink.lens, zoom: fromLink.zoom, notice: 'Opened from a shared link. Edits stay in this browser.' };
  }
  // The plan and the view (lens, timeline zoom) are remembered, so a refresh or a later visit looks the same. (The
  // chart key says when a lens other than As planned is on, with a one-click way back.)
  const view = { lens: toLensId(store.get(LENS_KEY)), zoom: toZoom(store.get(ZOOM_KEY)), notice: null };
  const saved = store.get(KEY);
  if (saved) {
    try {
      const plan = validatePlan(JSON.parse(saved), { today }).plan;
      if (plan.items.length) return { plan, ...view };
    } catch {
      /* unreadable: start over */
    }
  }
  return { plan: null, ...view };
}

/**
 * The website: the home page while this browser holds no plan (and from the logo, any time), the app once it does.
 * Local-first: browser storage, files and share links; no account, no server state.
 */
function Web({ today }: { today: string }) {
  const first = useMemo(() => firstPlan(today), []);
  // what the app opens on next: set by the first load and by every way in from the home page
  const [session, setSession] = useState<{ plan: NormalizedPlan; example?: boolean; fresh?: boolean; notice?: string | null; n: number } | null>(
    first.plan ? { plan: first.plan, notice: first.notice, n: 0 } : null,
  );
  const [home, setHome] = useState(!first.plan);
  const latest = useRef<NormalizedPlan | null>(first.plan); // the plan as the app last reported it
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stale = useNewerVersion();

  const host: Host = useMemo(
    () => ({
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
        if (online()) return location.origin + location.pathname;
        return boot.publicUrl ?? FALLBACK_URL;
      },
      onChange(plan, lens, _analysis, zoom) {
        latest.current = plan;
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          store.set(KEY, JSON.stringify(compactPlan(plan)));
          store.set(LENS_KEY, lens);
          store.set(ZOOM_KEY, zoom ?? ''); // empty: picked from the plan's length
        }, 250);
      },
    }),
    [],
  );

  const note = stale && (
    <div class="update-note" role="status">
      <span>whenship has been updated since this tab was opened.</span>
      <button class="btn small primary" onClick={() => location.reload()}>
        Reload
      </button>
    </div>
  );

  if (home || !session) {
    const kept = latest.current && latest.current.items.length ? latest.current : null;
    return (
      <>
        {note}
        <Landing
          today={today}
          claudeUrl={online() ? `${location.origin}/mcp` : `${REPO_URL}#use-it-in-claude`}
          privacyUrl={online() ? `${location.origin}/privacy` : `${REPO_URL}/blob/main/docs/PRIVACY.md`}
          resume={kept ? { title: kept.title, onContinue: () => (setSession((s) => ({ plan: kept, n: (s?.n ?? 0) + 1 })), setHome(false)) } : undefined}
          onStart={(plan, how) => {
            latest.current = plan;
            setSession((s) => ({ plan, ...how, n: (s?.n ?? 0) + 1 }));
            setHome(false);
          }}
        />
      </>
    );
  }

  return (
    <>
      {note}
      <App
        key={session.n}
        host={host}
        initialPlan={session.plan}
        {...(first.lens ? { initialLens: first.lens } : {})}
        {...(first.zoom ? { initialZoom: first.zoom } : {})}
        {...(session.fresh && session.plan.items[0] ? { initialFocus: session.plan.items[0].id } : {})}
        today={today}
        notice={session.notice ?? null}
        intro={!!session.example && !store.get(INTRO_KEY)}
        onIntroDone={() => store.set(INTRO_KEY, '1')}
        onHome={() => setHome(true)}
        footer={
          <footer class="footer">
            <span>Your plan is stored only in this browser. Save it as a file or share it with a link.</span>
            <span class="spacer" />
            <span>whenship {VERSION}</span>
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
      />
    </>
  );
}

/**
 * A tab left open across a deploy keeps running the old app (it is one page, loaded once). When the tab comes back
 * into view, ask this server which build it serves now; if it isn't this one, offer a reload. Every deploy counts, not
 * only a new version number. Only on a server that answers `/healthz` (not the offline file), and nothing about the
 * visitor is sent.
 */
function useNewerVersion(): boolean {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (!online() || typeof fetch !== 'function') return;
    let last = 0;
    const check = async () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < 60_000) return;
      last = Date.now();
      try {
        const r = await fetch(`${location.origin}/healthz`, { cache: 'no-store' });
        const served = r.ok ? ((await r.json()) as { version?: string; build?: string }) : {};
        if (boot.build && served.build ? served.build !== boot.build : !!served.version && served.version !== VERSION) setStale(true);
      } catch {
        /* offline, or not a whenship server: nothing to say */
      }
    };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, []);
  return stale;
}

export function bootWeb(root: HTMLElement) {
  render(<Web today={todayLocal()} />, root);
}
