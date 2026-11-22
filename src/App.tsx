import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { renderBasemaps, streamRelief } from './basemap';
import { gpxElevationGrid, loadDemGrid, type ElevationGrid } from './dem';
import { createEngine, FRAME_X, FRAME_Y, type DetailRequest, type Engine, type EngineModel } from './engine';
import { calculateStats, parseGpx, serializeGpx, type GpxRoute } from './gpx';
import { createMapProjection, pathD, projectTrack, type MapProjection } from './geo';
import { supportsHtmlInCanvas, type HtmlInCanvasElement } from './htmlInCanvas';
import { defaultWaypoints, highestIndex, nextWaypointName, parseKm, planWaypoints, pointAtKm, trackProgress } from './plan';
import { formatClock, instantFor, parseClock, solarPosition, sunTimes } from './sun';
import { buildTerrain } from './terrain';

const DEFAULT_GPX_URL = '/fixtures/SFMT2026-110km.gpx';
const PANEL_WIDTH = 400;
const PAD = 20;
const MIN_PAGE_WIDTH = 1080;
const MIN_PAGE_HEIGHT = 640;
/** Height lattice nodes per map px: a quick first pass, then as fine as one texture allows. */
const COARSE_DENSITY = 0.4;
const FINE_DENSITY = 2.5;
const MAX_LATTICE = 2047;
const PROFILE_WIDTH = PANEL_WIDTH - 36;
const PROFILE_HEIGHT = 84;

type Layout = {
  pageWidth: number;
  pageHeight: number;
  mapX: number;
  mapY: number;
  mapWidth: number;
  mapHeight: number;
  sideX: number;
};

function layoutFor(width: number, height: number): Layout {
  const pageWidth = Math.max(MIN_PAGE_WIDTH, Math.round(width - FRAME_X));
  const pageHeight = Math.max(MIN_PAGE_HEIGHT, Math.round(height - FRAME_Y));
  return {
    pageWidth,
    pageHeight,
    mapX: PAD,
    mapY: PAD,
    mapWidth: pageWidth - PANEL_WIDTH - PAD * 3,
    mapHeight: pageHeight - PAD * 2,
    sideX: pageWidth - PAD - PANEL_WIDTH,
  };
}

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
const pad2 = (n: number) => String(n).padStart(2, '0');

