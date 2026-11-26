import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

((globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true);

const harness = vi.hoisted(() => ({
  savedGpx: null as { name: string; xml: string } | null,
  savedView: null as {
    viewMode: 'map' | 'gpx';
    mapViewport: { lat: number; lon: number; scale: number } | null;
    baseMapStyle: 'std' | 'pale' | 'blank' | 'photo' | 'photoNames';
    hillshade: boolean;
    mapSunlight: boolean;
  } | null,
  permalink: null as Record<string, unknown> | null,
  saveView: vi.fn(),
}));

const engine = new Proxy(
  {
    dispose: vi.fn(),
    isFlat: () => true,
    refreshHud: vi.fn(),
    refreshMap: vi.fn(),
    refreshDetail: vi.fn(),
    refreshPop: vi.fn(),
    setModel: vi.fn(),
    setPlacing: vi.fn(),
    setViewState: vi.fn(),
  },
  {
    get(target, property: string | symbol) {
      if (property in target) return target[property as keyof typeof target];
      const method = vi.fn();
      Object.defineProperty(target, property, { value: method, configurable: true });
      return method;
    },
  },
);

vi.mock('./engine', () => ({
  FRAME_X: 40,
  FRAME_Y: 120,
  pageFit: () => 1,
  createEngine: vi.fn(() => engine),
}));

vi.mock('./basemap', () => ({
  renderBasemaps: vi.fn(() => new Promise(() => undefined)),
  streamNames: vi.fn(() => new Promise(() => undefined)),
  streamRelief: vi.fn(() => new Promise(() => undefined)),
}));

vi.mock('./dem', () => ({
  cropElevationGrid: vi.fn(),
  gpxElevationGrid: vi.fn(),
  loadDemGrid: vi.fn(() => new Promise(() => undefined)),
}));

vi.mock('./terrain', () => ({ buildTerrain: vi.fn() }));

vi.mock('./htmlInCanvas', () => ({
  getHtmlInCanvasContext: vi.fn(() => ({ is_webview: false })),
  supportsHtmlInCanvas: vi.fn(() => true),
}));

vi.mock('./Flag', () => ({
  FlagContent: () => null,
  useFlagBrushes: () => [],
}));

vi.mock('./observability', () => ({
  addAction: vi.fn(),
  reportError: vi.fn(),
  reportInfo: vi.fn(),
  reportWarning: vi.fn(),
  startVital: vi.fn(() => vi.fn()),
}));

vi.mock('./session', () => ({
  loadGpx: vi.fn(async () => harness.savedGpx),
  loadPlan: vi.fn(async () => null),
  loadStart: vi.fn(() => null),
  loadView: vi.fn(() => harness.savedView),
  saveGpx: vi.fn(),
  savePlan: vi.fn(),
  saveStart: vi.fn(),
  saveView: harness.saveView,
  startNow: vi.fn(() => ({ date: '2026-01-01', time: '06:00' })),
}));

vi.mock('./mapPermalink', async () => {
  const actual = await vi.importActual<typeof import('./mapPermalink')>('./mapPermalink');
  return {
    ...actual,
    parseMapPermalink: vi.fn(() => harness.permalink),
  };
});

const { default: App } = await import('./App');

const DEFAULT_VIEWPORT = { lat: 35.3606, lon: 138.7274, scale: 5000 };
const mountedRoots: Array<ReturnType<typeof createRoot>> = [];
const SAVED_VIEW = {
  viewMode: 'map' as const,
  mapViewport: { lat: 40, lon: 140, scale: 9000 },
  baseMapStyle: 'pale' as const,
  hillshade: true,
  mapSunlight: true,
};
const SAVED_GPX = {
  name: 'route.gpx',
  xml: `<gpx><trk><name>Route</name><trkseg>
    <trkpt lat="35.1" lon="139.1"><ele>10</ele></trkpt>
    <trkpt lat="35.2" lon="139.2"><ele>20</ele></trkpt>
    <trkpt lat="35.3" lon="139.3"><ele>30</ele></trkpt>
  </trkseg></trk></gpx>`,
};

async function renderApp() {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mountedRoots.push(root);
  await act(async () => {
    root.render(<App />);
  });
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 130));
  });
  return { container, root };
}

function lastSavedViewport() {
  const calls = harness.saveView.mock.calls;
  return calls.at(-1)?.[0]?.mapViewport;
}

beforeEach(() => {
  harness.savedGpx = null;
  harness.savedView = null;
  harness.permalink = null;
  harness.saveView.mockClear();
});

afterEach(async () => {
  for (const root of mountedRoots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe('App initial restore lifecycle', () => {
  it('uses the Mt. Fuji default and shows terrain loading without a saved GPX', async () => {
    const { container } = await renderApp();

    expect(lastSavedViewport()).toEqual(DEFAULT_VIEWPORT);
    expect(container.querySelector('.terrain-status')?.textContent).toMatch(/Loading terrain|地形を読み込み中/);
  });

  it('waits for and then centers on a saved GPX', async () => {
    harness.savedGpx = SAVED_GPX;

    await renderApp();

    const viewport = lastSavedViewport();
    expect(viewport?.lat).toBeCloseTo(35.2, 3);
    expect(viewport?.lon).toBeCloseTo(139.2, 3);
  });

  it('falls back to Mt. Fuji when the saved GPX is invalid', async () => {
    harness.savedGpx = { name: 'broken.gpx', xml: '<gpx><trk><trkseg><trkpt lat="35" lon="139"/></trkseg></trk></gpx>' };

    await renderApp();

    expect(lastSavedViewport()).toEqual(DEFAULT_VIEWPORT);
  });

  it('preserves a saved view when there is no saved GPX', async () => {
    harness.savedView = SAVED_VIEW;

    await renderApp();

    expect(lastSavedViewport()).toEqual(SAVED_VIEW.mapViewport);
  });

  it('lets a permalink center override saved GPX and saved view state', async () => {
    harness.savedGpx = SAVED_GPX;
    harness.savedView = SAVED_VIEW;
    harness.permalink = {
      center: { lat: 34.6937, lon: 135.5023 },
      view: 'flat',
      bearing: null,
      pitch: null,
      zoom: null,
      pan: null,
      focus: null,
      date: null,
      mapStyle: null,
      hillshade: null,
      pin: null,
      fpv: null,
      area: { width: 100, height: 100, scale: 1 },
      sun: null,
      sunSpeed: 'normal',
      timeMinutes: null,
      usedParameters: [],
      ignoredParameters: [],
    };

    await renderApp();

    expect(lastSavedViewport()).toMatchObject({ lat: 34.6937, lon: 135.5023 });
    expect(lastSavedViewport()?.scale).not.toBe(SAVED_VIEW.mapViewport.scale);
  });
});
