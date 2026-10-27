import type { ComponentChildren } from 'preact';
import { FEATURES } from '../engine/features';
import { LENSES, METHOD_SHORT, type LensId } from '../engine/lens';
import type { NormalizedPlan } from '../engine/types';
import { DEFAULT_TITLE } from '../engine/validate';
import { Popover, useAnchor } from './Popover';
import { Icon, Logo } from './lib';

const LENS_HINT: Record<LensId, string> = {
  planned: 'exactly what you entered',
  likely: 'about half of projects are done by here',
  safe: 'about 9 in 10 are done by here: a date to promise',
};

export type ExportKind = 'yaml' | 'json' | 'xlsx' | 'csv' | 'ics' | 'png' | 'svg' | 'md';

const ALL_EXPORTS: { kind: ExportKind; label: string; hint: string }[] = [
  { kind: 'json', label: 'Save plan', hint: '.json: reopen here or in Claude' },
  { kind: 'yaml', label: 'Save plan as YAML', hint: '.yaml' },
  { kind: 'xlsx', label: 'Excel', hint: '.xlsx with a Gantt sheet' },
  { kind: 'png', label: 'Image', hint: '.png of the chart' },
  { kind: 'ics', label: 'Calendar', hint: '.ics: dates into your calendar' },
  { kind: 'csv', label: 'CSV', hint: 'one row per item' },
  { kind: 'md', label: 'Summary', hint: '.md report' },
  { kind: 'svg', label: 'Vector image', hint: '.svg' },
];
export const EXPORTS = ALL_EXPORTS.filter((x) => x.kind !== 'yaml' || FEATURES.yamlExport);

interface Props {
  plan: NormalizedPlan;
  lens: LensId;
  onLens: (l: LensId) => void;
  onTitle: (t: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onExport: (k: ExportKind) => void;
  onCopyLink: () => void;
  onOpen?: () => void;
  extra?: ComponentChildren;
  /** No items yet: show only the title and Open. */
  empty?: boolean;
  /** One line under the plan name, e.g. where it's saved. */
  caption?: string;
}

export function Header(p: Props) {
  const menu = useAnchor<'export' | 'info'>();
  return (
    <header class="topbar">
      <span class="brand" title="whenship: when will it ship, honestly?">
        <Logo size={26} />
      </span>
      {/* The plan's own name, like a document title: editable in place, with a caption saying where it lives. */}
      <div class="doc-title">
        <label class="title-wrap" title="Rename this plan">
          <input
            class="title-input"
            value={p.plan.title}
            aria-label="Plan name"
            placeholder={DEFAULT_TITLE}
            style={{ width: `calc(${Math.min(34, Math.max(9, p.plan.title.length + 1))}ch + 40px)` }}
            onInput={(e) => p.onTitle((e.currentTarget as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
            onBlur={(e) => !(e.currentTarget as HTMLInputElement).value.trim() && p.onTitle(DEFAULT_TITLE)}
          />
          <Icon.pencil />
        </label>
        {p.caption && <span class="doc-caption">{p.caption}</span>}
      </div>
      <span class="spacer" />
      {!p.empty && (
        <>
          <div class="seg" role="group" aria-label="Forecast lens">
            {LENSES.map((l) => (
              <button key={l.id} aria-pressed={p.lens === l.id} aria-label={`${l.label} (${l.short})`} title={l.blurb} onClick={() => p.onLens(l.id)}>
                {l.label}
                <small>{l.short}</small>
              </button>
            ))}
          </div>
          <button class="icon-btn" aria-label="How the forecast lenses work" title="How the lenses work" onClick={(e) => menu.open(e.currentTarget as HTMLElement, 'info')}>
            <Icon.info />
          </button>
          <span style={{ width: '6px' }} />
        </>
      )}
      <button class="icon-btn" aria-label="Undo" title="Undo (Ctrl/⌘ Z)" disabled={!p.canUndo} onClick={p.onUndo}>
        <Icon.undo />
      </button>
      <button class="icon-btn" aria-label="Redo" title="Redo (Ctrl/⌘ Shift Z)" disabled={!p.canRedo} onClick={p.onRedo}>
        <Icon.redo />
      </button>
      {p.onOpen && (
        <button class="btn" onClick={p.onOpen} title="Open a plan file or paste a list / table">
          <Icon.open /> Open
        </button>
      )}
      {!p.empty && (
        <button class="btn primary" onClick={(e) => menu.open(e.currentTarget as HTMLElement, 'export')} aria-haspopup="menu" title="Save, export or copy a link to this plan">
          <Icon.download /> Export
        </button>
      )}
      {p.extra}

      {menu.el && menu.key === 'export' && (
        <Popover anchor={menu.el} onClose={menu.close} label="Export" className="menu-pop">
          <div class="menu" role="menu">
            {EXPORTS.map((x) => (
              <button
                key={x.kind}
                role="menuitem"
                onClick={() => {
                  menu.close();
                  p.onExport(x.kind);
                }}
              >
                <span>{x.label}</span>
                <small>{x.hint}</small>
              </button>
            ))}
            <button
              role="menuitem"
              class="menu-link"
              title="Copy a link that contains the whole plan (nothing is uploaded)"
              onClick={() => {
                menu.close();
                p.onCopyLink();
              }}
            >
              <span>
                <Icon.link /> Copy link
              </span>
              <small>the plan is inside the URL</small>
            </button>
          </div>
        </Popover>
      )}
      {menu.el && menu.key === 'info' && (
        <Popover anchor={menu.el} onClose={menu.close} label="How the lenses work" className="lens-pop">
          <h4>How long things really take</h4>
          <p class="note">
            <b>Your numbers never change.</b> The lenses re-plan as if every task takes longer, the way work usually does.
          </p>
          <table class="lens-table">
            <thead>
              <tr>
                <th>Lens</th>
                <th>Effort</th>
                <th>What it means</th>
              </tr>
            </thead>
            <tbody>
              {LENSES.map((l) => (
                <tr key={l.id} class={p.lens === l.id ? 'on' : undefined} aria-current={p.lens === l.id ? 'true' : undefined}>
                  <th scope="row">{l.label}</th>
                  <td class="lens-x">{l.short}</td>
                  <td>{LENS_HINT[l.id]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div class="badge-key" aria-label="What the badges mean">
            <span>
              <span class="pill safe">safe</span> even at 3.1×
            </span>
            <span>
              <span class="pill likely">likely</span> at 1.6×
            </span>
            <span>
              <span class="pill tight">tight</span> if nothing slips
            </span>
            <span>
              <span class="pill late">late</span> even as planned
            </span>
          </div>
          <p class="note">Badges say how much slip a deadline survives. With Likely or Safe bet on, any deadline those dates miss shows as late.</p>
          <p class="note method">
            <b>Where the numbers come from.</b> {METHOD_SHORT} The "~x% chance" assumes the whole plan runs long or short together.
          </p>
        </Popover>
      )}
    </header>
  );
}
