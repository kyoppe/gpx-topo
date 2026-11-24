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
/** The width of the side panel (it never takes more than this share of a narrow window). */
export const FALLBACK_PANEL_WIDTH = 400;
const PANEL_SHARE = 0.92;
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

/** How wide the panel is in a window of this width. */
export function panelWidthFor(width: number): number {
  return Math.min(FALLBACK_PANEL_WIDTH, Math.round(width * PANEL_SHARE));
}
