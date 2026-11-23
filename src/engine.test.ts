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
    constructor(private callback: ResizeObserverCallback) {}
    observe() {
      this.callback([{} as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
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
  canvas.setPointerCapture = vi.fn();
  Object.defineProperties(canvas, { clientWidth: { value: 1200 }, clientHeight: { value: 800 } });
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
    onCameraRotate: vi.fn(), onCameraPan: vi.fn(), onCameraZoom: vi.fn(),
    onDetail: vi.fn(), onTimeCommit: vi.fn(), onPopClosed: vi.fn(),
    onFlightChange: vi.fn(), onMapManeuverChange: vi.fn(), onInfoChange: vi.fn(), onPhotoChange: vi.fn(),
  };
  const engine = createEngine(canvas, page, callbacks);
  engines.push(engine);
  const paint = () => canvas.dispatchEvent(Object.assign(new Event('paint'), { changedElements: [piece] }));
  return { engine, renderer, callbacks, paint, canvas, page };
}

function pointer(target: EventTarget, type: string, x = 600, y = 400, options: Partial<PointerEvent> = {}) {
  const event = Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
    clientX: x, clientY: y, button: 0, pointerId: 1, ...options,
  });
  target.dispatchEvent(event);
}

function wheel(target: EventTarget, deltaY: number, options: WheelEventInit = {}) {
  target.dispatchEvent(new WheelEvent('wheel', {
    bubbles: true, cancelable: true, clientX: 600, clientY: 400, deltaY, ...options,
  }));
}

function cameraSetup(pose: { e?: number; yaw?: number; tilt?: number; zoom?: number } = { e: 1 }) {
  const scene = setup();
  scene.engine.setModel(model);
  // Use the same pose control as the browser's engine checks, without animation delays.
  const debug = (window as unknown as { __gpxTopo: {
    pose(value: typeof pose): void;
    st: { yawT: number; tiltT: number; zoomT: number; panT: number[] };
  } }).__gpxTopo;
  debug.pose(pose);
  scene.paint();
  return { ...scene, debug };
}

