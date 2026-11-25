import { describe, expect, it } from 'vitest';

import { isContourInk, maxZoomForStyle, stripRelief } from './basemap';

const W = 48;
const H = 48;

function blank() {
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  return { data, width: W, height: H, colorSpace: 'srgb' } as ImageData;
}
function put(img: ImageData, x: number, y: number, rgb: readonly [number, number, number]) {
  const i = (y * W + x) * 4;
  img.data[i] = rgb[0];
  img.data[i + 1] = rgb[1];
  img.data[i + 2] = rgb[2];
}
const at = (img: ImageData, x: number, y: number) => {
  const i = (y * W + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};
const WHITE = [255, 255, 255];
/** a caret like the conifer mark, 5 x 6 px */
function caret(img: ImageData, x: number, y: number, rgb: readonly [number, number, number]) {
  for (let k = 0; k < 6; k += 1) {
    put(img, x + 2 - Math.floor(k / 3), y + k, rgb);
    put(img, x + 2 + Math.floor(k / 3), y + k, rgb);
  }
}

describe('base map zoom limits', () => {
  it('caps the GSI blank map at its available zoom while keeping existing styles unchanged', () => {
    expect(maxZoomForStyle('blank')).toBe(14);
    expect(maxZoomForStyle('std')).toBe(18);
    expect(maxZoomForStyle('pale')).toBe(18);
    expect(maxZoomForStyle('photo')).toBe(18);
    expect(maxZoomForStyle('photoNames')).toBe(18);
  });
});

describe('pale map contour inks', () => {
  it('knows the contour colours and their blends with white', () => {
    expect(isContourInk(200, 160, 60)).toBe(true);
    expect(isContourInk(227, 207, 157)).toBe(true);
    expect(isContourInk(255, 220, 150)).toBe(true);
    expect(isContourInk(254, 235, 198)).toBe(true);
    expect(isContourInk(151, 111, 10)).toBe(true);
    // small-zoom labels
    expect(isContourInk(255, 238, 162)).toBe(true);
  });

  it('leaves water, roads, text, and the expressway alone', () => {
    expect(isContourInk(190, 210, 255)).toBe(false);
    expect(isContourInk(105, 150, 255)).toBe(false);
    expect(isContourInk(100, 100, 100)).toBe(false);
    expect(isContourInk(0, 0, 0)).toBe(false);
    expect(isContourInk(255, 255, 255)).toBe(false);
    expect(isContourInk(150, 200, 150)).toBe(false);
  });
});

describe('stripping the relief off a pale tile', () => {
  it('takes out contour lines', () => {
    const img = blank();
    for (let x = 0; x < W; x += 1) put(img, x, 20, [200, 160, 60]);
    stripRelief(img);
    expect(at(img, 10, 20)).toEqual(WHITE);
  });

  it('takes out a lone grey vegetation mark, even a faint one', () => {
    const img = blank();
    caret(img, 10, 10, [100, 100, 100]);
    caret(img, 30, 30, [184, 184, 184]);
    stripRelief(img);
    expect(at(img, 12, 10)).toEqual(WHITE);
    expect(at(img, 32, 30)).toEqual(WHITE);
  });

  it('keeps text, dashes, marks near other ink, marks cut by the edge, and ponds', () => {
    const img = blank();
    caret(img, 6, 6, [0, 0, 0]);
    for (let x = 20; x < 28; x += 1) put(img, x, 8, [100, 100, 100]);
    caret(img, 6, 24, [100, 100, 100]);
    put(img, 11, 26, [0, 0, 0]);
    caret(img, 40, H - 6, [100, 100, 100]);
    for (let y = 30; y < 34; y += 1) for (let x = 30; x < 34; x += 1) put(img, x, y, [190, 210, 255]);
    stripRelief(img);
    expect(at(img, 8, 6)).toEqual([0, 0, 0]);
    expect(at(img, 24, 8)).toEqual([100, 100, 100]);
    expect(at(img, 8, 24)).toEqual([100, 100, 100]);
    expect(at(img, 42, H - 6)).toEqual([100, 100, 100]);
    expect(at(img, 31, 31)).toEqual([190, 210, 255]);
  });

  it('still takes out a mark that a contour ran through', () => {
    const img = blank();
    for (let x = 0; x < W; x += 1) put(img, x, 13, [200, 160, 60]);
    caret(img, 20, 10, [100, 100, 100]);
    stripRelief(img);
    expect(at(img, 5, 13)).toEqual(WHITE);
    expect(at(img, 22, 10)).toEqual(WHITE);
  });
});
