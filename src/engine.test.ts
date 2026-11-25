import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEngine, fitsWithinScreenWidth, type Engine, type EngineCallbacks, type EngineModel, type EngineOptions } from './engine';
import type { HtmlInCanvasElement } from './htmlInCanvas';
import { createRenderer } from './renderer';
import { buildTerrain } from './terrain';

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

function setup(width = 100, options?: EngineOptions) {
  const renderer = {
    layer: vi.fn(() => ({ tex: {}, w: 0, h: 0, ready: false })),
    setTerrain: vi.fn(),
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
    onMapDrag: vi.fn(), onMapPan: vi.fn(), onMapDragBegin: vi.fn(), onMapDragCancel: vi.fn(),
    onCameraRotate: vi.fn(), onCameraPan: vi.fn(), onCameraZoom: vi.fn(),
    onDetail: vi.fn(), onTimeCommit: vi.fn(), onPopClosed: vi.fn(),
    onFlightChange: vi.fn(), onMapManeuverChange: vi.fn(), onInfoChange: vi.fn(), onPhotoChange: vi.fn(),
  };
  const engine = options ? createEngine(canvas, page, callbacks, options) : createEngine(canvas, page, callbacks);
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

function fpvSetup() {
  const scene = setup();
  scene.engine.setModel({
    ...model,
    mapMode: true,
    terrain: buildTerrain(
      { nx: 1, ny: 1, values: new Float32Array([100, 100, 100, 100]), source: 'gsi-dem' },
      model.mapWidth,
      model.mapHeight,
      1,
    ),
  });
  scene.engine.apart(1);
  scene.engine.startFpvAtMapPoint(model.mapWidth / 2, model.mapHeight / 2);
  vi.advanceTimersByTime(1000);
  return scene;
}

type DebugState = { eT: number; zoomT: number; yawT: number; tiltT: number; panT: number[] };

function touchScene(pose: { e?: number; zoom?: number } = {}, options: EngineOptions = { renderPath: 'fallback' }, mapMode = false) {
  const scene = setup(100, options);
  scene.engine.setModel({ ...model, mapMode });
  const debug = (window as unknown as { __gpxTopo: { pose(value: typeof pose): void; st: DebugState } }).__gpxTopo;
  debug.pose({ e: 0, zoom: 1, ...pose });
  scene.paint();
  const touch = (type: string, id: number, x: number, y: number) =>
    pointer(scene.canvas, type, x, y, { pointerId: id, pointerType: 'touch' });
  return { ...scene, debug, st: debug.st, touch };
}

describe('fallback touch gestures', () => {
  it('pinching out raises a flat page, and what the rise does not use goes on into the zoom', () => {
    const { touch, st } = touchScene();
    touch('pointerdown', 1, 500, 400);
    touch('pointerdown', 2, 700, 400);
    touch('pointermove', 1, 400, 400);
    touch('pointermove', 2, 800, 400);
    // twice the spread: ln 2 = 0.69 of the rise, and no zoom yet
    expect(st.eT).toBeCloseTo(Math.log(2), 3);
    expect(st.zoomT).toBe(1);
    touch('pointermove', 1, 200, 400);
    touch('pointermove', 2, 1000, 400);
    expect(st.eT).toBe(1);
    expect(st.zoomT).toBeGreaterThan(1.3);
  });

  it('pinching in zooms out first, then lowers the model back to the page', () => {
    const { touch, st } = touchScene({ e: 1, zoom: 2 });
    touch('pointerdown', 1, 400, 400);
    touch('pointerdown', 2, 800, 400);
    touch('pointermove', 1, 500, 400);
    touch('pointermove', 2, 700, 400);
    expect(st.zoomT).toBeCloseTo(1, 3);
    expect(st.eT).toBe(1);
    touch('pointermove', 1, 550, 400);
    touch('pointermove', 2, 650, 400);
    expect(st.eT).toBeLessThan(1);
    expect(st.eT).toBeGreaterThan(0.3);
    touch('pointermove', 1, 599, 400);
    touch('pointermove', 2, 601, 400);
    // too close to be a steady spread: nothing more happens
    const eT = st.eT;
    touch('pointermove', 1, 598, 400);
    expect(st.eT).toBe(eT);
  });

  it('two fingers moving together move a raised model, as the right button does, and report it once on release', () => {
    const { touch, st, callbacks } = touchScene({ e: 1 });
    touch('pointerdown', 1, 500, 400);
    touch('pointerdown', 2, 700, 400);
    touch('pointermove', 1, 560, 400);
    touch('pointermove', 2, 760, 400);
    expect(st.panT[0] !== 0 || st.panT[1] !== 0).toBe(true);
    expect(st.zoomT).toBe(1);
    touch('pointerup', 1, 560, 400);
    expect(callbacks.onCameraPan).toHaveBeenCalledOnce();
    touch('pointerup', 2, 760, 400);
    expect(callbacks.onCameraPan).toHaveBeenCalledOnce();
  });

  it('two fingers moving together over a flat map move the map', () => {
    const { touch, callbacks } = touchScene({ e: 0 }, { renderPath: 'fallback' }, true);
    touch('pointerdown', 1, 500, 400);
    touch('pointerdown', 2, 700, 400);
    touch('pointermove', 1, 530, 420);
    touch('pointermove', 2, 730, 420);
    // the middle of the two fingers moved 30 and 20 (in two steps, one per finger)
    expect(callbacks.onMapDrag).toHaveBeenCalledTimes(2);
    touch('pointerup', 1, 530, 420);
    expect(callbacks.onMapPan).toHaveBeenCalledWith(30, 20);
  });

  it('a second finger ends the first finger\'s turn; the turn is not carried into the pinch', () => {
    const { touch, st } = touchScene({ e: 1 });
    touch('pointerdown', 1, 500, 400);
    touch('pointermove', 1, 520, 400);
    const yaw = st.yawT;
    expect(yaw).not.toBe(0);
    touch('pointerdown', 2, 700, 400);
    touch('pointermove', 1, 560, 400);
    touch('pointermove', 2, 760, 400);
    expect(st.yawT).toBe(yaw);
  });

  it('lifting one finger ends the pinch, and the finger left does nothing', () => {
    const { touch, st, callbacks } = touchScene({ e: 1 });
    touch('pointerdown', 1, 500, 400);
    touch('pointerdown', 2, 700, 400);
    touch('pointerup', 1, 500, 400);
    const before = { yaw: st.yawT, tilt: st.tiltT, pan: [...st.panT], zoom: st.zoomT };
    touch('pointermove', 2, 760, 450);
    expect(st.yawT).toBe(before.yaw);
    expect(st.tiltT).toBe(before.tilt);
    expect(st.panT).toEqual(before.pan);
    expect(st.zoomT).toBe(before.zoom);
    touch('pointerup', 2, 760, 450);
    expect(callbacks.onCameraRotate).not.toHaveBeenCalled();
  });

  it.each(['pointerup', 'pointercancel'])('a third finger is left out of the pinch: it moves nothing, and its %s leaves the pinch going', (end) => {
    const { touch, st, callbacks } = touchScene({ e: 1 });
    touch('pointerdown', 1, 500, 400);
    touch('pointerdown', 2, 700, 400);
    const { yawT, tiltT } = st;
    touch('pointerdown', 3, 600, 300);
    touch('pointermove', 3, 600, 100);
    expect(st.zoomT).toBe(1);
    expect(st.panT).toEqual([0, 0, 0]);
    expect(st.yawT).toBe(yawT);
    expect(st.tiltT).toBe(tiltT);
    touch(end, 3, 600, 100);
    // the two fingers go on pinching
    touch('pointermove', 1, 400, 400);
    touch('pointermove', 2, 800, 400);
    expect(st.zoomT).toBeGreaterThan(1.3);
    expect(callbacks.onCameraZoom).not.toHaveBeenCalled();
    touch('pointerup', 1, 400, 400);
    expect(callbacks.onCameraZoom).toHaveBeenCalledOnce();
  });

  it('a finger put down late, after the pinch ended, is not taken for the third finger', () => {
    const { touch, st } = touchScene({ e: 1 });
    touch('pointerdown', 1, 500, 400);
    touch('pointerdown', 2, 700, 400);
    touch('pointerdown', 3, 600, 300);
    touch('pointerup', 3, 600, 300);
    touch('pointerup', 1, 500, 400);
    touch('pointerup', 2, 700, 400);
    touch('pointerdown', 3, 600, 300);
    touch('pointermove', 3, 700, 300);
    expect(st.yawT).not.toBe(0);
  });

  it('a cancel throws the pinch away: nothing is reported, and the app puts the map image back as it stood', () => {
    const { touch, callbacks } = touchScene({ e: 0 }, { renderPath: 'fallback' }, true);
    touch('pointerdown', 1, 500, 400);
    touch('pointerdown', 2, 700, 400);
    touch('pointermove', 1, 530, 420);
    touch('pointermove', 2, 730, 420);
    // told once, before the first move of the image
    expect(callbacks.onMapDragBegin).toHaveBeenCalledOnce();
    expect(vi.mocked(callbacks.onMapDragBegin!).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(callbacks.onMapDrag).mock.invocationCallOrder[0]);
    touch('pointercancel', 1, 530, 420);
    expect(callbacks.onMapDragCancel).toHaveBeenCalledOnce();
    expect(callbacks.onMapPan).not.toHaveBeenCalled();
    // the preview is not undone by moving it back: that would not restore a clamped one
    expect(callbacks.onMapDrag).toHaveBeenCalledTimes(2);
    touch('pointercancel', 2, 730, 420);
    expect(callbacks.onMapDragCancel).toHaveBeenCalledOnce();
    expect(callbacks.onMapPan).not.toHaveBeenCalled();
  });

  it('a lift keeps the map image where the fingers left it: no restore', () => {
    const { touch, callbacks } = touchScene({ e: 0 }, { renderPath: 'fallback' }, true);
    touch('pointerdown', 1, 500, 400);
    touch('pointerdown', 2, 700, 400);
    touch('pointermove', 1, 530, 420);
    touch('pointermove', 2, 730, 420);
    touch('pointerup', 1, 530, 420);
    expect(callbacks.onMapPan).toHaveBeenCalledOnce();
    expect(callbacks.onMapDragCancel).not.toHaveBeenCalled();
  });

  it('a cancel with no map move does not touch the map image', () => {
    const { touch, callbacks } = touchScene({ e: 0 }, { renderPath: 'fallback' }, true);
    touch('pointerdown', 1, 500, 400);
    touch('pointerdown', 2, 700, 400);
    touch('pointercancel', 1, 500, 400);
    expect(callbacks.onMapDragBegin).not.toHaveBeenCalled();
    expect(callbacks.onMapDragCancel).not.toHaveBeenCalled();
  });

  it('a cancel reports no camera pan or zoom either', () => {
    const { touch, callbacks } = touchScene({ e: 1 });
    touch('pointerdown', 1, 500, 400);
    touch('pointerdown', 2, 700, 400);
    touch('pointermove', 1, 440, 420);
    touch('pointermove', 2, 840, 420);
    touch('pointercancel', 1, 440, 420);
    touch('pointercancel', 2, 840, 420);
    expect(callbacks.onCameraPan).not.toHaveBeenCalled();
    expect(callbacks.onCameraZoom).not.toHaveBeenCalled();
  });

  describe('a finger already busy outside the canvas', () => {
    function withProfile() {
      const root = document.createElement('div');
      const profile = document.createElement('div');
      profile.dataset.profile = '';
      // the capture a finger holds, as a browser keeps it until the lift or the cancel
      const held = new Set<number>();
      profile.setPointerCapture = vi.fn((id: number) => { held.add(id); });
      profile.releasePointerCapture = vi.fn((id: number) => { held.delete(id); });
      profile.hasPointerCapture = vi.fn((id: number) => held.has(id));
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      // a profile whose x is the screen x: the km asked for says which finger moved the runner
      Object.defineProperty(svg, 'getScreenCTM', { value: () => ({ inverse: () => ({}) }) });
      vi.stubGlobal('DOMPoint', class { constructor(public x: number, public y: number) {} matrixTransform() { return this; } });
      const cursor = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      cursor.dataset.cursor = '';
      profile.append(svg, cursor);
      root.append(profile);
      document.body.append(root);
      const scene = touchScene({ e: 1 }, { renderPath: 'fallback', uiRoot: root });
      const profileKm = vi.fn((x: number) => x);
      scene.engine.setModel({ ...model, route: [[0, 0, 0]] as unknown as EngineModel['route'], profileKm });
      const onProfile = (type: string, id: number, x = 300) =>
        pointer(profile, type, x, 300, { pointerId: id, pointerType: 'touch' });
      return { ...scene, onProfile, profileKm };
    }

    it('leaves a second finger on the canvas out while a finger carries the runner along the profile', () => {
      const { touch, onProfile, st } = withProfile();
      onProfile('pointerdown', 1);
      const { yawT, tiltT, zoomT, panT } = st;
      const pan = [...panT];
      touch('pointerdown', 2, 500, 400);
      touch('pointermove', 2, 700, 450);
      expect(st.yawT).toBe(yawT);
      expect(st.tiltT).toBe(tiltT);
      expect(st.zoomT).toBe(zoomT);
      expect(st.panT).toEqual(pan);
      // a third finger does not start a pinch with it either
      touch('pointerdown', 3, 800, 400);
      touch('pointermove', 3, 900, 400);
      expect(st.zoomT).toBe(zoomT);
      touch('pointerup', 2, 700, 450);
      touch('pointerup', 3, 900, 400);
      onProfile('pointerup', 1);
    });

    it('keeps the runner with the first finger when a second one goes down on the profile too', () => {
      const { onProfile, profileKm } = withProfile();
      onProfile('pointerdown', 1, 100);
      onProfile('pointerdown', 2, 200);
      onProfile('pointermove', 2, 250);
      onProfile('pointermove', 1, 120);
      // only the first finger carried the runner: 100 (down) and 120 (move)
      expect(profileKm.mock.calls.map(([x]) => x)).toEqual([100, 120]);
      onProfile('pointerup', 2, 250);
      onProfile('pointermove', 1, 130);
      expect(profileKm.mock.calls.map(([x]) => x)).toEqual([100, 120, 130]);
    });

    it('lets the next finger take the runner once the first has lifted or been cancelled', () => {
      for (const end of ['pointerup', 'pointercancel']) {
        const { onProfile, profileKm } = withProfile();
        onProfile('pointerdown', 1, 100);
        onProfile('pointerdown', 2, 200);
        onProfile(end, 1, 100);
        onProfile('pointerdown', 3, 300);
        onProfile('pointermove', 3, 310);
        expect(profileKm.mock.calls.map(([x]) => x)).toEqual([100, 300, 310]);
        document.body.replaceChildren();
      }
    });

    it('does not stay stuck on a finger that lost its capture without a lift or a cancel', () => {
      const { onProfile, profileKm } = withProfile();
      onProfile('pointerdown', 1, 100);
      // the browser took the capture away (the element changed under the finger): no up or cancel came
      const profile = document.querySelector<HTMLElement>('[data-profile]')!;
      profile.releasePointerCapture(1);
      onProfile('pointerdown', 2, 200);
      expect(profileKm.mock.calls.map(([x]) => x)).toEqual([100, 200]);
    });

    it('takes the canvas back once the runner finger is lifted', () => {
      const { touch, onProfile, st } = withProfile();
      onProfile('pointerdown', 1);
      onProfile('pointerup', 1);
      const yawT = st.yawT;
      touch('pointerdown', 2, 500, 400);
      touch('pointermove', 2, 560, 400);
      expect(st.yawT).not.toBe(yawT);
    });
  });

  it('native: touches are not read as a pinch (the page keeps its own handling)', () => {
    const { touch, st } = touchScene({ e: 1 }, { renderPath: 'native' });
    touch('pointerdown', 1, 500, 400);
    touch('pointerdown', 2, 700, 400);
    touch('pointermove', 1, 400, 400);
    touch('pointermove', 2, 800, 400);
    expect(st.zoomT).toBe(1);
  });
});

describe('camera gesture completion', () => {
  type NativeDebug = {
    st: {
      e: number; eT: number; yaw: number; yawT: number; tilt: number; tiltT: number;
      zoom: number; zoomT: number; pan: number[]; panT: number[];
    };
    mapToScreen(mx: number, my: number): [number, number];
  };
  const nativeScene = () => {
    const scene = setup(100, { renderPath: 'native' });
    const terrain = buildTerrain(
      { nx: 1, ny: 1, values: new Float32Array([100, 100, 100, 100]), source: 'gsi-dem' },
      model.mapWidth,
      model.mapHeight,
      1,
    );
    scene.engine.setModel({ ...model, mapMode: true, terrain });
    const debug = (window as unknown as { __gpxTopo: NativeDebug }).__gpxTopo;
    return { scene, debug };
  };
  const settleNativeCamera = (scene: ReturnType<typeof setup>, debug: NativeDebug) => {
    debug.st.yaw = debug.st.yawT;
    debug.st.tilt = debug.st.tiltT;
    debug.st.zoom = debug.st.zoomT;
    debug.st.pan = [...debug.st.panT];
    scene.paint();
  };
  const screenDistance = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const mapPointAtScreen = (debug: NativeDebug, target: [number, number]) => {
    let x = model.mapWidth / 2;
    let y = model.mapHeight / 2;
    for (let i = 0; i < 12; i += 1) {
      const p = debug.mapToScreen(x, y);
      const px = debug.mapToScreen(x + 1, y);
      const py = debug.mapToScreen(x, y + 1);
      const j00 = px[0] - p[0];
      const j01 = py[0] - p[0];
      const j10 = px[1] - p[1];
      const j11 = py[1] - p[1];
      const det = j00 * j11 - j01 * j10;
      const ex = target[0] - p[0];
      const ey = target[1] - p[1];
      x += (ex * j11 - j01 * ey) / det;
      y += (j00 * ey - ex * j10) / det;
    }
    return [x, y] as [number, number];
  };

  it('keeps the terrain centre as the native rotation pivot while the terrain fits', () => {
    const { scene, debug } = nativeScene();
    debug.st.e = debug.st.eT = 1;
    debug.st.zoom = debug.st.zoomT = 1;
    scene.paint();
    const center = debug.mapToScreen(model.mapWidth / 2, model.mapHeight / 2);

    pointer(scene.canvas, 'pointerdown');
    pointer(scene.canvas, 'pointermove', 700, 400);
    settleNativeCamera(scene, debug);

    expect(screenDistance(debug.mapToScreen(model.mapWidth / 2, model.mapHeight / 2), center)).toBeLessThan(0.1);
    pointer(scene.canvas, 'pointerup', 700, 400);
  });

  it('keeps the display-centre ground point as the native pivot when the terrain overflows', () => {
    const { scene, debug } = nativeScene();
    debug.st.e = debug.st.eT = 0;
    scene.paint();
    const displayCenter = debug.mapToScreen(model.mapWidth / 2, model.mapHeight / 2);
    debug.st.e = debug.st.eT = 1;
    debug.st.zoom = debug.st.zoomT = 2;
    scene.paint();
    const corners = [[0, 0], [model.mapWidth, 0], [model.mapWidth, model.mapHeight], [0, model.mapHeight]]
      .map(([x, y]) => debug.mapToScreen(x, y));
    expect(corners.some(([x]) => x < 0 || x > 1200)).toBe(true);
    const displayPivot = mapPointAtScreen(debug, displayCenter);
    const center = debug.mapToScreen(model.mapWidth / 2, model.mapHeight / 2);

    pointer(scene.canvas, 'pointerdown');
    pointer(scene.canvas, 'pointermove', 700, 400);
    settleNativeCamera(scene, debug);

    expect(screenDistance(debug.mapToScreen(displayPivot[0], displayPivot[1]), displayCenter)).toBeLessThan(0.1);
    expect(screenDistance(debug.mapToScreen(model.mapWidth / 2, model.mapHeight / 2), center)).toBeGreaterThan(20);
    pointer(scene.canvas, 'pointerup', 700, 400);
  });

  it('uses the display pivot as soon as projected terrain exceeds the screen width', () => {
    expect(fitsWithinScreenWidth([0, 1200], 1200)).toBe(true);
    expect(fitsWithinScreenWidth([-0.1, 1200], 1200)).toBe(false);
    expect(fitsWithinScreenWidth([0, 1200.1], 1200)).toBe(false);
    expect(fitsWithinScreenWidth([null, 600], 1200)).toBe(false);
  });

  it('keeps the map display centre as the pivot after the view has moved', () => {
    const scene = setup();
    const terrain = buildTerrain(
      { nx: 1, ny: 1, values: new Float32Array([100, 100, 100, 100]), source: 'gsi-dem' },
      model.mapWidth,
      model.mapHeight,
      1,
    );
    scene.engine.setModel({ ...model, mapMode: true, terrain });
    const debug = (window as unknown as {
      __gpxTopo: {
        pose(value: { e?: number; pan?: number[] }): void;
        st: { yawT: number; panT: number[] };
      };
    }).__gpxTopo;
    debug.pose({ e: 1, pan: [120, -60, 0] });
    scene.paint();
    const before = [...debug.st.panT];

    pointer(scene.canvas, 'pointerdown');
    pointer(scene.canvas, 'pointermove', 700, 420);

    expect(debug.st.yawT).not.toBe(0);
    expect(debug.st.panT).not.toEqual(before);
  });

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

  it.each(['pointercancel', 'lostpointercapture'])('discards an FPV drag on %s and resets for the next one', (end) => {
    const { canvas, engine } = fpvSetup();
    pointer(canvas, 'pointerdown');
    pointer(canvas, 'pointermove', 620);
    vi.advanceTimersByTime(100);
    expect(canvas.classList.contains('turning')).toBe(true);
    pointer(canvas, end);
    expect(canvas.classList.contains('turning')).toBe(false);
    const afterCancel = engine.getFpvState()!;

    pointer(canvas, 'pointermove', 700);
    vi.advanceTimersByTime(100);
    expect(engine.getFpvState()!).toEqual(afterCancel);

    pointer(canvas, 'pointerdown');
    expect(canvas.classList.contains('turning')).toBe(true);
    pointer(canvas, 'pointermove', 620);
    pointer(canvas, 'pointerup');
    expect(canvas.classList.contains('turning')).toBe(false);
  });

  it.each([{ button: 0 }, { button: 2 }])('recovers an unfinished drag on a new press from the same pointer (%o)', (options) => {
    const { canvas, callbacks } = cameraSetup();
    pointer(canvas, 'pointerdown', 600, 400, options);
    vi.advanceTimersByTime(100);
    pointer(canvas, 'pointermove', 700, 420);
    vi.advanceTimersByTime(100);

    // No release, cancellation, or lost capture arrives for the first drag.
    pointer(canvas, 'pointerdown');
    expect(callbacks.onCameraRotate).not.toHaveBeenCalled();
    expect(callbacks.onCameraPan).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30);
    pointer(canvas, 'pointermove', 620, 410);
    vi.advanceTimersByTime(20);
    pointer(canvas, 'pointerup', 620, 410);

    expect(callbacks.onCameraRotate).toHaveBeenCalledOnce();
    const [change] = vi.mocked(callbacks.onCameraRotate).mock.calls[0];
    expect(change.delta_heading_deg).toBeCloseTo(-0.11 * 180 / Math.PI);
    expect(change.delta_pitch_deg).toBeCloseTo(-0.045 * 180 / Math.PI);
    expect(change.total_heading_deg).toBeCloseTo(0.11 * 180 / Math.PI);
    expect(change.total_pitch_deg).toBeCloseTo(0.045 * 180 / Math.PI);
    expect(change.duration_ms).toBe(50);
    expect(callbacks.onCameraPan).not.toHaveBeenCalled();
  });

  it('clears an unfinished camera drag before handling a control press', () => {
    const { canvas, callbacks, debug } = cameraSetup();
    pointer(canvas, 'pointerdown');
    pointer(canvas, 'pointermove', 700, 420);
    const heading = debug.st.yawT;

    const button = document.createElement('button');
    canvas.append(button);
    pointer(button, 'pointerdown');
    pointer(canvas, 'pointermove', 720, 430);
    pointer(canvas, 'pointerup', 720, 430);

    expect(debug.st.yawT).toBe(heading);
    expect(canvas.classList.contains('turning')).toBe(false);
    expect(callbacks.onCameraRotate).not.toHaveBeenCalled();
    expect(callbacks.onCameraPan).not.toHaveBeenCalled();
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

describe('render path', () => {
  function withExtraPiece(options?: EngineOptions) {
    const scene = setup(100, options);
    const extra = document.createElement('div');
    extra.dataset.piece = 'content';
    Object.defineProperties(extra, { offsetWidth: { value: 80 }, offsetHeight: { value: 40 } });
    scene.page.append(extra);
    scene.engine.setModel(model);
    const sheet = scene.page.querySelector('[data-piece="sheet"]')!;
    vi.mocked(scene.renderer.upload).mockClear();
    scene.canvas.dispatchEvent(Object.assign(new Event('paint'), { changedElements: [sheet, extra] }));
    const uploaded = vi.mocked(scene.renderer.upload).mock.calls.map((call) => call[1]);
    return { ...scene, sheet, extra, uploaded };
  }

  it('native: builds the HTML-in-Canvas renderer with no texture source and uploads every piece', () => {
    const { canvas, sheet, extra, uploaded } = withExtraPiece();
    expect(createRenderer).toHaveBeenLastCalledWith(canvas);
    expect(uploaded).toEqual(expect.arrayContaining([sheet, extra]));
  });

  it('native: an explicit native path behaves the same', () => {
    const { canvas, sheet, extra, uploaded } = withExtraPiece({ renderPath: 'native' });
    expect(createRenderer).toHaveBeenLastCalledWith(canvas);
    expect(uploaded).toEqual(expect.arrayContaining([sheet, extra]));
  });

  it('fallback: rasterizes through its own texture source and only uploads the pieces it can reproduce', () => {
    const { canvas, sheet, extra, uploaded } = withExtraPiece({ renderPath: 'fallback' });
    expect(createRenderer).toHaveBeenLastCalledWith(canvas, expect.objectContaining({ failure: 'Fallback texture upload failed.' }));
    expect(uploaded).toContain(sheet);
    expect(uploaded).not.toContain(extra);
  });

  it('fallback: never asks the browser to move pieces for hit testing', () => {
    const scene = setup(100, { renderPath: 'fallback' });
    scene.canvas.updateElementGeometry = vi.fn();
    scene.engine.setModel(model);
    scene.paint();
    vi.advanceTimersByTime(500);
    expect(scene.canvas.updateElementGeometry).not.toHaveBeenCalled();
  });

  it('fallback: keeps its pieces outside the canvas without collecting them again every frame', () => {
    const scene = setup(100, { renderPath: 'fallback' });
    scene.engine.setModel(model);
    const callsBefore = vi.mocked(scene.renderer.layer).mock.calls.length;
    for (let i = 0; i < 5; i += 1) {
      scene.paint();
      vi.advanceTimersByTime(20);
    }
    expect(vi.mocked(scene.renderer.layer).mock.calls.length).toBe(callsBefore);
  });
});

describe('fallback controls outside the stage', () => {
  function panel() {
    const root = document.createElement('div');
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '1440';
    slider.dataset.sun = '';
    slider.value = '630';
    const clock = document.createElement('output');
    clock.dataset.clock = '';
    const profile = document.createElement('div');
    profile.dataset.profile = '';
    const cursor = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    cursor.dataset.cursor = '';
    profile.append(cursor);
    root.append(slider, clock, profile);
    document.body.append(root);
    return { root, slider, clock, cursor };
  }

  it('fallback: the sun slider and the clock live in the visible panel, and the slider drives the light', () => {
    const ui = panel();
    const scene = setup(100, { renderPath: 'fallback', uiRoot: ui.root });
    scene.engine.setModel(model);
    expect(ui.clock.textContent).toBe('10:30');
    ui.slider.value = '720';
    ui.slider.dispatchEvent(new Event('input', { bubbles: true }));
    expect(ui.clock.textContent).toBe('12:00');
  });

  it('fallback: the profile cursor follows the route although no runner is drawn', () => {
    const ui = panel();
    const scene = setup(100, { renderPath: 'fallback', uiRoot: ui.root });
    scene.engine.setModel({ ...model, profilePoint: () => [12, 34] });
    expect(ui.cursor.getAttribute('cx')).toBe('12.0');
    expect(ui.cursor.getAttribute('cy')).toBe('34.0');
  });

  it('fallback: finds a slider the app puts in the panel later', () => {
    const ui = panel();
    ui.slider.remove();
    const scene = setup(100, { renderPath: 'fallback', uiRoot: ui.root });
    scene.engine.setModel(model);
    expect(ui.clock.textContent).toBe('');
    ui.root.append(ui.slider);
    scene.engine.refreshUi();
    expect(ui.clock.textContent).toBe('10:30');
  });

  it('native: the panel option is ignored, so the scene keeps looking only inside its own page', () => {
    const ui = panel();
    const scene = setup(100, { renderPath: 'native', uiRoot: ui.root });
    scene.engine.setModel(model);
    expect(ui.clock.textContent).toBe('');
    ui.slider.value = '720';
    ui.slider.dispatchEvent(new Event('input', { bubbles: true }));
    expect(ui.clock.textContent).toBe('');
  });
});

describe('drawing resolution', () => {
  const drawnWidth = (options?: EngineOptions) => {
    vi.stubGlobal('devicePixelRatio', 3);
    return setup(100, options).canvas.width;
  };

  it('native: draws at most 2 device pixels per css pixel, whatever is asked', () => {
    expect(drawnWidth()).toBe(2400);
    expect(drawnWidth({ renderPath: 'native', maxPixelRatio: 1 })).toBe(2400);
  });

  it('fallback: draws at most 2 by default, and at the lower ratio it is given', () => {
    expect(drawnWidth({ renderPath: 'fallback' })).toBe(2400);
    expect(drawnWidth({ renderPath: 'fallback', maxPixelRatio: 1.5 })).toBe(1800);
    expect(drawnWidth({ renderPath: 'fallback', maxPixelRatio: 5 })).toBe(2400);
  });
});

describe('browsers without device-pixel-content-box (Safari)', () => {
  it.each([undefined, 'native', 'fallback'] as const)('still builds the engine when observe rejects the box option (%s)', (renderPath) => {
    const observe = vi.fn((_target: Element, options?: ResizeObserverOptions) => {
      // WebKit rejects the unknown enum value with a bare "Type error"
      if (options?.box === ('device-pixel-content-box' as ResizeObserverBoxOptions)) throw new TypeError('Type error');
    });
    vi.stubGlobal('ResizeObserver', class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element, options?: ResizeObserverOptions) {
        observe(target, options);
        this.callback([{} as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      disconnect() {}
    });

    expect(() => setup(100, renderPath ? { renderPath } : undefined)).not.toThrow();
    // asked for the exact device pixels first, then plainly
    expect(observe.mock.calls.map(([, options]) => options?.box)).toEqual(['device-pixel-content-box', undefined]);
  });
});
