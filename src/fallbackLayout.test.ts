import { describe, expect, it } from 'vitest';

import { FRAME_X, FRAME_Y } from './engine';
import {
  COMPACT_BAR_MAX_WIDTH,
  DOCK_WIDTH,
  FALLBACK_EDGE,
  FALLBACK_PAD,
  FALLBACK_PANEL_WIDTH,
  compactHudMetrics,
  compactHudSize,
  compactHudRowWidth,
  fallbackLayoutFor,
  isCompactBar,
  isDocked,
  orientationOf,
  sheetOpenHeight,
} from './fallbackLayout';

describe('fallback layout', () => {
  it('fills a tall phone with a tall map, inset by the pad', () => {
    const layout = fallbackLayoutFor(390, 844);
    expect(layout.pageWidth).toBe(390 - FRAME_X);
    expect(layout.pageHeight).toBe(844 - FRAME_Y);
    expect(layout.mapX).toBe(FALLBACK_PAD);
    expect(layout.mapY).toBe(FALLBACK_PAD);
    expect(layout.mapWidth).toBe(layout.pageWidth - FALLBACK_PAD * 2);
    expect(layout.mapHeight).toBe(layout.pageHeight - FALLBACK_PAD * 2);
    expect(layout.mapHeight).toBeGreaterThan(layout.mapWidth);
  });

  it('gives a wide window a wide map, with no room kept for a panel (the panel floats over it)', () => {
    const layout = fallbackLayoutFor(1366, 768);
    expect(layout.mapWidth).toBeGreaterThan(layout.mapHeight);
    expect(layout.mapWidth).toBe(1366 - FRAME_X - FALLBACK_PAD * 2);
  });

  it('is not held to the native sheet\'s minimum size', () => {
    expect(fallbackLayoutFor(390, 844).pageWidth).toBeLessThan(1080);
  });

  it('never goes below a usable size on a tiny window', () => {
    const layout = fallbackLayoutFor(100, 100);
    expect(layout.pageWidth).toBeGreaterThanOrEqual(280);
    expect(layout.pageHeight).toBeGreaterThanOrEqual(320);
    expect(layout.mapWidth).toBeGreaterThan(0);
    expect(layout.mapHeight).toBeGreaterThan(0);
  });

  it('tells the orientation of a window', () => {
    expect(orientationOf(390, 844)).toBe('portrait');
    expect(orientationOf(844, 390)).toBe('landscape');
    expect(orientationOf(800, 800)).toBe('portrait');
  });

  it('docks the panel only on a window that is wide, tall enough and held wide', () => {
    expect(isDocked(1366, 768)).toBe(true);
    expect(isDocked(1024, 768)).toBe(true);
    expect(isDocked(844, 390)).toBe(false); // a phone held sideways: too short
    expect(isDocked(390, 844)).toBe(false);
    expect(isDocked(820, 1180)).toBe(false); // a tablet held upright
    expect(isDocked(700, 600)).toBe(false); // too narrow
  });

  it('leaves the panel its own room, so the 3D view never runs under it', () => {
    expect(DOCK_WIDTH).toBe(FALLBACK_PANEL_WIDTH + FALLBACK_EDGE * 2);
    const docked = fallbackLayoutFor(1366 - DOCK_WIDTH, 768);
    const whole = fallbackLayoutFor(1366, 768);
    expect(whole.pageWidth - docked.pageWidth).toBe(DOCK_WIDTH);
  });

  it('pulls the cards up to most of a window, but not past a sensible height', () => {
    expect(sheetOpenHeight(667)).toBe(400);
    expect(sheetOpenHeight(874)).toBe(520);
    expect(sheetOpenHeight(1366)).toBe(520);
  });
});

describe('compact bar', () => {
  it('is a phone held upright, and not a window with room for a key of each', () => {
    expect(isCompactBar(390)).toBe(true);
    expect(isCompactBar(COMPACT_BAR_MAX_WIDTH)).toBe(true);
    expect(isCompactBar(COMPACT_BAR_MAX_WIDTH + 1)).toBe(false);
    expect(isCompactBar(844)).toBe(false);
  });

  it('uses the post-dock width for a docked window', () => {
    expect(isCompactBar(760)).toBe(false);
    expect(isCompactBar(760 - DOCK_WIDTH)).toBe(true);
    expect(compactHudSize(319)).toBe('small');
    expect(compactHudSize(320)).toBe('medium');
    expect(compactHudSize(386)).toBe('large');
    expect(compactHudSize(760 - DOCK_WIDTH)).toBe('medium');
  });

  it('fits the normal compact HUD in one row from its minimum supported width', () => {
    for (const width of [280, 320, 375, 390]) {
      const { keyWidth, flipWidth, gap } = compactHudMetrics(width);
      const row = compactHudRowWidth([keyWidth, keyWidth, keyWidth, flipWidth, keyWidth, keyWidth, keyWidth], gap);
      expect(row).toBe(6 * keyWidth + flipWidth + gap * 6);
      expect(row).toBeLessThanOrEqual(width - FALLBACK_EDGE * 2);
    }
  });

  it('fits the compact flyover HUD in one row from its minimum supported width', () => {
    for (const width of [280, 320, 375, 390]) {
      const { keyWidth, gap } = compactHudMetrics(width);
      expect(compactHudRowWidth(Array.from({ length: 8 }, () => keyWidth), gap)).toBe(8 * keyWidth + gap * 7);
      expect(compactHudRowWidth(Array.from({ length: 8 }, () => keyWidth), gap)).toBeLessThanOrEqual(width - FALLBACK_EDGE * 2);
    }
  });

  it('matches the width the bar turns to pictures at in the stylesheet', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(`${process.cwd()}/src/styles.css`, 'utf8');
    expect(css).toContain(`.fb-ui[data-compact='true'] .fb-hud .key-open,`);
    expect(css).toContain("    padding: 8px 0;\n}\n\n.fb-ui[data-compact='true'] .fb-hud .key-mode,");
    expect(css).toContain(".fb-ui[data-compact='true'] .fb-hud .key-moves {\n    width: var(--fb-compact-key-width);\n    min-width: var(--fb-compact-key-width);\n    padding: 0;\n}");
  });

  it('keeps the flip key in a centered slot for native and both fallback bar sizes', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(`${process.cwd()}/src/styles.css`, 'utf8');
    expect(css).toContain('.well-flip-slot');
    expect(css).toContain("left: calc(50% - 65px);");
    expect(css).toContain(".fb-ui[data-compact='false'] .fb-hud .key-flip-slot");
    expect(css).toContain(".fb-ui[data-compact='true'] .fb-hud .key-flip-slot");
    expect(css).toContain('key-flyover-compact-slot');
    expect(css).not.toContain('.bar-hint');
  });
});
