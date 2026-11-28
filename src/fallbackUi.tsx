// The controls of the fallback render path.
//
// With HTML-in-Canvas the side cards, the bar, the pickers and the (i) flag are drawn into the 3D scene. Without it
// they are ordinary, visible HTML beside the canvas: a side panel that folds away, a bar along the bottom, and dialogs.
// The app renders the very same React elements (so every handler is shared) into the hosts made here.

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

import type { Copy } from './i18n';
import { sheetOpenHeight } from './fallbackLayout';
import { springEasing } from './spring';

export type FallbackUi = {
  /** holds everything below; appended to the app's `<main>` */
  root: HTMLDivElement;
  /** the map style switch, floated over the map */
  mapControls: HTMLDivElement;
  /** the grip along the top of the sheet: drag or tap it to pull the cards up */
  grip: HTMLDivElement;
  /** the cards: the body of the sheet below the bar of keys, and beside the map when docked */
  panel: HTMLDivElement;
  /** the cards, and the tabs above them */
  panelBody: HTMLDivElement;
  /** the bar of keys (and the map pin's name field above it) */
  hud: HTMLDivElement;
  /** dialogs: the pickers and the help flag */
  modal: HTMLDivElement;
  /** how tall the cards are when the sheet is up */
  openHeight(): number;
  /** Sets how far the cards are pulled up, in px (the 3D view makes room by the same amount); `dragging` follows a finger. */
  setSheet(height: number, dragging?: boolean): void;
  /** keeps the sheet's open height in sync with the window; returns the function that stops it */
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
  const sheet = div('fb-sheet');
  const grip = div('fb-sheet-grip-host');
  const hud = div('fb-hud');
  const panel = div('fb-panel');
  const panelBody = div('fb-panel-body');
  const modal = div('fb-modal');
  panel.append(panelBody);
  sheet.append(grip, hud, panel);
  root.append(mapControls, sheet, modal);

  // the sheet and the panel move as the engine's pop does: a spring with a little overshoot
  const spring = springEasing();
  root.style.setProperty('--fb-ease', spring.easing);
  root.style.setProperty('--fb-duration', `${spring.duration}ms`);

  // the page's own element carries the sheet's height, so the 3D view (outside the shell) can make room for it
  const page = document.documentElement;
  const openHeight = () => sheetOpenHeight(window.innerHeight);
  const setSheet = (height: number, dragging = false) => {
    page.style.setProperty('--fb-sheet-open', `${openHeight()}px`);
    page.style.setProperty('--fb-sheet-h', `${Math.round(height)}px`);
    if (dragging) page.dataset.fbDrag = '';
    else delete page.dataset.fbDrag;
  };
  page.style.setProperty('--fb-sheet-ease', spring.easing);
  page.style.setProperty('--fb-sheet-duration', `${spring.duration}ms`);
  setSheet(0);

  return {
    root,
    mapControls,
    grip,
    panel,
    panelBody,
    hud,
    modal,
    openHeight,
    setSheet,
    connect() {
      page.style.setProperty('--fb-sheet-open', `${openHeight()}px`);
      const sync = () => page.style.setProperty('--fb-sheet-open', `${openHeight()}px`);
      window.addEventListener('resize', sync);
      return () => {
        window.removeEventListener('resize', sync);
        for (const name of ['--fb-sheet-open', '--fb-sheet-h', '--fb-sheet-ease', '--fb-sheet-duration']) page.style.removeProperty(name);
        delete page.dataset.fbDrag;
      };
    },
  };
}

/**
 * The sheet's grip: a tap (or the keyboard) folds the cards away or pulls them up; a drag follows the finger and, let go,
 * settles up or down (a flick decides at once, otherwise the nearer end does).
 */
