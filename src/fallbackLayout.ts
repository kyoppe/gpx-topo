// Layout for the fallback render path (browsers without HTML-in-Canvas, mostly phones and tablets).
//
// The native page is a wide sheet with the map on the left and a 400px panel on the right, never narrower than
// 1080px. The fallback keeps the controls out of the sheet (they are ordinary HTML beside the canvas), so the sheet
// is just the map, and it follows the window's shape: a tall window gets a tall map.

import { FRAME_X, FRAME_Y } from './engine';

export type FallbackLayout = {
  pageWidth: number;
  pageHeight: number;
  mapX: number;
  mapY: number;
  mapWidth: number;
  mapHeight: number;
  /** unused in the fallback (the panel is not part of the sheet); kept so the engine model has the same shape */
  sideX: number;
};

export type Orientation = 'portrait' | 'landscape';

/** The breathing room round the map on the sheet, in page px. */
export const FALLBACK_PAD = 12;
/** The smallest sheet: below this a phone is held in a way the map would be unreadable anyway. */
const MIN_WIDTH = 280;
const MIN_HEIGHT = 320;
/** The width of the docked side panel. */
export const FALLBACK_PANEL_WIDTH = 400;
/** The margin either side of the panel. */
export const FALLBACK_EDGE = 12;
/** What a docked panel takes from the window: its width and its margins. Keep in step with `--fb-dock-width`. */
export const DOCK_WIDTH = FALLBACK_PANEL_WIDTH + FALLBACK_EDGE * 2;
/** A window this wide and this tall, held wide, has room for the panel beside the map; anything less does not. */
const DOCK_MIN_WIDTH = 760;
const DOCK_MIN_HEIGHT = 560;

export function orientationOf(width: number, height: number): Orientation {
  return width > height ? 'landscape' : 'portrait';
}

/** The sheet fills the window (less the frame the engine keeps free for the bar), with the map inset on it. */
export function fallbackLayoutFor(width: number, height: number): FallbackLayout {
  const pageWidth = Math.max(MIN_WIDTH, Math.round(width - FRAME_X));
  const pageHeight = Math.max(MIN_HEIGHT, Math.round(height - FRAME_Y));
  return {
    pageWidth,
    pageHeight,
    mapX: FALLBACK_PAD,
    mapY: FALLBACK_PAD,
    mapWidth: pageWidth - FALLBACK_PAD * 2,
    mapHeight: pageHeight - FALLBACK_PAD * 2,
    sideX: pageWidth,
  };
}

/** Wide enough, tall enough and held wide: the panel stays beside the map, and the 3D view is the rest of the window. */
export function isDocked(width: number, height: number): boolean {
  return orientationOf(width, height) === 'landscape' && width >= DOCK_MIN_WIDTH && height >= DOCK_MIN_HEIGHT;
}

/** How tall the cards of the sheet are when it is pulled up: most of the window's height, but never more than this. */
const SHEET_MAX_HEIGHT = 520;
const SHEET_SHARE = 0.6;

export function sheetOpenHeight(windowHeight: number): number {
  return Math.min(SHEET_MAX_HEIGHT, Math.round(windowHeight * SHEET_SHARE));
}

/**
 * A bar this narrow shows its keys as pictures, and has no room for the first person view and the aerial shots as keys of
 * their own: one key opens them instead. Keep in step with the `max-width: 560px` media query of the bar in styles.css.
 */
export const COMPACT_BAR_MAX_WIDTH = 560;

export function isCompactBar(width: number): boolean {
  return width <= COMPACT_BAR_MAX_WIDTH;
}

/** Compact fallback HUD values. Keep these in step with the compact controls in styles.css. */
export const COMPACT_HUD_KEY_WIDTH = 40;
export const COMPACT_HUD_FLIP_WIDTH = 84;
export const COMPACT_HUD_GAP = 6;
export const COMPACT_HUD_MEDIUM_MAX_WIDTH = 385;
export const COMPACT_HUD_SMALL_MAX_WIDTH = 319;

export type CompactHudMetrics = {
  keyWidth: number;
  flipWidth: number;
  gap: number;
};

export function compactHudMetrics(width: number): CompactHudMetrics {
  if (width <= COMPACT_HUD_SMALL_MAX_WIDTH) return { keyWidth: 30, flipWidth: 56, gap: 2 };
  if (width <= COMPACT_HUD_MEDIUM_MAX_WIDTH) return { keyWidth: 34, flipWidth: 64, gap: 3 };
  return { keyWidth: COMPACT_HUD_KEY_WIDTH, flipWidth: COMPACT_HUD_FLIP_WIDTH, gap: COMPACT_HUD_GAP };
}

export function compactHudRowWidth(keyWidths: readonly number[], gap = COMPACT_HUD_GAP): number {
  if (keyWidths.length === 0) return 0;
  return keyWidths.reduce((total, width) => total + width, 0) + gap * (keyWidths.length - 1);
}