function isoOf(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function todayIso() {
  return isoOf(new Date());
}

function dateLabel(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${y}/${m}/${d} (${WEEK[new Date(y, m - 1, d).getDay()]})`;
}

function shiftMonth(month: string, by: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function clockInput(minutes: number) {
  return formatClock(((minutes % 1440) + 1440) % 1440);
}

function dayLength(rise: number | null, set: number | null) {
  if (rise === null || set === null) return '-';
  const m = Math.round(set - rise);
  return `${Math.floor(m / 60)}時間${m % 60}分`;
}

type Pop =
  | { seq: number; kind: 'date'; anchor: string }
  | { seq: number; kind: 'time'; anchor: string; target: string; minutes: number; label: string };

const SKY: [number, [number, number, number]][] = [
  [-12, [38, 48, 88]],
  [-4, [92, 86, 128]],
  [0, [214, 124, 92]],
  [6, [244, 196, 138]],
  [20, [250, 238, 204]],
  [45, [252, 249, 238]],
];

function skyColor(elevation: number) {
  let i = 1;
  while (i < SKY.length - 1 && SKY[i][0] < elevation) i += 1;
  const [e0, c0] = SKY[i - 1];
  const [e1, c1] = SKY[i];
  const t = Math.max(0, Math.min(1, (elevation - e0) / (e1 - e0)));
  return `rgb(${c0.map((v, k) => Math.round(v + (c1[k] - v) * t)).join(',')})`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A route as loaded: one that brings no waypoints gets the default ones, which then edit like any other. */
function withWaypoints(route: GpxRoute): GpxRoute {
  return route.waypoints.length ? route : { ...route, waypoints: defaultWaypoints(route.points) };
}

/** A waypoint's km: typing a new one moves it along the route once Enter is pressed or the field is left; Esc puts it back. */
function KmField({ km, label, onCommit }: { km: number; label: string; onCommit: (km: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  return (
    <input
      className="way-km"
      inputMode="decimal"
      spellCheck={false}
      aria-label={label}
      value={draft ?? km.toFixed(1)}
      onFocus={(event) => {
        cancelled.current = false;
        setDraft(km.toFixed(1));
        event.currentTarget.select();
      }}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') cancelled.current = true;
        if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur();
      }}
      onBlur={() => {
        const value = parseKm(draft ?? '');
        setDraft(null);
        if (!cancelled.current && value !== null) onCommit(value);
      }}
    />
  );
}

function WayNameField({ name, label, onCommit }: { name: string; label: string; onCommit: (name: string) => void }) {
  const [draft, setDraft] = useState(name);
  const composing = useRef(false);

  useEffect(() => {
    if (!composing.current) setDraft(name);
  }, [name]);

  return (
    <input
      className="way-name"
      value={draft}
      spellCheck={false}
      aria-label={label}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={(event) => {
        composing.current = false;
        const value = event.currentTarget.value;
        setDraft(value);
        onCommit(value);
      }}
      onChange={(event) => {
        const value = event.target.value;
        setDraft(value);
        if (!composing.current) onCommit(value);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !composing.current) event.currentTarget.blur();
      }}
      onBlur={() => {
        if (!composing.current) onCommit(draft);
      }}
    />
  );
}

function Fallback() {
  return (
    <main className="unsupported">
      <div className="unsupported-card">
        <p className="unsupported-mark">gpx-topo</p>
        <h1>対応ブラウザで開いてください</h1>
        <p>
          このアプリは HTML-in-Canvas を使っています。PC 版の Chrome または Edge (157 以降) で開いてください。
        </p>
      </div>
    </main>
  );
}

export default function App() {
  const [native] = useState(supportsHtmlInCanvas);
  const [route, setRoute] = useState<GpxRoute | null>(null);
  const [fileName, setFileName] = useState('SFMT2026-110km.gpx');
  const [startTime, setStartTime] = useState('06:00');
  const [date, setDate] = useState(todayIso);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  /** the projection whose whole map has finished drawing */
  const [basemap, setBasemap] = useState<MapProjection | null>(null);
  const [demGrid, setDemGrid] = useState<{ projection: MapProjection; grid: ElevationGrid } | null>(null);
  const [apart, setApart] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [showHigh, setShowHigh] = useState(false);
  const [addKm, setAddKm] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [detailWanted, setDetailWanted] = useState<DetailRequest | null>(null);
  const [pop, setPop] = useState<Pop | null>(null);
  const [month, setMonth] = useState(() => todayIso().slice(0, 7));
  const [peek, setPeek] = useState<string | null>(null);
  const popSeq = useRef(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<Engine | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const flatRef = useRef<HTMLCanvasElement | null>(null);
  const reliefRef = useRef<HTMLCanvasElement | null>(null);
  const detailRef = useRef<HTMLCanvasElement | null>(null);
  /** the part of the map the detail canvas holds now */
  const detailDrawn = useRef<DetailRequest | null>(null);
  const touchedRef = useRef(false);

  const layout = useMemo(() => layoutFor(viewport.width, viewport.height), [viewport]);
  const points = route?.points ?? null;
  const projection = useMemo(
    () => (points ? createMapProjection({ points }, layout.mapWidth, layout.mapHeight) : null),
    [points, layout.mapWidth, layout.mapHeight],
  );
  const progress = useMemo(() => (points ? trackProgress(points) : null), [points]);
  const track = useMemo(() => (points && projection ? projectTrack(points, projection, 1.5) : []), [points, projection]);
  const routeD = useMemo(() => pathD(track), [track]);
  const stats = useMemo(() => (points ? calculateStats(points) : null), [points]);
  const startMinutes = parseClock(startTime) ?? 360;
  const plan = useMemo(
    () => (route ? planWaypoints(route, startMinutes, overrides) : []),
    [route, startMinutes, overrides],
  );
  const ways = useMemo(
    () => (projection ? plan.map((way) => ({ ...way, ...projection.project(way), ele: way.ele })) : []),
    [plan, projection],
  );

  const grid = demGrid && demGrid.projection === projection ? demGrid.grid : null;
  const terrain = useMemo(
    () => (grid && projection ? buildTerrain(grid, layout.mapWidth, layout.mapHeight, projection.metersPerPixel) : null),
    [grid, projection, layout.mapWidth, layout.mapHeight],
  );
  const mapReady = !!projection && basemap === projection;

  // elevation profile: distance across, height up
  /** The highest point of the route, from the file's elevations or else the terrain's. */
  const high = useMemo(() => {
    if (!points || !progress || !projection) return null;
    const index = highestIndex(points);
    if (index >= 0) {
      const { x, y } = projection.project(points[index]);
      return { km: progress.km[index], ele: points[index].ele as number, x, y };
    }
    if (!terrain) return null;
    let best: { km: number; ele: number; x: number; y: number } | null = null;
    for (const p of track) {
      const ele = terrain.elev(p.x, p.y);
      if (!best || ele > best.ele) best = { km: progress.km[p.index], ele, x: p.x, y: p.y };
    }
    return best;
  }, [points, progress, projection, terrain, track]);

  const profile = useMemo(() => {
    if (!points || !progress || track.length < 2) return null;
    const total = progress.km[progress.km.length - 1] || 1;
    const series = track.map((p) => ({ km: progress.km[p.index], ele: points[p.index].ele ?? terrain?.elev(p.x, p.y) ?? 0 }));
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of series) {
      lo = Math.min(lo, s.ele);
      hi = Math.max(hi, s.ele);
    }
    const top = 14;
    const bottom = PROFILE_HEIGHT - 4;
    const X = (km: number) => 6 + (km / total) * (PROFILE_WIDTH - 12);
    const K = (x: number) => Math.min(total, Math.max(0, ((x - 6) / (PROFILE_WIDTH - 12)) * total));
    const Y = (ele: number) => bottom - ((ele - lo) / Math.max(1, hi - lo)) * (bottom - top);
    const eleAt = (km: number) => {
      let a = 0;
      let b = series.length - 1;
      while (b - a > 1) {
        const m = (a + b) >> 1;
        if (series[m].km < km) a = m;
        else b = m;
      }
      return series[b].ele;
    };
    const line = series.map((s, i) => `${i ? 'L' : 'M'}${X(s.km).toFixed(1)} ${Y(s.ele).toFixed(1)}`).join('');
    return { X, K, Y, eleAt, line, area: `${line}L${X(total).toFixed(1)} ${bottom}L${X(0).toFixed(1)} ${bottom}Z`, bottom, total, lo, hi };
  }, [points, progress, track, terrain]);

  const sunRange = useMemo(() => {
    const lastMinutes = plan.length ? plan[plan.length - 1].minutes : startMinutes + 600;
    return { min: startMinutes - 60, max: Math.max(startMinutes + 120, lastMinutes + 60) };
  }, [plan, startMinutes]);
  const daylight = useMemo(
    () => (projection ? sunTimes(date, projection.centerLat, projection.centerLon) : null),
    [date, projection],
  );
  // the slider track shows the real light over its range: night, dawn, day, dusk
  const sunTrack = useMemo(() => {
    if (!projection) return undefined;
    const stops: string[] = [];
    for (let i = 0; i <= 24; i += 1) {
      const minutes = sunRange.min + ((sunRange.max - sunRange.min) * i) / 24;
      const { elevation } = solarPosition(instantFor(date, minutes), projection.centerLat, projection.centerLon);
      stops.push(`${skyColor(elevation)} ${((i / 24) * 100).toFixed(1)}%`);
    }
    return `linear-gradient(90deg, ${stops.join(', ')})`;
  }, [date, projection, sunRange]);

  // the month the date picker shows: six weeks, each day with the span of its daylight
  const calendar = useMemo(() => {
    if (!projection || pop?.kind !== 'date') return null;
    const [y, m] = month.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const cells = Array.from({ length: 42 }, (_, i) => {
      const d = new Date(y, m - 1, 1 - first.getDay() + i);
      const iso = isoOf(d);
      const { rise, set } = sunTimes(iso, projection.centerLat, projection.centerLon);
      return { iso, day: d.getDate(), dow: d.getDay(), out: d.getMonth() !== m - 1, rise, set };
    });
    return { y, m, cells };
  }, [month, projection, pop?.kind]);

  // ---------------------------------------------------------------- data
  useEffect(() => {
    let cancelled = false;
    void fetch(DEFAULT_GPX_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`GPX request failed: ${response.status}`);
        return response.text();
      })
      .then((xml) => {
        if (!cancelled && !touchedRef.current) setRoute(withWaypoints(parseGpx(xml)));
      })
      .catch(() => setToast('テスト用 GPX を読み込めませんでした。GPX を開いてください。'));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let timer = 0;
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setViewport({ width: window.innerWidth, height: window.innerHeight }), 250);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const flat = flatRef.current;
    const relief = reliefRef.current;
    if (!projection || !flat || !relief) return;
    const controller = new AbortController();
    let timer = 0;
    const flush = () => {
      timer = 0;
      engineRef.current?.refreshMap();
    };
    void renderBasemaps(projection, Math.min(2, window.devicePixelRatio || 1), { flat, relief }, controller.signal, () => {
      if (!timer) timer = window.setTimeout(flush, 200);
    })
      .then(() => {
        if (controller.signal.aborted) return;
        window.clearTimeout(timer);
        flush();
        setBasemap(projection);
      })
      .catch(() => {
        if (!controller.signal.aborted) setToast('地理院タイルを読み込めませんでした。');
      });
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [projection]);

  useEffect(() => {
    if (!projection || !points) return;
    const controller = new AbortController();
    const { signal } = controller;
    const lattice = (density: number) => {
      const k = Math.min(density, MAX_LATTICE / Math.max(projection.width, projection.height));
      return [Math.round(projection.width * k), Math.round(projection.height * k)] as const;
    };
    void (async () => {
      const [cx, cy] = lattice(COARSE_DENSITY);
      try {
        const first = await loadDemGrid(projection, cx, cy, signal);
        if (signal.aborted) return;
        setDemGrid({ projection, grid: first });
      } catch {
        if (signal.aborted) return;
        setToast('GSI DEM を読み込めなかったため、GPX の標高から地形を作っています。');
        setDemGrid({ projection, grid: gpxElevationGrid(projectTrack(points, projection, 4), cx, cy, projection.width, projection.height) });
        return;
      }
      const [fx, fy] = lattice(FINE_DENSITY);
      try {
        const fine = await loadDemGrid(projection, fx, fy, signal);
        if (!signal.aborted) setDemGrid({ projection, grid: fine });
      } catch {
        // the first pass stays
      }
    })();
    return () => controller.abort();
  }, [projection, points]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // ---------------------------------------------------------------- waypoints
  /** Where a waypoint `at` km along the route stands (clamped to the route). */
  const placeAt = useCallback(
    (at: number) => {
      if (!points || !progress) return null;
      const spot = pointAtKm(points, progress.km, at);
      if (spot.ele === null && terrain && projection) {
        const p = projection.project(spot);
        spot.ele = Math.round(terrain.elev(p.x, p.y));
      }
      return spot;
    },
    [points, progress, terrain, projection],
  );
  const addWay = useCallback(
    (at: number) => {
      const spot = placeAt(at);
      if (!spot) return;
      setRoute((current) => {
        if (!current) return current;
        const waypoint = { id: `user-${Date.now().toString(36)}`, name: nextWaypointName(current.waypoints), ...spot };
        setToast(`${waypoint.name} を ${spot.km.toFixed(1)} km に追加しました。`);
        return { ...current, waypoints: [...current.waypoints, waypoint] };
      });
    },
    [placeAt],
  );
  const editWay = (id: string, change: Partial<GpxRoute['waypoints'][number]>) =>
    setRoute((current) => current && { ...current, waypoints: current.waypoints.map((w) => (w.id === id ? { ...w, ...change } : w)) });
  const moveWay = (id: string, at: number) => {
    const spot = placeAt(at);
    if (spot) editWay(id, spot);
  };
  const removeWay = (id: string) => {
    setRoute((current) => current && { ...current, waypoints: current.waypoints.filter((w) => w.id !== id) });
    setOverrides((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setPop((current) => (current?.kind === 'time' && current.target === id ? null : current));
  };
  const addAtTypedKm = () => {
    const value = parseKm(addKm);
    if (value === null) {
      setToast('追加する位置を km で入力してください。');
      return;
    }
    addWay(value);
    setAddKm('');
  };
  const onRouteClick = useCallback(
    (km: number | null) => {
      if (km === null) {
        setToast('ルートの上をクリックしてください。');
        return;
      }
      addWay(km);
      setPlacing(false);
    },
    [addWay],
  );
  const routeClickRef = useRef(onRouteClick);
  routeClickRef.current = onRouteClick;
  const toggleHigh = () => {
    if (!showHigh && !high) {
      setToast('標高が分からないため、最高点を出せません。');
      return;
    }
    setShowHigh((on) => !on);
  };

  // ---------------------------------------------------------------- engine

  useLayoutEffect(() => {
    const canvas = canvasRef.current as HtmlInCanvasElement | null;
    const page = pageRef.current;
    if (!native || !canvas || !page) return;
    canvas.setAttribute('content', 'drawable');
    canvas.setAttribute('layoutsubtree', '');
    let engine: Engine;
    try {
      engine = createEngine(canvas, page, {
        onApartChange: setApart,
        onRouteClick: (km) => routeClickRef.current(km),
        onDetail: setDetailWanted,
        onTimeCommit: (target, minutes) => {
          if (target === 'start') setStartTime(clockInput(minutes));
          else setOverrides((current) => ({ ...current, [target]: minutes }));
        },
        onPopClosed: (seq) => setPop((current) => (current && String(current.seq) === seq ? null : current)),
      });
    } catch (error) {
      setToast(error instanceof Error ? error.message : '3D を開始できませんでした。');
      return;
    }
    engineRef.current = engine;
    return () => {
      engineRef.current = null;
      engine.dispose();
    };
  }, [native]);

  const model = useMemo<EngineModel | null>(() => {
    if (!projection || !progress || !profile) return null;
    const ribbon = track.filter((_, i) => i % 2 === 0 || i === track.length - 1);
    return {
      ...layout,
      terrain,
      route: ribbon.map((p) => ({ x: p.x, y: p.y, km: progress.km[p.index] })),
      ways: ways.map((w) => ({ id: w.id, x: w.x, y: w.y, km: w.km, minutes: w.minutes })),
      marks: showHigh && high ? [{ id: 'high', x: high.x, y: high.y }] : [],
      date,
      lat: projection.centerLat,
      lon: projection.centerLon,
      profilePoint: (km: number) => [profile.X(km), profile.Y(profile.eleAt(km))],
      profileKm: profile.K,
    };
  }, [layout, terrain, track, progress, ways, showHigh, high, date, projection, profile]);

  useLayoutEffect(() => {
    if (model) engineRef.current?.setModel(model);
  }, [model]);

  useEffect(() => {
    engineRef.current?.setPlacing(placing);
  }, [placing]);

  // a close view: the part in view, drawn again from finer tiles as they come in. It starts from
  // the whole-map picture, and from the last close view where the two overlap.
  const shownDetail = mapReady ? detailWanted : null;
  useLayoutEffect(() => {
    const el = detailRef.current;
    const base = reliefRef.current;
    if (!el || !base || !projection || !shownDetail) {
      if (el && el.width > 1) {
        el.width = 1;
        el.height = 1;
      }
      detailDrawn.current = null;
      engineRef.current?.refreshDetail();
      return;
    }
    const region = shownDetail;
    const s = region.density;
    const last = detailDrawn.current;
    let keep: OffscreenCanvas | null = null;
    if (last && el.width > 1) {
      keep = new OffscreenCanvas(el.width, el.height);
      keep.getContext('2d')?.drawImage(el, 0, 0);
    }
    el.width = Math.max(1, Math.round(region.w * s));
    el.height = Math.max(1, Math.round(region.h * s));
    const context = el.getContext('2d');
    if (!context) return;
    context.imageSmoothingQuality = 'high';
    const k = base.width / projection.width;
    context.drawImage(base, region.x * k, region.y * k, region.w * k, region.h * k, 0, 0, el.width, el.height);
    if (keep && last) context.drawImage(keep, (last.x - region.x) * s, (last.y - region.y) * s, last.w * s, last.h * s);
    detailDrawn.current = region;
    engineRef.current?.refreshDetail();
    const controller = new AbortController();
    let timer = 0;
    const flush = () => {
      timer = 0;
      engineRef.current?.refreshDetail();
    };
    void streamRelief(projection, s, region, context, controller.signal, () => {
      if (!timer) timer = window.setTimeout(flush, 150);
    })
      .then(() => {
        if (controller.signal.aborted) return;
        window.clearTimeout(timer);
        flush();
      })
      .catch(() => {});
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [shownDetail, projection]);

  useLayoutEffect(() => {
    engineRef.current?.refreshPop();
  }, [pop, month, peek, date]);

  // ---------------------------------------------------------------- pickers
  const openDate = () => {
    const engine = engineRef.current;
    if (!engine || engine.popBusy('pop-date')) return;
    popSeq.current += 1;
    setMonth(date.slice(0, 7));
    setPeek(null);
    setPop({ seq: popSeq.current, kind: 'date', anchor: 'pop-date' });
  };
  const openTime = (target: string, minutes: number, anchor: string, label: string) => {
    const engine = engineRef.current;
    if (!engine || engine.popBusy(anchor)) return;
    popSeq.current += 1;
    setPop({ seq: popSeq.current, kind: 'time', anchor, target, minutes: ((minutes % 1440) + 1440) % 1440, label });
  };
  const peekDate = (iso: string | null) => {
    setPeek(iso);
    engineRef.current?.previewDate(iso);
  };
  const isOpen = (anchor: string) => (pop?.anchor === anchor ? '' : undefined);

  // ---------------------------------------------------------------- actions
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    touchedRef.current = true;
    try {
      const next = withWaypoints(parseGpx(await file.text()));
      engineRef.current?.together();
      setPop(null);
      setOverrides({});
      setRoute(next);
      setFileName(file.name);
      setToast(`${file.name} を読み込みました (${next.points.length.toLocaleString('ja-JP')} 点)。`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'GPX を読み込めませんでした。');
    }
  };

  const exportPng = async () => {
    const blob = await engineRef.current?.capture();
    if (blob) downloadBlob(blob, `${route?.name || 'gpx-topo'}.png`);
    else setToast('PNG を書き出せませんでした。');
  };

  const exportGpx = () => {
    if (!route) return;
    downloadBlob(new Blob([serializeGpx(route)], { type: 'application/gpx+xml' }), `${route.name || 'gpx-topo'}.gpx`);
  };

  if (!native) return <Fallback />;

  const initialSun = Math.max(sunRange.min, Math.min(sunRange.max, 630));
  const mapStyle = { left: layout.mapX, top: layout.mapY, width: layout.mapWidth, height: layout.mapHeight };

  return (
    <main className="app">
      <canvas ref={canvasRef} className="stage-canvas" tabIndex={-1}>
        <div className="stage">
          <div ref={pageRef} className="page" style={{ width: layout.pageWidth, height: layout.pageHeight }}>
            <div className="sheet" data-piece="sheet" drawable="" />

            {/* the same map twice: with the hillshade for the flat page, and plain for the model */}
            {(['terrain', 'relief'] as const).map((piece) => (
              <div key={piece} className="terrain" data-piece={piece} drawable="" style={mapStyle}>
                <canvas ref={piece === 'terrain' ? flatRef : reliefRef} />
                <svg viewBox={`0 0 ${layout.mapWidth} ${layout.mapHeight}`} aria-hidden="true">
                  <path className="route-casing" d={routeD} />
                  <path className="route-line" d={routeD} />
                </svg>
                {!terrain && <span className="terrain-status">{route ? '地形を読み込み中' : 'GPX を読み込み中'}</span>}
              </div>
            ))}

            <div
              className="detail"
              data-piece="detail"
              drawable=""
              data-x={shownDetail?.x ?? 0}
              data-y={shownDetail?.y ?? 0}
              data-w={shownDetail?.w ?? 0}
              data-h={shownDetail?.h ?? 0}
              data-density={shownDetail?.density ?? 1}
              style={
                shownDetail
                  ? {
                      left: layout.mapX + shownDetail.x,
                      top: layout.mapY + shownDetail.y,
                      width: shownDetail.w,
                      height: shownDetail.h,
                    }
                  : { left: 0, top: 0, width: 1, height: 1 }
              }
            >
              <canvas ref={detailRef} />
              {shownDetail && (
                <svg viewBox={`${shownDetail.x} ${shownDetail.y} ${shownDetail.w} ${shownDetail.h}`} aria-hidden="true">
                  {/* the line stays about as wide on screen as the view closes in */}
                  <path className="route-casing" d={routeD} style={{ strokeWidth: 5.6 / shownDetail.zoom ** 0.75 }} />
                  <path className="route-line" d={routeD} style={{ strokeWidth: 2.6 / shownDetail.zoom ** 0.75 }} />
                </svg>
              )}
            </div>

            <div className="map" data-map="" style={mapStyle}>
              {ways.map((way, index) => (
                <button
                  key={way.id}
                  type="button"
                  className="pin"
                  data-piece="pin"
                  data-way={way.id}
                  drawable=""
                  onClick={() => engineRef.current?.focusWay(way.id)}
                >
                  <span className="pin-label">
                    <b>{index + 1}</b>
                    <strong>{way.name}</strong>
                    <small>{formatClock(way.minutes)}</small>
                  </span>
                </button>
              ))}
              {showHigh && high && (
                <div className="pin pin-high" data-piece="pin" data-mark="high" drawable="" role="img" aria-label={`最高点 ${Math.round(high.ele)} m`}>
                  <span className="pin-label">
                    <b>▲</b>
                    <strong>{Math.round(high.ele).toLocaleString('ja-JP')} m</strong>
                  </span>
                </div>
              )}
              <div className="hiker" data-piece="hiker" drawable="" role="img" aria-label="この時刻の位置" />
              <div className="probe" data-piece="probe" drawable="" aria-hidden="true">
                <b data-probe-text="">-</b>
              </div>
            </div>

            <aside className="side" style={{ left: layout.sideX, top: PAD, width: PANEL_WIDTH, height: layout.pageHeight - PAD * 2 }}>
              <section className="slot">
                <div className="card" data-piece="card" drawable="" />
                <div className="in in-title" data-piece="content" drawable="">
                  <div className="brand">
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      <path d="M2 16c3-1 4-5 8-5s5 4 8 5" />
                      <path d="M5 12c2-1 3-4 5-4s3 3 5 4" />
                      <path d="M8 8c1-1 1-3 2-3s1 2 2 3" />
                    </svg>
                    <span>gpx-topo</span>
                    <small data-selectable="">{fileName}</small>
                  </div>
                  <input
                    className="route-name"
                    value={route?.name ?? ''}
                    spellCheck={false}
                    aria-label="ルート名"
                    onChange={(event) => setRoute((current) => (current ? { ...current, name: event.target.value } : current))}
                  />
                </div>
              </section>

              <section className="slot">
                <div className="card" data-piece="card" drawable="" />
                <div className="in in-stats" data-piece="content" drawable="">
                  <dl className="stats" data-selectable="">
                    <div>
                      <dt>距離</dt>
                      <dd>
                        {stats ? stats.distanceKm.toFixed(1) : '-'}
                        <span>km</span>
                      </dd>
                    </div>
                    <div>
                      <dt>累積標高</dt>
                      <dd>
                        {stats ? stats.ascentM.toLocaleString('ja-JP') : '-'}
                        <span>m</span>
                      </dd>
                    </div>
                  </dl>
                  <div className="profile-box" data-profile="">
                    <svg className="profile" viewBox={`0 0 ${PROFILE_WIDTH} ${PROFILE_HEIGHT}`} role="img" aria-label="標高プロファイル">
                      {profile && (
                        <>
                          <path className="profile-area" d={profile.area} />
                          <path className="profile-line" d={profile.line} />
                          {ways.map((way, index) => {
                            const x = profile.X(way.km);
                            const y = profile.Y(profile.eleAt(way.km));
                            return (
                              <g key={way.id}>
                                <line className="profile-tick" x1={x} x2={x} y1={y + 6} y2={profile.bottom} />
                                <circle className="profile-dot" cx={x} cy={y} r={6} />
                                <text x={x} y={y + 0.5}>
                                  {index + 1}
                                </text>
                              </g>
                            );
                          })}
                          {showHigh && high && (
                            <path
                              className="profile-high"
                              d={`M${profile.X(high.km).toFixed(1)} ${(profile.Y(profile.eleAt(high.km)) - 11).toFixed(1)}l-5 8h10z`}
                            />
                          )}
                          <circle className="profile-cursor" data-cursor="" r={8} cx={-20} cy={-20} />
                        </>
                      )}
                    </svg>
                  </div>
                </div>
              </section>

              <section className="slot">
                <div className="card" data-piece="card" drawable="" />
                <div className="in in-sun" data-piece="content" drawable="">
                  <div className="row">
                    <span className="label">日照</span>
                    <output className="clock" data-clock="" data-selectable="">
                      {formatClock(initialSun)}
                    </output>
                  </div>
                  <input
                    className="sun"
                    data-sun=""
                    type="range"
                    min={sunRange.min}
                    max={sunRange.max}
                    step={1}
                    defaultValue={initialSun}
                    aria-label="時刻"
                    style={{ ['--track' as string]: sunTrack }}
                  />
                  <div className="row row-inputs">
                    <label>
                      スタート
                      <button
                        id="pop-start"
                        type="button"
                        className="field"
                        data-open={isOpen('pop-start')}
                        onClick={() => openTime('start', startMinutes, 'pop-start', 'スタート時刻')}
                      >
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <circle cx="8" cy="8" r="6.2" />
                          <path d="M8 4.6V8l2.4 1.6" />
                        </svg>
                        {startTime}
                      </button>
                    </label>
                    <label>
                      日付
                      <button id="pop-date" type="button" className="field" data-open={isOpen('pop-date')} onClick={openDate}>
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <rect x="2" y="3.2" width="12" height="10.6" rx="2" />
                          <path d="M2 6.6h12M5.2 1.8v2.6M10.8 1.8v2.6" />
                        </svg>
                        {dateLabel(date)}
                      </button>
                    </label>
                  </div>
                  <p className="daylight" data-selectable="">
                    日の出 {daylight?.rise != null ? formatClock(daylight.rise) : '-'} · 日の入{' '}
                    {daylight?.set != null ? formatClock(daylight.set) : '-'}
                  </p>
                </div>
              </section>

              <section className="slot slot-fill">
                <div className="card" data-piece="card" drawable="" />
                <div className="in in-ways" data-piece="content" drawable="">
                  <div className="row">
                    <span className="label">ウェイポイント</span>
                    <small data-selectable="">番号を押すとその時刻の光になります</small>
                  </div>
                  <form
                    className="way-add"
                    onSubmit={(event) => {
                      event.preventDefault();
                      addAtTypedKm();
                    }}
                  >
                    <input
                      className="way-add-km"
                      inputMode="decimal"
                      spellCheck={false}
                      placeholder="km"
                      aria-label="追加する位置 (km)"
                      value={addKm}
                      onChange={(event) => setAddKm(event.target.value)}
                    />
                    <span>km に</span>
                    <button type="submit" className="field">
                      追加
                    </button>
                    <button type="button" className="high-toggle" role="switch" aria-checked={showHigh} onClick={toggleHigh}>
                      ▲ 最高点
                      <i aria-hidden="true" />
                    </button>
                  </form>
                  <ol className="ways" data-scroll="">
                    {ways.map((way, index) => (
                      <li key={way.id} className="way" data-way={way.id}>
                        <button
                          type="button"
                          className="way-go"
                          aria-label={`${way.name} の時刻の光にする`}
                          onClick={() => engineRef.current?.focusWay(way.id)}
                        >
                          <b>{index + 1}</b>
                        </button>
                        <span className="way-body">
                          <WayNameField
                            name={way.name}
                            label={`${index + 1} 番の名前`}
                            onCommit={(name) => editWay(way.id, { name })}
                          />
                          <small>
                            <KmField km={way.km} label={`${way.name} の km`} onCommit={(km) => moveWay(way.id, km)} />
                            km · {way.ele != null ? `${Math.round(way.ele).toLocaleString('ja-JP')} m` : '-'}
                            {way.estimated ? ' · 推定' : ''}
                          </small>
                        </span>
                        <button
                          id={`pop-${way.id}`}
                          type="button"
                          className="field field-way"
                          aria-label={`${way.name} の目標時刻`}
                          data-open={isOpen(`pop-${way.id}`)}
                          onClick={() => openTime(way.id, way.minutes, `pop-${way.id}`, `${index + 1}. ${way.name}`)}
                        >
                          {clockInput(way.minutes)}
                          {way.minutes >= 1440 && <small>+{Math.floor(way.minutes / 1440)}d</small>}
                        </button>
                        <button type="button" className="way-del" aria-label={`${way.name} を削除`} onClick={() => removeWay(way.id)}>
                          ×
                        </button>
                      </li>
                    ))}
                  </ol>
                  <p className="credit" data-selectable="">
                    地理院タイル (淡色地図・陰影起伏図・標高タイル) 国土地理院
                  </p>
                </div>
              </section>
            </aside>

            {/* pickers: laid out here, raised off the panel by the engine */}
            {pop && (
              <div className="pop-layer" key={pop.seq}>
                {pop.kind === 'date' && calendar && (
                  <div
                    className="pop pop-date"
                    data-piece="pop"
                    data-pop-part=""
                    data-kind="date"
                    data-anchor={pop.anchor}
                    data-seq={pop.seq}
                    drawable=""
                  >
                    <div className="cal-head">
                      <button type="button" className="cal-nav" aria-label="前の月" onClick={() => setMonth((m) => shiftMonth(m, -1))}>
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <path d="M10 3.5 5.5 8l4.5 4.5" />
                        </svg>
                      </button>
                      <strong>
                        {calendar.y}年 {calendar.m}月
                      </strong>
                      <button type="button" className="cal-nav" aria-label="次の月" onClick={() => setMonth((m) => shiftMonth(m, 1))}>
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <path d="M6 3.5 10.5 8 6 12.5" />
                        </svg>
                      </button>
                    </div>
                    <div className="cal-week">
                      {WEEK.map((w, i) => (
                        <span key={w} data-dow={i}>
                          {w}
                        </span>
                      ))}
                    </div>
                    <div className="cal-grid" onPointerLeave={() => peekDate(null)}>
                      {calendar.cells.map((c) => (
                        <button
                          key={c.iso}
                          type="button"
                          className="cal-day"
                          data-dow={c.dow}
                          data-out={c.out ? '' : undefined}
                          data-picked={c.iso === date ? '' : undefined}
                          data-today={c.iso === todayIso() ? '' : undefined}
                          aria-label={dateLabel(c.iso)}
                          onPointerEnter={() => peekDate(c.iso)}
                          onClick={() => {
                            setDate(c.iso);
                            setMonth(c.iso.slice(0, 7));
                            engineRef.current?.closePop();
                          }}
                        >
                          <span>{c.day}</span>
                          {c.rise !== null && c.set !== null && (
                            <i
                              style={{
                                left: `calc(5px + ${(c.rise / 1440).toFixed(4)} * (100% - 10px))`,
                                width: `calc(${((c.set - c.rise) / 1440).toFixed(4)} * (100% - 10px))`,
                              }}
                            />
                          )}
                        </button>
                      ))}
                    </div>
                    {(() => {
                      const iso = peek ?? date;
                      const sun = calendar.cells.find((c) => c.iso === iso) ?? (iso === date ? daylight : null);
                      return (
                        <p className="cal-foot">
                          <strong>{dateLabel(iso)}</strong>
                          {sun && (
                            <span>
                              日の出 {sun.rise !== null ? formatClock(sun.rise) : '-'} · 日の入 {sun.set !== null ? formatClock(sun.set) : '-'} · 昼{' '}
                              {dayLength(sun.rise, sun.set)}
                            </span>
                          )}
                        </p>
                      );
                    })()}
                  </div>
                )}
                {pop.kind === 'time' && (
                  <>
                    <div
                      className="pop pop-time"
                      data-piece="pop"
                      data-pop-part=""
                      data-kind="time"
                      data-anchor={pop.anchor}
                      data-target={pop.target}
                      data-value={pop.minutes}
                      data-seq={pop.seq}
                      drawable=""
                    >
                      <div className="pop-head">
                        <strong>{pop.label}</strong>
                        <small>
                          日の出 {daylight?.rise != null ? formatClock(daylight.rise) : '-'} · 日の入{' '}
                          {daylight?.set != null ? formatClock(daylight.set) : '-'}
                        </small>
                      </div>
                      <div className="drums">
                        <span className="drum-slot" data-drum-slot="h" data-focus="" />
                        <span className="drum-colon">:</span>
                        <span className="drum-slot" data-drum-slot="m" />
                      </div>
                      <div className="pop-foot">
                        <small>ドラッグ・ホイール・数字キー</small>
                        <button type="button" className="pop-btn" onClick={() => engineRef.current?.closePop(false)}>
                          取消
                        </button>
                        <button type="button" className="pop-btn pop-ok" onClick={() => engineRef.current?.closePop(true)}>
                          決定
                        </button>
                      </div>
                    </div>
                    {(['h', 'm'] as const).flatMap((drum) =>
                      Array.from({ length: 7 }, (_, i) => (
                        <span key={drum + i} className="drum-row" data-piece="row" data-pop-part="" data-drum={drum} data-i={i} drawable="" />
                      )),
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* the bar: each button is drawn as a key on a slab in front of the camera, and still is the button */}
          <nav className="hud" data-hud="" aria-label="操作">
            <div className="bar" data-piece="bar" drawable="">
              <span className="well" data-well="open" />
              <span className="well" data-well="place" />
              <span className="well well-flip" data-well="flip" />
              <span className="well" data-well="png" />
              <span className="well" data-well="gpx" />
              <span className="bar-hint">
                ドラッグで回転 · 右ドラッグで移動
                <br />
                ホイールで立体・ズーム · Esc で平面
              </span>
            </div>
            <button type="button" className="key key-open" data-piece="key" data-key="open" drawable="" onClick={() => fileRef.current?.click()}>
              GPX を開く
            </button>
            <button
              type="button"
              className="key key-place"
              data-piece="key"
              data-key="place"
              data-latched={placing ? '' : undefined}
              drawable=""
              aria-pressed={placing}
              onClick={() => setPlacing((on) => !on)}
            >
              {placing ? 'ルートをクリック' : 'ウェイポイント追加'}
            </button>
            <button
              type="button"
              className="key key-flip"
              data-piece="key"
              data-key="flip"
              data-face="front"
              drawable=""
              tabIndex={apart ? -1 : 0}
              onClick={() => engineRef.current?.toggle()}
            >
              起こす
            </button>
            <button
              type="button"
              className="key key-flip"
              data-piece="key"
              data-key="flip"
              data-face="back"
              drawable=""
              tabIndex={apart ? 0 : -1}
              onClick={() => engineRef.current?.toggle()}
            >
              寝かす
            </button>
            <button type="button" className="key key-png" data-piece="key" data-key="png" drawable="" onClick={() => void exportPng()}>
              PNG
            </button>
            <button type="button" className="key key-gpx" data-piece="key" data-key="gpx" drawable="" onClick={exportGpx}>
              GPX
            </button>
          </nav>
        </div>
      </canvas>

      <input
        ref={fileRef}
        hidden
        type="file"
        accept=".gpx,application/gpx+xml,application/xml,text/xml"
        onChange={(event) => {
          void onFile(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}
