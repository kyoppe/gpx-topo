import type { ViewMode } from './mapMode';

// What carries over to the next visit: the GPX last opened, the plan made on it (its waypoints, their target times,
// the route's title), and the start (date and time) set for it.
//
// The GPX itself can be large, so it goes to IndexedDB; the start is small and goes to localStorage. Either may be
// unavailable (a private window, storage turned off), so every read and write here gives up quietly.

export type Start = { date: string; time: string };
export type SavedGpx = { name: string; xml: string };
export type MapViewport = { lat: number; lon: number; scale: number };
export type SavedView = {
  viewMode: ViewMode;
  mapViewport: MapViewport | null;
  baseMapStyle: 'pale' | 'photo';
};
/** The plan made on a GPX: which file it belongs to, and what was changed on it. */
export type SavedPlan<W> = { file: string; title: string; waypoints: W[]; overrides: Record<string, number> };

const START_KEY = 'gpx-topo:start';
const VIEW_KEY = 'gpx-topo:view';
const DB_NAME = 'gpx-topo';
const STORE = 'gpx';
const LAST = 'last';
const PLAN = 'plan';

export function loadStart(): Start | null {
  try {
    const raw = localStorage.getItem(START_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Start>;
    if (typeof v.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.date)) return null;
    if (typeof v.time !== 'string' || !/^\d{2}:\d{2}$/.test(v.time)) return null;
    return { date: v.date, time: v.time };
  } catch {
    return null;
  }
}

export function saveStart(start: Start) {
  try {
    localStorage.setItem(START_KEY, JSON.stringify(start));
  } catch {
    // not kept: the next visit starts from the defaults
  }
}

function validMapViewport(value: unknown): value is MapViewport {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<MapViewport>;
  return (
    typeof candidate.lat === 'number' &&
    Number.isFinite(candidate.lat) &&
    candidate.lat >= -90 &&
    candidate.lat <= 90 &&
    typeof candidate.lon === 'number' &&
    Number.isFinite(candidate.lon) &&
    candidate.lon >= -180 &&
    candidate.lon <= 180 &&
    typeof candidate.scale === 'number' &&
    Number.isFinite(candidate.scale) &&
    candidate.scale > 0
  );
}

export function loadView(): SavedView | null {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<SavedView>;
    if (value.viewMode !== 'gpx' && value.viewMode !== 'map') return null;
    if (value.baseMapStyle !== 'pale' && value.baseMapStyle !== 'photo') return null;
    if (value.mapViewport !== null && !validMapViewport(value.mapViewport)) return null;
    return {
      viewMode: value.viewMode,
      mapViewport: value.mapViewport,
      baseMapStyle: value.baseMapStyle,
    };
  } catch {
    return null;
  }
}

export function saveView(view: SavedView) {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(view));
  } catch {
    // not kept: the next visit starts from the defaults
  }
}

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function get<T>(key: string): Promise<T | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    } finally {
      db.close();
    }
  });
}

async function put(key: string, value: unknown) {
  const db = await open();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  db.close();
}

export async function loadGpx(): Promise<SavedGpx | null> {
  const v = await get<Partial<SavedGpx>>(LAST);
  return v && typeof v.name === 'string' && typeof v.xml === 'string' ? { name: v.name, xml: v.xml } : null;
}

export function saveGpx(gpx: SavedGpx) {
  return put(LAST, gpx);
}

export async function loadPlan<W>(file: string): Promise<SavedPlan<W> | null> {
  const v = await get<Partial<SavedPlan<W>>>(PLAN);
  if (!v || v.file !== file || !Array.isArray(v.waypoints) || typeof v.title !== 'string') return null;
  return { file, title: v.title, waypoints: v.waypoints, overrides: v.overrides && typeof v.overrides === 'object' ? v.overrides : {} };
}

export function savePlan<W>(plan: SavedPlan<W>) {
  return put(PLAN, plan);
}

/** The start for a GPX just opened: now, to the minute. */
export function startNow(now = new Date()): Start {
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  };
}