export function SheetGrip({ open, copy, max, onDrag, onSettle }: { open: boolean; copy: Copy; max: number; onDrag: (height: number) => void; onSettle: (open: boolean) => void }) {
  const label = open ? copy.ui.hidePanel : copy.ui.showPanel;
  const drag = useRef<{ y: number; from: number; moved: boolean; lastY: number; lastT: number; speed: number } | null>(null);
  const heightAt = (y: number) => Math.min(max, Math.max(0, drag.current ? drag.current.from - (y - drag.current.y) : 0));

  const down = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { y: event.clientY, from: open ? max : 0, moved: false, lastY: event.clientY, lastT: event.timeStamp, speed: 0 };
  };
  const move = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.abs(event.clientY - d.y) < 6) return;
    d.moved = true;
    const dt = event.timeStamp - d.lastT;
    if (dt > 0) d.speed = (event.clientY - d.lastY) / dt;
    d.lastY = event.clientY;
    d.lastT = event.timeStamp;
    onDrag(heightAt(event.clientY));
  };
  const up = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) return onSettle(!open); // a tap
    const height = Math.min(max, Math.max(0, d.from - (event.clientY - d.y)));
    onSettle(Math.abs(d.speed) > 0.5 ? d.speed < 0 : height > max * 0.4);
  };
  const cancel = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved) onSettle(open);
  };

  return (
    <button
      type="button"
      className="fb-grip"
      aria-label={label}
      aria-expanded={open}
      title={label}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancel}
      onClick={(event) => {
        if (event.detail === 0) onSettle(!open); // the keyboard; a pointer's tap was handled on release
      }}
    />
  );
}

/** The groups of cards the drawer shows, one at a time. */
export type PanelTabId = 'route' | 'search' | 'pin' | 'sun' | 'ways';

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
  raise: (
    <>
      <path d="M12 21V4" />
      <path d="m5.5 10 6.5-6.5 6.5 6.5" />
    </>
  ),
  flat: (
    <>
      <path d="M3 12h18" />
      <path d="m7 8-4 4 4 4M17 8l4 4-4 4" />
    </>
  ),
  route: (
    <>
      <circle cx="5.5" cy="18.5" r="2" />
      <path d="M7.5 18.5h6a3.5 3.5 0 0 0 0-7h-3a3.5 3.5 0 0 1 0-7h6" />
      <circle cx="18.5" cy="4.5" r="2" />
    </>
  ),
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

/**
 * Esc for a dialog that is up. It listens in the capture phase and stops the key there, so the engine's own
 * window listener (which would lay the model flat for an Esc it does not recognise) never sees it.
 * Returns the function that removes it.
 */
export function listenDialogEscape(onEscape: () => void): () => void {
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    onEscape();
  };
  window.addEventListener('keydown', onKey, true);
  return () => window.removeEventListener('keydown', onKey, true);
}

const FOCUSABLE = 'a[href], button, input, select, textarea, video[controls], [tabindex]';

/** What a key can reach inside `root`, in tab order (the scrim and anything taken out of the order are left out). */
function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('disabled') && el.getAttribute('tabindex') !== '-1' && el.getAttribute('aria-hidden') !== 'true',
  );
}

/**
 * A dialog over the map: a scrim that closes it, and a card that springs up.
 *
 * It is modal for a keyboard too: on opening, focus moves in (to the element marked `data-autofocus`, else the first one
 * it can reach); Tab and Shift+Tab stay inside it; and on closing, focus goes back to where it was.
 */
export function FallbackDialog({ children, label, closeLabel, onClose, className = '' }: { children: ReactNode; label: string; closeLabel: string; onClose: () => void; className?: string }) {
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const el = card.current;
    if (el) (el.querySelector<HTMLElement>('[data-autofocus]') ?? focusableIn(el)[0] ?? el).focus();
    return () => {
      if (origin?.isConnected) origin.focus();
    };
  }, []);

  const keep = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const items = focusableIn(event.currentTarget);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === event.currentTarget)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="fb-dialog-layer">
      <button type="button" className="fb-scrim" aria-label={closeLabel} tabIndex={-1} onClick={onClose} />
      <div ref={card} className={`fb-dialog ${className}`.trim()} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} onKeyDown={keep}>
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
