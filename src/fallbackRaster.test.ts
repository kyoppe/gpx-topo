import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRasterTextureSource, FALLBACK_PIECE_KINDS, insetRings, rasterizeElement } from './fallbackRaster';

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
    beginPath: vi.fn(), roundRect: vi.fn(), clip: vi.fn(),
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

describe('route opacity', () => {
  function routeScene(setup: (svg: SVGSVGElement, path: SVGPathElement, root: HTMLElement) => void) {
    const root = document.createElement('div');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M0 0L100 100');
    path.style.stroke = 'rgb(255, 0, 0)';
    path.style.fill = 'none';
    svg.append(path);
    root.append(svg);
    document.body.append(root);
    setup(svg, path, root);
    rect(root, 0, 0, 100, 100);
    rect(svg, 0, 0, 100, 100);
    const ctx = fakeContext();
    const alphas: number[] = [];
    ctx.stroke.mockImplementation(() => { alphas.push(ctx.globalAlpha); });
    rasterizeElement(ctx, root, 100, 100);
    return { ctx, alphas };
  }

  it('does not draw a route whose opacity is 0 (the photo overlay hides it this way)', () => {
    const { ctx } = routeScene((_svg, path) => { path.style.opacity = '0'; });
    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  it('keeps a fractional opacity', () => {
    const { alphas } = routeScene((_svg, path) => { path.style.opacity = '0.4'; });
    expect(alphas).toEqual([0.4]);
  });

  it('applies stroke-opacity, as the route CSS sets 0.9', () => {
    const { alphas } = routeScene((_svg, path) => { path.style.strokeOpacity = '0.9'; });
    expect(alphas[0]).toBeCloseTo(0.9);
  });

  it('multiplies the opacity of the ancestors up to the piece', () => {
    const { alphas } = routeScene((svg, path) => {
      svg.style.opacity = '0.5';
      path.style.opacity = '0.5';
    });
    expect(alphas[0]).toBeCloseTo(0.25);
    const hidden = routeScene((svg) => { svg.style.opacity = '0'; });
    expect(hidden.ctx.stroke).not.toHaveBeenCalled();
  });
});

describe('insetRings', () => {
  it('reads an inset ring and ignores outer, shifted and blurred shadows', () => {
    expect(insetRings('none')).toEqual([]);
    expect(insetRings('rgb(255, 255, 255) 0px 0px 0px 3px inset, rgba(24, 32, 43, 0.3) 0px 0px 0px 1px')).toEqual([{ color: 'rgb(255, 255, 255)', spread: 3 }]);
    expect(insetRings('inset 0 0 0 2px #fff')).toEqual([{ color: '#fff', spread: 2 }]);
    expect(insetRings('rgb(0, 0, 0) 1px 0px 0px 2px inset')).toEqual([]);
    expect(insetRings('rgb(0, 0, 0) 0px 0px 4px 2px inset')).toEqual([]);
  });
});

describe('the runner dot', () => {
  it('is a piece the fallback draws', () => {
    expect(FALLBACK_PIECE_KINDS.has('hiker')).toBe(true);
  });

  it('is a filled circle with its white ring laid inside, scaled to the texture', () => {
    const dot = document.createElement('div');
    dot.style.backgroundColor = 'rgb(214, 59, 70)';
    for (const side of ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'] as const) dot.style[`border${side}Radius`] = '50%';
    dot.style.boxShadow = 'rgb(255, 255, 255) 0px 0px 0px 3px inset';
    document.body.append(dot);
    rect(dot, 0, 0, 16, 16);
    const ctx = Object.assign(fakeContext(), { rect: vi.fn() });
    const fills: string[] = [];
    ctx.fill.mockImplementation(() => { fills.push(ctx.fillStyle); });

    rasterizeElement(ctx, dot, 32, 32);

    const r = { x: 16, y: 16 };
    // the fill, then the ring: the whole circle and the circle 3px (6 texture px) in, filled even-odd
    expect(ctx.roundRect).toHaveBeenNthCalledWith(1, 0, 0, 32, 32, [r, r, r, r]);
    expect(ctx.roundRect).toHaveBeenNthCalledWith(2, 0, 0, 32, 32, [r, r, r, r]);
    expect(ctx.roundRect).toHaveBeenNthCalledWith(3, 6, 6, 20, 20, [{ x: 10, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 10 }]);
    expect(ctx.fill).toHaveBeenLastCalledWith('evenodd');
    expect(fills).toEqual(['rgb(214, 59, 70)', 'rgb(255, 255, 255)']);
  });
});

describe('rounded corners', () => {
  function sheetScene(setup: (root: HTMLElement) => void) {
    const root = document.createElement('div');
    root.style.backgroundColor = 'rgb(247, 247, 245)';
    setup(root);
    document.body.append(root);
    rect(root, 0, 0, 100, 50);
    const ctx = fakeContext();
    rasterizeElement(ctx, root, 200, 100);
    return { ctx, root };
  }
  const corners = (root: HTMLElement, value: string) => {
    for (const side of ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'] as const) root.style[`border${side}Radius`] = value;
  };

  it('keeps the transparent corners of a rounded sheet, scaled to the texture', () => {
    const { ctx } = sheetScene((root) => corners(root, '14px'));
    const r = { x: 28, y: 28 };
    expect(ctx.roundRect).toHaveBeenCalledWith(0, 0, 200, 100, [r, r, r, r]);
    expect(ctx.fill).toHaveBeenCalledOnce();
    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(ctx.fillStyle).toBe('rgb(247, 247, 245)');
  });

  it('reads each corner and elliptical radii, with percentages of the box', () => {
    const { ctx } = sheetScene((root) => {
      root.style.borderTopLeftRadius = '10px';
      root.style.borderTopRightRadius = '10%';
      root.style.borderBottomRightRadius = '4px 8px';
      root.style.borderBottomLeftRadius = '0px';
    });
    expect(ctx.roundRect).toHaveBeenCalledWith(0, 0, 200, 100, [
      { x: 20, y: 20 }, { x: 20, y: 10 }, { x: 8, y: 16 }, { x: 0, y: 0 },
    ]);
  });

  it('clips children to a rounded box that hides overflow', () => {
    const { ctx } = sheetScene((root) => { corners(root, '14px'); root.style.overflow = 'hidden'; });
    expect(ctx.clip).toHaveBeenCalledOnce();
  });

  it('fills a plain rectangle when no corner is rounded', () => {
    const { ctx } = sheetScene(() => {});
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 200, 100);
    expect(ctx.roundRect).not.toHaveBeenCalled();
  });
});
