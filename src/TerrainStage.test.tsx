import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import TerrainStage from './TerrainStage';
import { SHOWCASE_SCENE } from './siteScene';

vi.mock('./dem', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./dem')>()),
  loadSceneElevation: vi.fn(() => Promise.resolve({ nx: 4, ny: 4, values: new Float32Array(25), source: 'gsi-dem' as const })),
}));

((globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true);

/** A WebGL2 context that accepts everything and records which elements were taken as textures. */
function fakeGl(taken: Element[], failures: { left: number }) {
  const constants = new Map<string, number>();
  return new Proxy(
    {},
    {
      get(_target, key: string) {
        if (key === 'texElementSubImage2D') {
          return (_t: number, _l: number, _x: number, _y: number, element: Element) => {
            if (failures.left > 0) {
              failures.left -= 1;
              throw new Error('upload failed');
            }
            taken.push(element);
          };
        }
        if (key === 'getShaderParameter' || key === 'getProgramParameter') return () => true;
        if (key === 'getAttribLocation') return () => 1;
        if (key === 'getUniformLocation') return () => ({});
        if (key === 'getExtension') return () => null;
        if (/^[A-Z0-9_]+$/.test(key)) {
          if (!constants.has(key)) constants.set(key, constants.size + 1);
          return constants.get(key);
        }
        if (key.startsWith('create')) return () => ({});
        return () => undefined;
      },
    },
  );
}

const frames: FrameRequestCallback[] = [];
const resizes: Array<() => void> = [];
let clock = 0;
let root: ReturnType<typeof createRoot> | null = null;
let taken: Element[] = [];
let failures = { left: 0 };

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

function step(ms = 30) {
  clock += ms;
  for (const frame of frames.splice(0)) frame(clock);
}

async function mount(onUnavailable = vi.fn()) {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(<TerrainStage scene={SHOWCASE_SCENE} onUnavailable={onUnavailable}><p>hello</p></TerrainStage>));
  await flush();
  const canvas = container.querySelector('canvas')!;
  const map = container.querySelector<HTMLElement>('.about-map-sheet')!;
  const page = container.querySelector<HTMLElement>('main')!;
  const paint = () => act(() => void canvas.dispatchEvent(new Event('paint')));
  return { canvas, map, page, paint, onUnavailable };
}

const count = (element: Element) => taken.filter((item) => item === element).length;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  frames.length = 0;
  resizes.length = 0;
  clock = performance.now();
  taken = [];
  failures = { left: 0 };
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resizes.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
  const gl = fakeGl(taken, failures);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => gl) as unknown as HTMLCanvasElement['getContext']);
  (HTMLCanvasElement.prototype as unknown as { requestPaint: () => void }).requestPaint = vi.fn();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the terrain stage on the native path', () => {
  it('takes the map and the page once, and not again while the model stands up', async () => {
    const { canvas, map, page, paint } = await mount();
    paint();
    expect(count(map)).toBe(1);
    expect(count(page)).toBe(1);

    act(() => void canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 200, cancelable: true })));
    // the model is standing up: it is drawn every frame, but the elements have not changed
    for (let frame = 0; frame < 6; frame += 1) {
      act(() => step(30));
      paint();
    }
    expect(count(map)).toBe(1);
    expect(count(page)).toBe(1);
    expect((HTMLCanvasElement.prototype as unknown as { requestPaint: ReturnType<typeof vi.fn> }).requestPaint).toHaveBeenCalled();

    // once it has settled, both are taken again to be sure
    for (let frame = 0; frame < 30; frame += 1) act(() => step(30));
    paint();
    expect(count(map)).toBe(2);
    expect(count(page)).toBe(2);
  });

  it('takes the page alone after a scroll, and the map alone after a tile arrives', async () => {
    const { map, page, paint } = await mount();
    paint();
    act(() => void page.dispatchEvent(new Event('scroll')));
    act(() => step());
    paint();
    expect(count(page)).toBe(2);
    expect(count(map)).toBe(1);

    act(() => void map.dispatchEvent(new Event('load')));
    paint();
    expect(count(map)).toBe(2);
    expect(count(page)).toBe(2);
  });

  it('takes both again when the text changes or the window is resized', async () => {
    const { page, map, paint } = await mount();
    paint();
    await act(async () => {
      page.append(document.createTextNode(' more'));
      await Promise.resolve();
    });
    paint();
    expect(count(page)).toBe(2);
    expect(count(map)).toBe(2);

    act(() => resizes.forEach((callback) => callback()));
    paint();
    expect(count(page)).toBe(3);
    expect(count(map)).toBe(3);
  });

  it('keeps asking for the pictures after an upload fails', async () => {
    failures.left = 1;
    const first = await mount();
    first.paint();
    expect(taken).toHaveLength(0);
    first.paint();
    expect(count(first.map)).toBe(1);
    expect(first.onUnavailable).not.toHaveBeenCalled();
  });

  it('hands over to the ordinary page when no picture can be taken', async () => {
    failures.left = 1000;
    const { paint, onUnavailable } = await mount();
    for (let attempt = 0; attempt < 30; attempt += 1) paint();
    expect(onUnavailable).toHaveBeenCalled();
  });

  it('stops listening once it is unmounted', async () => {
    const { canvas, paint } = await mount();
    paint();
    const before = taken.length;
    act(() => root!.unmount());
    root = null;
    act(() => void canvas.dispatchEvent(new Event('paint')));
    expect(taken).toHaveLength(before);
  });
});