describe('camera gesture completion', () => {
  it('reports rotation and tilt once on release, including duration and reversals', () => {
    const { canvas, callbacks } = cameraSetup();
    pointer(canvas, 'pointerdown');
    vi.advanceTimersByTime(100);
    pointer(canvas, 'pointermove', 700, 420);
    vi.advanceTimersByTime(200);
    pointer(canvas, 'pointermove', 600, 400);
    expect(callbacks.onCameraRotate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    pointer(canvas, 'pointerup');
    pointer(canvas, 'pointerup');

    expect(callbacks.onCameraRotate).toHaveBeenCalledOnce();
    const [change] = vi.mocked(callbacks.onCameraRotate).mock.calls[0];
    expect(change.delta_heading_deg).toBeCloseTo(0);
    expect(change.delta_pitch_deg).toBeCloseTo(0);
    expect(change.total_heading_deg).toBeCloseTo(1.1 * 180 / Math.PI);
    expect(change.total_pitch_deg).toBeCloseTo(0.18 * 180 / Math.PI);
    expect(change.duration_ms).toBe(350);
    expect(callbacks.onCameraPan).not.toHaveBeenCalled();
    expect(callbacks.onCameraZoom).not.toHaveBeenCalled();
  });

  it('keeps full turns across animation yaw normalization', () => {
    const { canvas, callbacks, paint } = cameraSetup();
    pointer(canvas, 'pointerdown');
    pointer(canvas, 'pointermove', 2600);
    paint(); // Normalizes the target yaw by whole turns.
    pointer(canvas, 'pointermove', 4600);
    pointer(canvas, 'pointerup', 4600);
    const [change] = vi.mocked(callbacks.onCameraRotate).mock.calls[0];
    expect(change.delta_heading_deg).toBeCloseTo(-22 * 180 / Math.PI);
    expect(change.total_heading_deg).toBeCloseTo(22 * 180 / Math.PI);
  });

  it('measures applied tilt after clamping and ignores drags blocked by the tilt limit', () => {
    const { canvas, callbacks } = cameraSetup();
    pointer(canvas, 'pointerdown');
    pointer(canvas, 'pointermove', 600, -10_000);
    pointer(canvas, 'pointermove', 600, -20_000);
    pointer(canvas, 'pointerup');
    const [change] = vi.mocked(callbacks.onCameraRotate).mock.calls[0];
    expect(change.delta_pitch_deg).toBeCloseTo((1.45 - 0.99) * 180 / Math.PI);
    expect(change.total_pitch_deg).toBeCloseTo(change.delta_pitch_deg);

    pointer(canvas, 'pointerdown');
    pointer(canvas, 'pointermove', 600, -10_000);
    pointer(canvas, 'pointerup');
    expect(callbacks.onCameraRotate).toHaveBeenCalledOnce();
  });

  it.each([{ button: 2 }, { button: 1 }, { shiftKey: true }])(
    'reports bounded model translation for pan input %o',
    (options) => {
      const { canvas, callbacks, debug } = cameraSetup();
      pointer(canvas, 'pointerdown', 600, 400, options);
      vi.advanceTimersByTime(125);
      pointer(canvas, 'pointermove', 620, 410);
      const expected = [...debug.st.panT];
      expect(callbacks.onCameraPan).not.toHaveBeenCalled();
      vi.advanceTimersByTime(75);
      pointer(canvas, 'pointerup', 620, 410);

      expect(callbacks.onCameraPan).toHaveBeenCalledExactlyOnceWith({
        delta_x_px: expected[0], delta_y_px: expected[1], delta_z_px: expected[2],
        distance_px: Math.hypot(...expected), duration_ms: 200,
      });
      expect(Math.hypot(...expected)).toBeGreaterThan(0);
      expect(callbacks.onCameraRotate).not.toHaveBeenCalled();
      expect(callbacks.onMapPan).not.toHaveBeenCalled();
    },
  );

  it('retains pan distance when movement reverses and respects camera bounds', () => {
    const { canvas, callbacks, debug } = cameraSetup();
    pointer(canvas, 'pointerdown', 600, 400, { button: 2 });
    pointer(canvas, 'pointermove', 100_000, 400);
    const outward = [...debug.st.panT];
    pointer(canvas, 'pointermove', 200_000, 400);
    expect(debug.st.panT).toEqual(outward);
    pointer(canvas, 'pointermove');
    const returned = [...debug.st.panT];
    pointer(canvas, 'pointerup');
    const [change] = vi.mocked(callbacks.onCameraPan).mock.calls[0];
    expect(change.delta_x_px).toBeCloseTo(0);
    expect(change.delta_y_px).toBeCloseTo(0);
    expect(change.delta_z_px).toBeCloseTo(returned[2]);
    // Bounds also adjust the camera's vertical offset on the first step.
    const back = returned.map((v, i) => v - outward[i]);
    expect(change.distance_px).toBeCloseTo(Math.hypot(...outward) + Math.hypot(...back));
    expect(change.distance_px).toBeGreaterThan(Math.hypot(...returned));
  });

  it('ignores hover, clicks, and camera animations', () => {
    const { canvas, callbacks, engine, paint } = cameraSetup();
    pointer(canvas, 'pointermove');
    pointer(canvas, 'pointerdown');
    pointer(canvas, 'pointerup');
    pointer(canvas, 'pointerdown', 600, 400, { button: 2 });
    pointer(canvas, 'pointerup');
    engine.together();
    paint();
    engine.apart(1);
    vi.advanceTimersByTime(1000);
    expect(callbacks.onCameraRotate).not.toHaveBeenCalled();
    expect(callbacks.onCameraPan).not.toHaveBeenCalled();
    expect(callbacks.onCameraZoom).not.toHaveBeenCalled();
  });

  it.each(['pointercancel', 'lostpointercapture'])('discards a drag on %s and resets for the next one', (end) => {
    const { canvas, callbacks } = cameraSetup();
    pointer(canvas, 'pointerdown');
    pointer(canvas, 'pointermove', 620);
    pointer(canvas, end);
    pointer(canvas, 'pointerup');
    expect(callbacks.onCameraRotate).not.toHaveBeenCalled();

    pointer(canvas, 'pointerdown');
    pointer(canvas, 'pointermove', 620);
    pointer(canvas, 'pointerup');
    expect(callbacks.onCameraRotate).toHaveBeenCalledOnce();
  });

  it('ignores another pointer while a camera drag is active', () => {
    const { canvas, callbacks } = cameraSetup();
    pointer(canvas, 'pointerdown');
    pointer(canvas, 'pointermove', 620);
    pointer(canvas, 'pointerdown', 500, 300, { pointerId: 2 });
    pointer(canvas, 'pointermove', 1000, 800, { pointerId: 2 });
    pointer(canvas, 'pointerup', 1000, 800, { pointerId: 2 });
    expect(callbacks.onCameraRotate).not.toHaveBeenCalled();
    pointer(canvas, 'pointerup', 620);
    expect(callbacks.onCameraRotate).toHaveBeenCalledOnce();
    expect(vi.mocked(callbacks.onCameraRotate).mock.calls[0][0].total_heading_deg).toBeCloseTo(0.11 * 180 / Math.PI);
  });

  it.each([false, true])('groups wheel events into one zoom completion (pinch=%s)', (ctrlKey) => {
    const { canvas, callbacks, debug } = cameraSetup();
    wheel(canvas, -20, { ctrlKey });
    vi.advanceTimersByTime(100);
    wheel(canvas, -30, { ctrlKey });
    vi.advanceTimersByTime(199);
    expect(callbacks.onCameraZoom).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    const expectedZoom = Math.exp(50 * (ctrlKey ? 0.012 : 0.0022));
    expect(debug.st.zoomT).toBeCloseTo(expectedZoom);
    expect(callbacks.onCameraZoom).toHaveBeenCalledExactlyOnceWith({
      input: ctrlKey ? 'pinch' : 'wheel', start_zoom: 1, end_zoom: debug.st.zoomT,
      delta_zoom: debug.st.zoomT - 1, total_zoom_change: debug.st.zoomT - 1,
      duration_ms: 100,
    });
    // Zooming towards the pointer also adjusts pan/tilt; these are not new gestures.
    expect(callbacks.onCameraPan).not.toHaveBeenCalled();
    expect(callbacks.onCameraRotate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(callbacks.onCameraZoom).toHaveBeenCalledOnce();
  });

  it('keeps absolute zoom change across reversals and starts a fresh gesture after idle', () => {
    const { canvas, callbacks, debug } = cameraSetup({ e: 1, zoom: 2 });
    wheel(canvas, -100);
    const peak = debug.st.zoomT;
    vi.advanceTimersByTime(100);
    wheel(canvas, 100);
    vi.advanceTimersByTime(200);
    const [change] = vi.mocked(callbacks.onCameraZoom).mock.calls[0];
    expect(change.delta_zoom).toBeCloseTo(0);
    expect(change.total_zoom_change).toBeCloseTo(2 * (peak - 2));

    vi.advanceTimersByTime(1);
    wheel(canvas, -10, { deltaMode: 1 });
    vi.advanceTimersByTime(200);
    expect(callbacks.onCameraZoom).toHaveBeenCalledTimes(2);
    expect(vi.mocked(callbacks.onCameraZoom).mock.calls[1][0].start_zoom).toBeCloseTo(2);
    expect(debug.st.zoomT).toBeCloseTo(2 * Math.exp(300 * 0.0022));
  });

  it('waits for wheel idle even when the gesture reaches the zoom cap', () => {
    const { canvas, callbacks } = cameraSetup();
    wheel(canvas, -10_000);
    for (let i = 0; i < 3; i += 1) {
      vi.advanceTimersByTime(150);
      wheel(canvas, -100);
      expect(callbacks.onCameraZoom).not.toHaveBeenCalled();
    }
    vi.advanceTimersByTime(200);
    expect(callbacks.onCameraZoom).toHaveBeenCalledExactlyOnceWith({
      input: 'wheel', start_zoom: 1, end_zoom: 8, delta_zoom: 7,
      total_zoom_change: 7, duration_ms: 450,
    });

    wheel(canvas, -100);
    vi.advanceTimersByTime(200);
    expect(callbacks.onCameraZoom).toHaveBeenCalledOnce();
  });

  it('separates wheel and pinch input without including idle time in duration', () => {
    const { canvas, callbacks } = cameraSetup();
    wheel(canvas, -10);
    vi.advanceTimersByTime(50);
    wheel(canvas, -10, { ctrlKey: true });
    expect(callbacks.onCameraZoom).toHaveBeenCalledOnce();
    expect(vi.mocked(callbacks.onCameraZoom).mock.calls[0][0]).toMatchObject({ input: 'wheel', duration_ms: 0 });
    vi.advanceTimersByTime(200);
    expect(callbacks.onCameraZoom).toHaveBeenCalledTimes(2);
    expect(vi.mocked(callbacks.onCameraZoom).mock.calls[1][0]).toMatchObject({ input: 'pinch', duration_ms: 0 });
  });

  it('excludes wheel raising/lowering, scrollable controls, pickers, and zero-delta events', () => {
    const { canvas, callbacks, debug } = cameraSetup({ e: 0 });
    wheel(canvas, -100);
    vi.advanceTimersByTime(200);
    debug.pose({ e: 1 });
    wheel(canvas, 100);
    vi.advanceTimersByTime(200);
    debug.pose({ e: 1 });
    wheel(canvas, 0);
    const scroller = document.createElement('div');
    scroller.dataset.scroll = '';
    Object.defineProperties(scroller, { scrollHeight: { value: 300 }, clientHeight: { value: 100 } });
    canvas.append(scroller);
    wheel(scroller, -100);
    const picker = document.createElement('div');
    picker.dataset.popPart = 'body';
    canvas.append(picker);
    wheel(picker, -100);
    vi.advanceTimersByTime(500);
    expect(callbacks.onCameraZoom).not.toHaveBeenCalled();
  });

  it('leaves the flat-map drag callbacks unchanged and emits no camera actions', () => {
    const { canvas, callbacks, engine } = cameraSetup({ e: 0 });
    engine.setModel({ ...model, mapMode: true });
    pointer(canvas, 'pointerdown');
    pointer(canvas, 'pointermove', 620, 430);
    pointer(canvas, 'pointerup', 620, 430);
    expect(callbacks.onMapDrag).toHaveBeenCalledExactlyOnceWith(20, 30);
    expect(callbacks.onMapPan).toHaveBeenCalledExactlyOnceWith(20, 30);
    expect(callbacks.onCameraRotate).not.toHaveBeenCalled();
    expect(callbacks.onCameraPan).not.toHaveBeenCalled();
    expect(callbacks.onCameraZoom).not.toHaveBeenCalled();
  });

  it('discards pending camera gestures and removes listeners on disposal', () => {
    const { canvas, callbacks, engine } = cameraSetup();
    pointer(canvas, 'pointerdown');
    pointer(canvas, 'pointermove', 620);
    wheel(canvas, -10);
    engine.dispose();
    engines.pop();
    pointer(canvas, 'pointerup');
    wheel(canvas, -10);
    vi.advanceTimersByTime(1000);
    expect(callbacks.onCameraRotate).not.toHaveBeenCalled();
    expect(callbacks.onCameraZoom).not.toHaveBeenCalled();
  });
});

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
