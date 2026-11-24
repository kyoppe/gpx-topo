import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installFallbackPaint } from './fallbackPaint';
import type { HtmlInCanvasElement, PaintEvent } from './htmlInCanvas';

let frames: FrameRequestCallback[] = [];

beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function scene() {
  const stage = document.createElement('div');
  const canvas = document.createElement('canvas') as HtmlInCanvasElement;
  const page = document.createElement('div');
  const terrain = document.createElement('div');
  terrain.dataset.piece = 'terrain';
  const drawing = document.createElement('canvas');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  terrain.append(drawing, svg);
  const sheet = document.createElement('div');
  sheet.dataset.piece = 'sheet';
  page.append(sheet, terrain);
  stage.append(page);
  document.body.append(canvas, stage);
  const painted: PaintEvent[] = [];
  canvas.addEventListener('paint', (event) => painted.push(event as PaintEvent));
  const ctx = { drawImage: vi.fn(), clearRect: vi.fn(), save: vi.fn(), canvas: drawing, lineWidth: 1 };
  vi.spyOn(drawing, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  const flush = () => {
    const pending = frames.splice(0);
    for (const cb of pending) cb(0);
  };
  return { canvas, page, sheet, terrain, drawing, painted, flush, ctx };
}

const tick = () => Promise.resolve();

describe('installFallbackPaint', () => {
  it('answers requestPaint with one paint event for every piece the first time', () => {
    const { canvas, page, sheet, terrain, painted, flush } = scene();
    installFallbackPaint(canvas, page);

    canvas.requestPaint();
    canvas.requestPaint();
    expect(painted).toHaveLength(0);
    flush();

    expect(painted).toHaveLength(1);
    expect(painted[0].changedElements).toEqual(expect.arrayContaining([sheet, terrain]));
    canvas.requestPaint();
    flush();
    expect(painted[1].changedElements).toEqual([]);
  });

  it('reports the piece whose DOM changed', async () => {
    const { canvas, page, sheet, painted, flush } = scene();
    installFallbackPaint(canvas, page);
    canvas.requestPaint();
    flush();

    sheet.setAttribute('class', 'changed');
    await tick();
    flush();

    expect(painted[1].changedElements).toEqual([sheet]);
  });

  it('reports a canvas piece after something is drawn into its 2D context, and not for a read', () => {
    const { canvas, page, terrain, drawing, painted, flush, ctx } = scene();
    installFallbackPaint(canvas, page);
    canvas.requestPaint();
    flush();

    const context = drawing.getContext('2d')!;
    context.save();
    flush();
    expect(painted).toHaveLength(1);

    context.drawImage(document.createElement('canvas'), 0, 0);
    flush();
    expect(ctx.drawImage).toHaveBeenCalledOnce();
    expect(painted[1].changedElements).toEqual([terrain]);
  });

  it('marks the pieces that draw a route when the page style changes', async () => {
    const { canvas, page, terrain, painted, flush } = scene();
    installFallbackPaint(canvas, page);
    canvas.requestPaint();
    flush();

    page.style.setProperty('--route-line-width', '3');
    await tick();
    flush();

    expect(painted[1].changedElements).toEqual([terrain]);
  });

  it('stops answering and restores the canvas when disposed', () => {
    const { canvas, page, drawing, painted, flush } = scene();
    const original = drawing.getContext;
    const paint = installFallbackPaint(canvas, page);
    expect(drawing.getContext).not.toBe(original);

    paint.dispose();
    expect(drawing.getContext).toBe(original);
    expect((canvas as Partial<HtmlInCanvasElement>).requestPaint).toBeUndefined();
    flush();
    expect(painted).toHaveLength(0);
  });

  it('repaints every piece when a class changes on an ancestor of the stage (photo-route-overlay sits on the app root)', async () => {
    const { canvas, page, sheet, terrain, painted, flush } = scene();
    const root = document.createElement('main');
    root.append(page.parentElement!);
    document.body.append(root);
    installFallbackPaint(canvas, page);
    canvas.requestPaint();
    flush();

    root.classList.add('photo-route-overlay');
    await tick();
    flush();

    expect(painted).toHaveLength(2);
    expect(painted[1].changedElements).toEqual(expect.arrayContaining([sheet, terrain]));
  });

  it('ignores other attributes on an ancestor', async () => {
    const { canvas, page, painted, flush } = scene();
    const root = document.createElement('main');
    root.append(page.parentElement!);
    document.body.append(root);
    installFallbackPaint(canvas, page);
    canvas.requestPaint();
    flush();

    root.setAttribute('lang', 'ja');
    await tick();
    canvas.requestPaint();
    flush();

    expect(painted[1].changedElements).toEqual([]);
  });
});
