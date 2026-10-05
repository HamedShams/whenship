import type { ComponentChildren } from 'preact';
import { LENSES, METHOD_NOTE, OVERRUN_TABLE, type LensId } from '../engine/lens';
import type { NormalizedPlan } from '../engine/types';
import { Popover, useAnchor } from './Popover';
import { Icon, Logo } from './lib';

export type ExportKind = 'yaml' | 'json' | 'xlsx' | 'csv' | 'ics' | 'png' | 'svg' | 'md';

export const EXPORTS: { kind: ExportKind; label: string; hint: string }[] = [
  { kind: 'yaml', label: 'Save plan', hint: '.yaml: reopen or edit later' },
  { kind: 'xlsx', label: 'Excel', hint: '.xlsx with a Gantt sheet' },
  { kind: 'png', label: 'Image', hint: '.png of the chart' },
  { kind: 'ics', label: 'Calendar', hint: '.ics: dates into your calendar' },
  { kind: 'csv', label: 'CSV', hint: 'one row per item' },
  { kind: 'md', label: 'Summary', hint: '.md report' },
  { kind: 'svg', label: 'Vector image', hint: '.svg' },
  { kind: 'json', label: 'JSON', hint: 'same as the plan file' },
];

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
  compactBrand?: boolean;
  /** No items yet: show only the title and Open. */
  empty?: boolean;
}

export function Header(p: Props) {
  const menu = useAnchor<'export' | 'info'>();
  return (
    <header class="topbar">
      <span class="brand" title="whenship: when will it ship, honestly?">
        <Logo />
        {!p.compactBrand && <span>whenship</span>}
      </span>
      <input class="title-input" value={p.plan.title} aria-label="Plan title" onInput={(e) => p.onTitle((e.currentTarget as HTMLInputElement).value)} />
      <span class="spacer" />
      {!p.empty && (
        <>
          <div class="seg" role="group" aria-label="Forecast lens">
            {LENSES.map((l) => (
              <button key={l.id} aria-pressed={p.lens === l.id} aria-label={`${l.label} (${l.short})`} title={l.blurb} onClick={() => p.onLens(l.id)}>
                {l.label}
                {l.factor !== 1 && <small>{l.short}</small>}
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
        <>
          <button class="btn" onClick={p.onCopyLink} title="Copy a link that contains the whole plan (nothing is uploaded)">
            <Icon.link /> Copy link
          </button>
          <button class="btn primary" onClick={(e) => menu.open(e.currentTarget as HTMLElement, 'export')} aria-haspopup="menu">
            <Icon.download /> Export
          </button>
        </>
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
            <hr />
            <button
              role="menuitem"
              onClick={() => {
                menu.close();
                p.onCopyLink();
              }}
            >
              <span>Copy link</span>
              <small>the plan travels inside the URL</small>
            </button>
          </div>
        </Popover>
      )}
      {menu.el && menu.key === 'info' && (
        <Popover anchor={menu.el} onClose={menu.close} label="How the lenses work">
          <h4>How long things really take</h4>
          <p class="note" style={{ margin: '0 0 6px' }}>
            <b>Your numbers never change.</b> "As planned" shows exactly what you entered. The other lenses re-plan as if every task takes longer, the way work usually does:
          </p>
          <table class="lens-table">
            <tbody>
              {LENSES.map((l) => (
                <tr key={l.id}>
                  <td>
                    <b>{l.label}</b>
                  </td>
                  <td>{l.short}</td>
                  <td class="sub">{l.blurb}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p class="note" style={{ margin: '6px 0' }}>
            Deadline badges show how much slip each deadline survives: <b>safe</b> (even at 2.7×), <b>likely</b> (at 1.6×), <b>tight</b> (only if all goes to plan), <b>late</b> (late even as planned).
          </p>
          <details>
            <summary class="note" style={{ cursor: 'pointer' }}>For pros: where the numbers come from</summary>
            <p class="note">{METHOD_NOTE}</p>
            <p class="note">Full table: {OVERRUN_TABLE.map((r) => `P${Math.round(r.p * 100)} ${r.factor}×`).join(' · ')}. The "~x% chance" in tooltips assumes the whole plan runs long or short together.</p>
          </details>
        </Popover>
      )}
    </header>
  );
}
