import { describe, expect, it } from 'vitest';

import { FRAME_X, FRAME_Y } from './engine';
import { DOCK_WIDTH, FALLBACK_EDGE, FALLBACK_PAD, FALLBACK_PANEL_WIDTH, fallbackLayoutFor, isDocked, orientationOf, panelWidthFor } from './fallbackLayout';

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

  it('keeps the panel to its width, or a share of a narrow window', () => {
    expect(panelWidthFor(1366)).toBe(FALLBACK_PANEL_WIDTH);
    expect(panelWidthFor(390)).toBeLessThan(390);
    expect(panelWidthFor(390)).toBeGreaterThan(300);
  });
});
