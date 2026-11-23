import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEngine, type Engine, type EngineCallbacks, type EngineModel } from './engine';
import type { HtmlInCanvasElement } from './htmlInCanvas';
import { createRenderer } from './renderer';

vi.mock('./renderer', () => ({ createRenderer: vi.fn() }));

const model: EngineModel = {
  pageWidth: 1200, pageHeight: 700,
  mapX: 20, mapY: 20, mapWidth: 660, mapHeight: 660,
  terrain: null, route: [], ways: [], marks: [],
  date: '2026-11-23', lat: 35, lon: 139, mapStyle: 'pale',
  mapMode: false, sunlightEnabled: true,
  profilePoint: () => [0, 0], profileKm: () => 0,
};

const engines: Engine[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
});

afterEach(() => {
  for (const engine of engines.splice(0)) engine.dispose();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup(width = 100) {
  const renderer = {
    layer: vi.fn(() => ({ tex: {}, w: 0, h: 0, ready: false })),
    deleteLayer: vi.fn(), setMesh: vi.fn(), clearTerrain: vi.fn(),
    upload: vi.fn(), draw: vi.fn(), dispose: vi.fn(), maxTexture: 4096,
  };
  vi.mocked(createRenderer).mockReturnValue(renderer as unknown as ReturnType<typeof createRenderer>);
  const stage = document.createElement('div');
  const canvas = document.createElement('canvas') as HtmlInCanvasElement;
  canvas.requestPaint = vi.fn();
  const page = document.createElement('div');
  const piece = document.createElement('div');
  piece.dataset.piece = 'sheet';
  Object.defineProperties(piece, { offsetWidth: { value: width }, offsetHeight: { value: 100 } });
  page.append(piece);
  stage.append(canvas, page);
  document.body.append(stage);
  const callbacks: EngineCallbacks = {
    onFirstPaint: vi.fn(), onApartChange: vi.fn(), onRouteClick: vi.fn(),
    onMapDrag: vi.fn(), onMapPan: vi.fn(),
    onDetail: vi.fn(), onTimeCommit: vi.fn(), onPopClosed: vi.fn(),
    onFlightChange: vi.fn(), onInfoChange: vi.fn(), onPhotoChange: vi.fn(),
  };
  const engine = createEngine(canvas, page, callbacks);
  engines.push(engine);
  const paint = () => canvas.dispatchEvent(Object.assign(new Event('paint'), { changedElements: [piece] }));
  return { engine, renderer, callbacks, paint };
}

describe('first HTML-in-Canvas paint', () => {
  it('waits for a paint event with an upload, even when fallback frames run', () => {
    const { engine, renderer, callbacks, paint } = setup();
    expect(callbacks.onFirstPaint).not.toHaveBeenCalled();
    paint(); // No model or measured elements yet.
    engine.setModel(model);
    vi.advanceTimersByTime(100);

    expect(renderer.draw).toHaveBeenCalled();
    expect(renderer.upload).not.toHaveBeenCalled();
    expect(callbacks.onFirstPaint).not.toHaveBeenCalled();

    paint();
    expect(renderer.upload).toHaveBeenCalled();
    expect(callbacks.onFirstPaint).toHaveBeenCalledOnce();
    expect(renderer.upload.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(callbacks.onFirstPaint).mock.invocationCallOrder[0]);
  });

  it('retries a failed upload and reports success once per engine', () => {
    const { engine, renderer, callbacks, paint } = setup();
    engine.setModel(model);
    renderer.upload.mockImplementationOnce(() => { throw new Error('No snapshot yet'); });
    paint();
    expect(callbacks.onFirstPaint).not.toHaveBeenCalled();

    paint();
    paint();
    engine.setModel(model);
    paint();
    expect(callbacks.onFirstPaint).toHaveBeenCalledOnce();

    const next = setup();
    next.engine.setModel(model);
    next.paint();
    expect(next.callbacks.onFirstPaint).toHaveBeenCalledOnce();
  });

  it('does not report a paint without any eligible texture upload', () => {
    const { engine, renderer, callbacks, paint } = setup(0);
    engine.setModel(model);
    paint();
    expect(renderer.upload).not.toHaveBeenCalled();
    expect(callbacks.onFirstPaint).not.toHaveBeenCalled();
  });

  it('does not report paints after disposal', () => {
    const { engine, renderer, callbacks, paint } = setup();
    engine.setModel(model);
    engine.dispose();
    engines.pop();
    paint();
    vi.advanceTimersByTime(100);
    expect(renderer.upload).not.toHaveBeenCalled();
    expect(callbacks.onFirstPaint).not.toHaveBeenCalled();
  });
});
