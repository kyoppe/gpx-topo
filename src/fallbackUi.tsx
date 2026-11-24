// The controls of the fallback render path.
//
// With HTML-in-Canvas the side cards, the bar, the pickers and the (i) flag are drawn into the 3D scene. Without it
// they are ordinary, visible HTML beside the canvas: a side panel that folds away, a bar along the bottom, and dialogs.
// The app renders the very same React elements (so every handler is shared) into the hosts made here.

import { useId, useState, type ReactNode } from 'react';

import type { Copy } from './i18n';
import { panelWidthFor } from './fallbackLayout';
import { springEasing } from './spring';

export type FallbackUi = {
  /** holds everything below; appended to the app's `<main>` */
  root: HTMLDivElement;
  /** the map style switch, floated over the map */
  mapControls: HTMLDivElement;
  /** under the drawer: a tap beside it folds it away */
  backdrop: HTMLDivElement;
  /** the side panel: the body of cards, and the drawer's tabs above them */
  panel: HTMLDivElement;
  /** the cards, and the drawer's tabs above them */
  panelBody: HTMLDivElement;
  /** the bar of keys (and the map pin's name field above it) */
  hud: HTMLDivElement;
  /** the key at the bar's right end that pulls the drawer out */
  panelKey: HTMLDivElement;
  /** dialogs: the pickers and the help flag */
  modal: HTMLDivElement;
  /** keeps the panel's size and the bar's height in sync with the window; returns the function that stops it */
  connect(): () => void;
};

function div(className: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  return el;
}

/** Make the hosts the controls are rendered into. They are plain elements, so the app can portal into them at once. */
export function createFallbackUi(): FallbackUi {
  const root = div('fb-ui');
  const mapControls = div('fb-map-controls');
  const backdrop = div('fb-backdrop-host');
  const panel = div('fb-panel');
  const panelBody = div('fb-panel-body');
  const hud = div('fb-hud');
  const panelKey = div('fb-panel-key-host');
  const modal = div('fb-modal');
  panel.append(panelBody);
  root.append(backdrop, mapControls, panel, hud, panelKey, modal);

  // the panel and the bar move as the engine's pop does: a spring with a little overshoot
  const spring = springEasing();
  root.style.setProperty('--fb-ease', spring.easing);
  root.style.setProperty('--fb-duration', `${spring.duration}ms`);

  const sync = () => {
    const width = window.innerWidth;
    root.style.setProperty('--fb-panel-width', `${panelWidthFor(width)}px`);
    root.style.setProperty('--fb-hud-height', `${hud.offsetHeight}px`);
  };
  sync();

  return {
    root,
    backdrop,
    mapControls,
    panel,
    panelBody,
    hud,
    panelKey,
    modal,
    connect() {
      sync();
      window.addEventListener('resize', sync);
      const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(sync) : null;
      observer?.observe(hud);
      return () => {
        window.removeEventListener('resize', sync);
        observer?.disconnect();
      };
    },
  };
}

/** The drawer's key, at the right end of the bar: it pulls the panel out, and pushes it back. */
export function PanelKey({ open, copy, onToggle }: { open: boolean; copy: Copy; onToggle: () => void }) {
  const label = open ? copy.ui.hidePanel : copy.ui.showPanel;
  return (
    <button type="button" className="fb-panel-key" aria-label={label} aria-expanded={open} title={label} onClick={onToggle}>
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="3" y="4.5" width="18" height="15" rx="2.4" />
        <path d="M14.5 4.5v15" />
        <path d="M17 9h2M17 12h2M17 15h2" />
      </svg>
    </button>
  );
}

/** The groups of cards the drawer shows, one at a time. */
export type PanelTabId = 'route' | 'search' | 'sun' | 'ways';

export function PanelTabs({ tabs, active, labels, onSelect }: { tabs: readonly PanelTabId[]; active: PanelTabId; labels: Record<PanelTabId, string>; onSelect: (tab: PanelTabId) => void }) {
  return (
    <div className="fb-tabs" role="tablist">
      {tabs.map((tab) => (
        <button key={tab} type="button" role="tab" aria-selected={tab === active} onClick={() => onSelect(tab)}>
          {labels[tab]}
        </button>
      ))}
    </div>
  );
}

