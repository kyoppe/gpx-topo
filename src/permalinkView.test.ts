import { describe, expect, it } from 'vitest';

import { pageFit } from './engine';
import { fallbackLayoutFor } from './fallbackLayout';
import { fromPermalinkView, mapCenterOffset, toPermalinkView, type PermalinkFrame } from './permalinkView';

// The native page: the map on the left, a 400px panel on the right, 20px round everything (App.tsx `layoutFor`).
function nativeFrame(width: number, height: number): PermalinkFrame {
  const pageWidth = Math.max(1080, Math.round(width - 40));
  const pageHeight = Math.max(640, Math.round(height - 120));
  return {
    pageWidth,
    pageHeight,
    mapX: 20,
    mapY: 20,
    mapWidth: pageWidth - 400 - 60,
    mapHeight: pageHeight - 40,
    fit: pageFit(width, height, pageWidth, pageHeight),
  };
}

function fallbackFrame(width: number, height: number): PermalinkFrame {
  const layout = fallbackLayoutFor(width, height);
  return { ...layout, fit: pageFit(width, height, layout.pageWidth, layout.pageHeight) };
}

describe('mapCenterOffset', () => {
  it('puts the native map centre left of the page centre by half the panel, and the fallback map on it', () => {
    expect(mapCenterOffset(nativeFrame(1502, 829))).toEqual({ x: -210, y: 0 });
    expect(mapCenterOffset(fallbackFrame(402, 874))).toEqual({ x: 0, y: 0 });
  });
});

describe('toPermalinkView / fromPermalinkView', () => {
  // A real permalink from the native page (window 1502 x 829): the map frame is 1002 x 669.
  const native = nativeFrame(1502, 829);
  const nativePan = { x: -206.363, y: -195.535, z: 72.781 };
  const nativeScale = 5356.0946;

  it('saves the area and the pan from the map centre', () => {
    const saved = toPermalinkView(native, nativeScale, nativePan);
    expect(native.mapWidth).toBe(1002);
    expect(native.mapHeight).toBe(669);
    expect(saved.area).toEqual({ width: 1002, height: 669, scale: nativeScale });
    // the camera was looking about at the map centre sideways (the pan cancels the half panel)
    expect(saved.pan.x).toBeCloseTo(3.637, 3);
    expect(saved.pan.y).toBeCloseTo(-195.535, 3);
    expect(saved.pan.z).toBeCloseTo(72.781, 3);
  });

  it('opens the same view in the same window', () => {
    const saved = toPermalinkView(native, nativeScale, nativePan);
    const opened = fromPermalinkView(native, saved.area, saved.pan);
    expect(opened.scale).toBeCloseTo(nativeScale, 6);
    expect(opened.pan?.x).toBeCloseTo(nativePan.x, 6);
    expect(opened.pan?.y).toBeCloseTo(nativePan.y, 6);
    expect(opened.pan?.z).toBeCloseTo(nativePan.z, 6);
  });

  it('opens a native permalink in a tall fallback window looking at the same place, not 100px to the side', () => {
    const saved = toPermalinkView(native, nativeScale, nativePan);
    const phone = fallbackFrame(402, 874);
    const opened = fromPermalinkView(phone, saved.area, saved.pan);
    // the map frame is 338 wide here against 1002: the width decides
    const ratio = (402 - 40 - 24) / 1002;
    expect(opened.scale).toBeCloseTo(nativeScale * ratio, 3);
    // the point looked at keeps its place in the frame, from the map centre
    expect(opened.pan?.x).toBeCloseTo(3.637 * ratio, 3);
    expect(opened.pan?.y).toBeCloseTo(-195.535 * ratio, 3);
    expect(opened.pan?.z).toBeCloseTo(72.781 * ratio, 3);
  });

  it('keeps the view when a fallback permalink is opened in the native window', () => {
    const phone = fallbackFrame(402, 874);
    const pan = { x: 1.9, y: -102.6, z: 38.2 };
    const saved = toPermalinkView(phone, 2811.6824, pan);
    const opened = fromPermalinkView(native, saved.area, saved.pan);
    // the saved frame is 338 x 730: the native frame is wider, so the height decides
    const ratio = 669 / 730;
    expect(opened.scale).toBeCloseTo(2811.6824 * ratio, 3);
    // 210px of the panel (scaled) are put back on the pan
    expect(opened.pan?.x).toBeCloseTo(1.9 * ratio - 210, 3);
    expect(opened.pan?.y).toBeCloseTo(-102.6 * ratio, 3);
  });

  it('takes the page fit into account: a window narrower than the page shrinks it on screen', () => {
    const narrow = nativeFrame(900, 700);
    expect(narrow.fit).toBeLessThan(0.8);
    const pan = { x: 50, y: 20, z: 5 };
    const saved = toPermalinkView(narrow, 4000, pan);
    // the same window gives the same view back
    const same = fromPermalinkView(narrow, saved.area, saved.pan);
    expect(same.scale).toBeCloseTo(4000, 6);
    expect(same.pan?.x).toBeCloseTo(50, 6);
    expect(same.pan?.y).toBeCloseTo(20, 6);
    expect(same.pan?.z).toBeCloseTo(5, 6);
    // a window that shows the page whole (fit 1) needs a map scale in proportion to the screen size it had
    const whole = fromPermalinkView(native, saved.area, saved.pan);
    expect(whole.scale * native.fit).toBeCloseTo(4000 * narrow.fit * Math.min((native.mapWidth * native.fit) / saved.area.width, (native.mapHeight * native.fit) / saved.area.height), 6);
  });

  it('leaves out the pan when the permalink has none', () => {
    const saved = toPermalinkView(native, nativeScale, nativePan);
    expect(fromPermalinkView(native, saved.area, null).pan).toBeNull();
  });
});
