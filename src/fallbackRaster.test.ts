import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRasterTextureSource, rasterizeElement } from './fallbackRaster';

const paths: string[] = [];

beforeEach(() => {
  paths.length = 0;
  vi.stubGlobal('Path2D', class { constructor(public d: string) { paths.push(d); } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function rect(el: Element, left: number, top: number, width: number, height: number) {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} });
}

function fakeContext() {
  const ctx = {
    clearRect: vi.fn(), fillRect: vi.fn(), drawImage: vi.fn(), save: vi.fn(), restore: vi.fn(),
    translate: vi.fn(), scale: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
    fillStyle: '', strokeStyle: '', lineWidth: 0, lineJoin: '', lineCap: '', globalAlpha: 1,
  };
  return ctx as typeof ctx & CanvasRenderingContext2D;
}

describe('rasterizeElement', () => {
  it('paints the background, scaled child canvases, and SVG routes', () => {
    const root = document.createElement('div');
    root.style.backgroundColor = 'rgb(238, 237, 233)';
    const child = document.createElement('canvas');
    child.width = 10;
    child.height = 10;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 50');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M0 0L100 50');
    path.style.stroke = 'rgb(255, 0, 0)';
    path.style.strokeWidth = '4px';
    path.style.fill = 'none';
    svg.append(path);
    root.append(child, svg);
    document.body.append(root);
    rect(root, 100, 50, 200, 100);
    rect(child, 100, 50, 200, 100);
    rect(svg, 100, 50, 200, 100);

    const ctx = fakeContext();
    rasterizeElement(ctx, root, 400, 200);

    expect(ctx.fillStyle).toBe('rgb(238, 237, 233)');
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 400, 200);
    expect(ctx.drawImage).toHaveBeenCalledWith(child, 0, 0, 400, 200);
    // a 100 x 50 view box fits a 400 x 200 box at scale 4, and the stroke keeps its view box width
    expect(ctx.scale).toHaveBeenCalledWith(4, 4);
    expect(ctx.lineWidth).toBe(4);
    expect(ctx.strokeStyle).toBe('rgb(255, 0, 0)');
    expect(ctx.stroke).toHaveBeenCalledOnce();
    expect(ctx.fill).not.toHaveBeenCalled();
    expect(paths).toEqual(['M0 0L100 50']);
  });

  it('skips hidden children and an element with no size', () => {
    const root = document.createElement('div');
    const hidden = document.createElement('canvas');
    hidden.width = 4;
    hidden.height = 4;
    hidden.style.display = 'none';
    root.append(hidden);
    document.body.append(root);
    rect(root, 0, 0, 10, 10);
    rect(hidden, 0, 0, 10, 10);
    const ctx = fakeContext();
    rasterizeElement(ctx, root, 10, 10);
    expect(ctx.drawImage).not.toHaveBeenCalled();

    const empty = document.createElement('div');
    document.body.append(empty);
    rect(empty, 0, 0, 0, 0);
    const blank = fakeContext();
    rasterizeElement(blank, empty, 10, 10);
    expect(blank.clearRect).toHaveBeenCalled();
    expect(blank.fillRect).not.toHaveBeenCalled();
  });
});

describe('createRasterTextureSource', () => {
  it('uploads the rasterized picture with texImage2D, not texElementSubImage2D', () => {
    const ctx = fakeContext();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
    const gl = { TEXTURE_2D: 1, RGBA8: 2, RGBA: 3, UNSIGNED_BYTE: 4, texImage2D: vi.fn() } as unknown as WebGL2RenderingContext;
    const el = document.createElement('div');
    document.body.append(el);
    rect(el, 0, 0, 10, 10);

    const source = createRasterTextureSource();
    source.upload(gl, el, 20, 20);

    expect(gl.texImage2D).toHaveBeenCalledWith(1, 0, 2, 3, 4, expect.any(HTMLCanvasElement));
    expect(source.failure).toBe('Fallback texture upload failed.');
    const scratch = (vi.mocked(gl.texImage2D).mock.calls[0] as unknown[])[5] as HTMLCanvasElement;
    expect([scratch.width, scratch.height]).toEqual([20, 20]);
  });

  it('fails clearly when no 2D canvas is available', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const gl = { texImage2D: vi.fn() } as unknown as WebGL2RenderingContext;
    expect(() => createRasterTextureSource().upload(gl, document.createElement('div'), 4, 4)).toThrow('2D canvas is unavailable.');
    expect(gl.texImage2D).not.toHaveBeenCalled();
  });
});