const KEY_ICONS = {
  open: <path d="M3 7.5a2 2 0 0 1 2-2h4l2 2.2h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7.5Z" />,
  place: (
    <>
      <path d="M11 20s-6-5.2-6-10a6 6 0 0 1 12 0" />
      <circle cx="11" cy="10" r="2.1" />
      <path d="M18 14v6M15 17h6" />
    </>
  ),
} as const;

/** What a key shows in the fallback: a picture (on a narrow bar) and its words (on a wide one, or for a screen reader). */
export function KeyFace({ icon, label }: { icon: keyof typeof KEY_ICONS; label: string }) {
  return (
    <>
      <svg className="key-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        {KEY_ICONS[icon]}
      </svg>
      <span className="key-label">{label}</span>
    </>
  );
}

/** A dialog over the map: a scrim that closes it, and a card that springs up. */
export function FallbackDialog({ children, label, closeLabel, onClose, className = '' }: { children: ReactNode; label: string; closeLabel: string; onClose: () => void; className?: string }) {
  return (
    <div className="fb-dialog-layer">
      <button type="button" className="fb-scrim" aria-label={closeLabel} tabIndex={-1} onClick={onClose} />
      <div className={`fb-dialog ${className}`.trim()} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));
const wrap = (value: number, n: number) => ((value % n) + n) % n;

/** The hour and minute fields of a time picker: what the drums are in the scene, as two steppers. */
export function FallbackTimePicker({
  clock,
  minutes,
  copy,
  head,
  onCancel,
  onCommit,
}: {
  /** a time of day (hours wrap at 24) rather than a duration (hours run on) */
  clock: boolean;
  minutes: number;
  copy: Copy;
  head: ReactNode;
  onCancel: () => void;
  onCommit: (minutes: number) => void;
}) {
  const [hours, setHours] = useState(() => Math.floor(minutes / 60));
  const [mins, setMins] = useState(() => minutes % 60);
  const hoursId = useId();
  const minsId = useId();
  const hourMax = clock ? 24 : 1000;
  const stepHours = (by: number) => setHours((h) => (clock ? wrap(h + by, 24) : clamp(h + by, 0, hourMax - 1)));
  const stepMins = (by: number) => setMins((m) => wrap(m + by, 60));
  const field = (id: string, value: number, label: string, max: number, set: (v: number) => void, step: (by: number) => void) => (
    <span className="fb-stepper">
      <button type="button" className="fb-step" aria-label={`${label} +`} onClick={() => step(1)}>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3.5 10 8 5.5 12.5 10" />
        </svg>
      </button>
      <input
        id={id}
        className="fb-step-value"
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={String(value).padStart(2, '0')}
        aria-label={label}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          const next = Number(event.target.value.replace(/\D/g, '').slice(-3));
          if (Number.isFinite(next)) set(clamp(next, 0, max - 1));
        }}
      />
      <button type="button" className="fb-step" aria-label={`${label} -`} onClick={() => step(-1)}>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3.5 6 8 10.5 12.5 6" />
        </svg>
      </button>
    </span>
  );
  return (
    <div className="pop pop-time fb-time" data-kind="time">
      {head}
      <div className="fb-time-fields">
        {field(hoursId, hours, copy.ui.hoursAria, hourMax, setHours, stepHours)}
        <span className="drum-colon">:</span>
        {field(minsId, mins, copy.ui.minutesAria, 60, setMins, stepMins)}
      </div>
      <div className="pop-foot">
        <small />
        <button type="button" className="pop-btn" onClick={onCancel}>
          {copy.ui.cancel}
        </button>
        <button type="button" className="pop-btn pop-ok" onClick={() => onCommit((clock ? wrap(hours, 24) : Math.max(0, hours)) * 60 + wrap(mins, 60))}>
          {copy.ui.confirm}
        </button>
      </div>
    </div>
  );
}
