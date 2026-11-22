import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { renderBasemaps, streamRelief, type MapStyle } from './basemap';
import { gpxElevationGrid, loadDemGrid, type ElevationGrid } from './dem';
import { createEngine, FRAME_X, FRAME_Y, type DetailRequest, type Engine, type EngineModel, type FlightPhase } from './engine';
import { calculateStats, parseGpx, type GpxRoute, type Waypoint } from './gpx';
import { createMapProjection, pathD, projectTrack, type MapProjection } from './geo';
import { supportsHtmlInCanvas, type HtmlInCanvasElement } from './htmlInCanvas';
import { ensureWaypoints, highestIndex, nextWaypointName, parseKm, planWaypoints, pointAtKm, trackProgress } from './plan';
import { formatClock, instantFor, parseClock, solarPosition, sunTimes } from './sun';
import { FlagContent, useFlagBrushes } from './Flag';
import { detectLanguage, getCopy, type Copy } from './i18n';
import { addAction, reportError, reportInfo, reportWarning } from './observability';
import { loadGpx, loadPlan, loadStart, saveGpx, savePlan, saveStart, startNow } from './session';
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

const pad2 = (n: number) => String(n).padStart(2, '0');

function isoOf(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function todayIso() {
  return isoOf(new Date());
}

function shiftMonth(month: string, by: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function clockInput(minutes: number) {
  return formatClock(((minutes % 1440) + 1440) % 1440);
}

function elapsedFrom(startMinutes: number, targetMinutes: number) {
  return Math.max(0, Math.round(targetMinutes - startMinutes));
}

function elapsedInput(startMinutes: number, targetMinutes: number) {
  const minutes = elapsedFrom(startMinutes, targetMinutes);
  return `+${Math.floor(minutes / 60)}:${pad2(minutes % 60)}`;
}

type Pop =
  | { seq: number; kind: 'date'; anchor: string }
  | { seq: number; kind: 'time'; anchor: string; target: string; minutes: number; baseMinutes: number; label: string };

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
  const draftRef = useRef(name);
  const committedRef = useRef(name);

  useEffect(() => {
    if (!composing.current) {
      draftRef.current = name;
      committedRef.current = name;
      setDraft(name);
    }
  }, [name]);

  const commitDraft = () => {
    const value = draftRef.current;
    if (value === committedRef.current) return;
    committedRef.current = value;
    onCommit(value);
  };
  const updateDraft = (value: string) => {
    draftRef.current = value;
    setDraft(value);
  };

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
        updateDraft(event.currentTarget.value);
      }}
      onChange={(event) => {
        updateDraft(event.target.value);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !composing.current) event.currentTarget.blur();
      }}
      onBlur={() => {
        if (!composing.current) commitDraft();
      }}
    />
  );
}

function Fallback({ copy }: { copy: Copy }) {
  return (
    <main lang={copy.language} className="unsupported">
      <div className="unsupported-card">
        <p className="unsupported-mark">gpx-topo</p>
        <h1>{copy.fallbackTitle}</h1>
        <p>{copy.fallbackBody}</p>
      </div>
    </main>
  );
}

export default function App() {
  const [native] = useState(supportsHtmlInCanvas);
  const [language] = useState(detectLanguage);
  const copy = useMemo(() => getCopy(language), [language]);
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = copy.appName;
  }, [copy.appName, language]);
  const [route, setRoute] = useState<GpxRoute | null>(null);
  const [fileName, setFileName] = useState('SFMT2026-110km.gpx');
  // the start set last time carries over; a GPX opened afresh starts now (see onFile)
  const [startTime, setStartTime] = useState(() => loadStart()?.time ?? '06:00');
  const [date, setDate] = useState(() => loadStart()?.date ?? todayIso());
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  /** the projection whose whole map has finished drawing */
  const [basemap, setBasemap] = useState<MapProjection | null>(null);
  const [baseMapStyle, setBaseMapStyle] = useState<MapStyle>('pale');
  const [demGrid, setDemGrid] = useState<{ projection: MapProjection; grid: ElevationGrid } | null>(null);
  const [apart, setApart] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  /** the photo of the view: its picture, while it is out of the camera key */
  const [shot, setShot] = useState<{ url: string; blob: Blob; aspect: number } | null>(null);
  const [shotOpen, setShotOpen] = useState(false);
  const flagRef = useRef<HTMLDivElement>(null);
  const flagTwinRef = useRef<HTMLDivElement>(null);
  const flagBrushes = useFlagBrushes(flagRef, flagTwinRef);
  const [placing, setPlacing] = useState(false);
  const [showHigh, setShowHigh] = useState(false);
  const [addKm, setAddKm] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [detailWanted, setDetailWanted] = useState<DetailRequest | null>(null);
  const [flyoverPhase, setFlyoverPhase] = useState<FlightPhase | null>(null);
  const [pop, setPop] = useState<Pop | null>(null);
  const [month, setMonth] = useState(() => date.slice(0, 7));
  const [peek, setPeek] = useState<string | null>(null);
  const popSeq = useRef(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<Engine | null>(null);
  const routeNameRef = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const flatRef = useRef<HTMLCanvasElement | null>(null);
  const reliefRef = useRef<HTMLCanvasElement | null>(null);
  const detailRef = useRef<HTMLCanvasElement | null>(null);
  /** the part of the map the detail canvas holds now */
  const detailDrawn = useRef<DetailRequest | null>(null);
  const touchedRef = useRef(false);
  const fileRequestRef = useRef(0);
  const statsCacheRef = useRef<{ points: GpxRoute['points']; stats: ReturnType<typeof calculateStats> } | null>(null);
  routeNameRef.current = route?.name ?? null;

  const layout = useMemo(() => layoutFor(viewport.width, viewport.height), [viewport]);
  const points = route?.points ?? null;
  const projection = useMemo(
    () => (points ? createMapProjection({ points }, layout.mapWidth, layout.mapHeight) : null),
    [points, layout.mapWidth, layout.mapHeight],
  );
  const progress = useMemo(() => (points ? trackProgress(points) : null), [points]);
  const track = useMemo(() => (points && projection ? projectTrack(points, projection, 1.5) : []), [points, projection]);
  const routeD = useMemo(() => pathD(track), [track]);
  const statsFor = (candidate: GpxRoute['points']) => {
    if (statsCacheRef.current?.points === candidate) return statsCacheRef.current.stats;
    const next = calculateStats(candidate);
    statsCacheRef.current = { points: candidate, stats: next };
    return next;
  };
  const stats = useMemo(() => (points ? statsFor(points) : null), [points]);
  const startMinutes = parseClock(startTime) ?? 360;
  const absoluteOverrides = useMemo(
    () => Object.fromEntries(Object.entries(overrides).map(([id, elapsed]) => [id, startMinutes + elapsed])),
    [overrides, startMinutes],
  );
  const plan = useMemo(
    () => (route ? planWaypoints(route, startMinutes, absoluteOverrides) : []),
    [route, startMinutes, absoluteOverrides],
  );
  const ways = useMemo(
    () => (projection ? plan.map((way) => ({ ...way, ...projection.project(way), ele: way.ele })) : []),
    [plan, projection],
  );
  const focusWaypoint = (id: string, source: 'map_pin' | 'side_panel') => {
    const way = ways.find((item) => item.id === id);
    addAction('waypoint_focus_requested', {
      waypoint_id: id,
      waypoint_name: way?.name,
      source,
    });
    engineRef.current?.focusWay(id);
  };

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
  /** the GPX and its plan are in, so changes to them are its own to keep */
  const planReadyRef = useRef(false);
  // the GPX opened last time with the plan made on it, or on a first visit the bundled one, which is then the GPX
  // opened: its plan is kept from then on too
  useEffect(() => {
    let cancelled = false;
    const initialRequest = fileRequestRef.current;
    const isCurrent = () => !cancelled && fileRequestRef.current === initialRequest && !touchedRef.current;
    const fixture = () =>
      fetch(DEFAULT_GPX_URL)
        .then((response) => {
          if (!response.ok) throw new Error(`GPX request failed: ${response.status}`);
          return response.text();
        })
        .then((xml) => {
          if (!isCurrent()) return;
          const name = DEFAULT_GPX_URL.split('/').pop() ?? 'route.gpx';
          const next = ensureWaypoints(parseGpx(xml));
          if (!isCurrent()) return;
          setRoute(next);
          setFileName(name);
          planReadyRef.current = true;
          void saveGpx({ name, xml });
          const routeStats = statsFor(next.points);
          reportInfo('gpx-topo GPX loaded', {
            event_type: 'gpx_loaded',
            source: 'fixture',
            file_name: name,
            gpx_content: xml,
            waypoint_count: next.waypoints.length,
            route_distance_km: routeStats.distanceKm,
          });
          addAction('gpx_loaded', { source: 'fixture', file_name: name, waypoint_count: next.waypoints.length });
        })
        .catch((error) => {
          if (isCurrent()) {
            reportError('load_default_gpx', error, { file_name: DEFAULT_GPX_URL });
            setToast(copy.toast.defaultGpxFailed);
          }
        });
    void (async () => {
      try {
        const saved = await loadGpx();
        if (!isCurrent()) return;
        if (!saved) return fixture();
        let parsed: GpxRoute;
        try {
          parsed = ensureWaypoints(parseGpx(saved.xml));
        } catch {
          return fixture();
        }
        const savedPlan = await loadPlan<Waypoint>(saved.name);
        if (!isCurrent()) return;
        const next = savedPlan ? { ...parsed, name: savedPlan.title, waypoints: savedPlan.waypoints } : parsed;
        setRoute(next);
        setOverrides(savedPlan?.overrides ?? {});
        setFileName(saved.name);
        planReadyRef.current = true;
        const routeStats = statsFor(next.points);
        reportInfo('gpx-topo GPX loaded', {
          event_type: 'gpx_loaded',
          source: 'session',
          file_name: saved.name,
          gpx_content: saved.xml,
          waypoint_count: next.waypoints.length,
          route_distance_km: routeStats.distanceKm,
        });
        addAction('gpx_loaded', { source: 'session', file_name: saved.name, waypoint_count: next.waypoints.length });
      } catch (error) {
        if (isCurrent()) reportWarning('load_saved_gpx_session', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // the plan is kept as it is changed, for the GPX it was made on (once that GPX is in, so as not to write over it)
  useEffect(() => {
    if (!planReadyRef.current || !route) return;
    const timer = window.setTimeout(
      () => void savePlan<Waypoint>({ file: fileName, title: route.name, waypoints: route.waypoints, overrides }),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [route, overrides, fileName]);

  useEffect(() => saveStart({ date, time: startTime }), [date, startTime]);

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
    setBasemap(null);
    let timer = 0;
    const flush = () => {
      timer = 0;
      engineRef.current?.refreshMap();
    };
    void renderBasemaps(projection, Math.min(2, window.devicePixelRatio || 1), { flat, relief }, controller.signal, () => {
      if (!timer) timer = window.setTimeout(flush, 200);
    }, baseMapStyle)
      .then(() => {
        if (controller.signal.aborted) return;
        window.clearTimeout(timer);
        flush();
        setBasemap(projection);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          reportError('load_basemap', error, { map_style: baseMapStyle });
          setToast(copy.toast.mapTilesFailed);
        }
      });
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [projection, baseMapStyle]);

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
      } catch (error) {
        if (signal.aborted) return;
        reportWarning('load_dem_coarse', error);
        setToast(copy.toast.demFallback);
        setDemGrid({ projection, grid: gpxElevationGrid(projectTrack(points, projection, 4), cx, cy, projection.width, projection.height) });
        return;
      }
      const [fx, fy] = lattice(FINE_DENSITY);
      try {
        const fine = await loadDemGrid(projection, fx, fy, signal);
        if (!signal.aborted) setDemGrid({ projection, grid: fine });
      } catch (error) {
        // the first pass stays
        if (!signal.aborted) reportWarning('load_dem_fine', error);
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
        setToast(copy.toast.waypointAdded(waypoint.name, spot.km));
        return { ...current, waypoints: [...current.waypoints, waypoint] };
      });
    },
    [placeAt],
  );
  const renameWay = (id: string, name: string) => {
    const previous = route?.waypoints.find((waypoint) => waypoint.id === id);
    if (!previous || previous.name === name) return;
    addAction('waypoint_edit', { waypoint_id: id, waypoint_name: name });
    setRoute((current) => current && { ...current, waypoints: current.waypoints.map((w) => (w.id === id ? { ...w, name } : w)) });
  };
  const moveWay = (id: string, at: number) => {
    const spot = placeAt(at);
    if (spot) {
      addAction('waypoint_move', { waypoint_id: id, distance_km: Number(spot.km.toFixed(2)) });
      setRoute((current) => current && { ...current, waypoints: current.waypoints.map((w) => (w.id === id ? { ...w, ...spot } : w)) });
    }
  };
  const removeWay = (id: string) => {
    const removed = route?.waypoints.find((waypoint) => waypoint.id === id);
    addAction('waypoint_remove', { waypoint_id: id, waypoint_name: removed?.name });
    setRoute((current) => {
      if (!current) return current;
      const waypoints = current.waypoints.filter((waypoint) => waypoint.id !== id || waypoint.fixed);
      return ensureWaypoints({ ...current, waypoints });
    });
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
      addAction('waypoint_add_rejected', { input: addKm });
      setToast(copy.toast.addKmRequired);
      return;
    }
    addAction('waypoint_add_requested', { distance_km: Number(value.toFixed(2)), source: 'form' });
    addWay(value);
    setAddKm('');
  };
  const onRouteClick = useCallback(
    (km: number | null) => {
      if (km === null) {
        addAction('waypoint_add_rejected', { source: 'map' });
        setToast(copy.toast.clickRoute);
        return;
      }
      addAction('waypoint_add_requested', { distance_km: Number(km.toFixed(2)), source: 'map' });
      addWay(km);
      setPlacing(false);
    },
    [addWay],
  );
  const routeClickRef = useRef(onRouteClick);
  routeClickRef.current = onRouteClick;
  const toggleHigh = () => {
    if (!showHigh && !high) {
      setToast(copy.toast.highestUnavailable);
      return;
    }
    addAction('highest_point_toggled', { enabled: !showHigh });
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
        onFlightChange: (phase) => {
          addAction('flyover_state_changed', { phase: phase ?? 'idle' });
          setFlyoverPhase(phase);
        },
        onInfoChange: (open) => {
          addAction('info_flag_toggled', { open });
          setInfoOpen(open);
        },
        onPhotoChange: (open, via) => {
          const routeName = routeNameRef.current || 'gpx-topo';
          if (open) addAction('photo_shown', { route_name: routeName });
          else if (via) addAction('photo_closed', { route_name: routeName, via });
          setShotOpen(open);
          // back in the key, the picture is let go
          if (!open)
            setShot((current) => {
              if (current) URL.revokeObjectURL(current.url);
              return null;
            });
        },
        onTimeCommit: (target, minutes) => {
          addAction('elapsed_time_committed', { target, minutes });
          if (target === 'start') setStartTime(clockInput(minutes));
          else setOverrides((current) => ({ ...current, [target]: minutes }));
        },
        onPopClosed: (seq) => setPop((current) => (current && String(current.seq) === seq ? null : current)),
      });
    } catch (error) {
      reportError('create_html_in_canvas_engine', error);
      setToast(error instanceof Error ? error.message : copy.toast.threeDStartFailed);
      return;
    }
    addAction('html_in_canvas_ready');
    engineRef.current = engine;
    return () => {
      engineRef.current = null;
      engine.dispose();
    };
  }, [native]);

  useEffect(() => {
    engineRef.current?.refreshHud();
  }, [flyoverPhase]);

  const model = useMemo<EngineModel | null>(() => {
    if (!projection || !progress || !profile) return null;
    return {
      ...layout,
      terrain,
      // every point of the track, as the drawn line has them, so the runner keeps to the line round every bend
      route: track.map((p) => ({ x: p.x, y: p.y, km: progress.km[p.index] })),
      ways: ways.map((w) => ({ id: w.id, x: w.x, y: w.y, km: w.km, minutes: w.minutes })),
      marks: showHigh && high ? [{ id: 'high', x: high.x, y: high.y }] : [],
      date,
      lat: projection.centerLat,
      lon: projection.centerLon,
      mapStyle: baseMapStyle,
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

  // A close view: keep the current picture visible while a padded, sharper picture is prepared,
  // then crossfade once the new tiles are ready.
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
    const photoRouteOnly = baseMapStyle === 'photo';
    let keep: OffscreenCanvas | null = null;
    if (!photoRouteOnly && last && el.width > 1) {
      keep = new OffscreenCanvas(el.width, el.height);
      keep.getContext('2d')?.drawImage(el, 0, 0);
    }
    el.width = Math.max(1, Math.round(region.w * s));
    el.height = Math.max(1, Math.round(region.h * s));
    const context = el.getContext('2d');
    if (!context) return;
    context.imageSmoothingQuality = 'high';
    if (photoRouteOnly) {
      context.clearRect(0, 0, el.width, el.height);
      detailDrawn.current = region;
      engineRef.current?.refreshDetail();
      return;
    }
    const k = base.width / projection.width;
    context.drawImage(base, region.x * k, region.y * k, region.w * k, region.h * k, 0, 0, el.width, el.height);
    if (keep && last) context.drawImage(keep, (last.x - region.x) * s, (last.y - region.y) * s, last.w * s, last.h * s);
    const start = new OffscreenCanvas(el.width, el.height);
    start.getContext('2d')?.drawImage(el, 0, 0);
    const next = document.createElement('canvas');
    next.width = el.width;
    next.height = el.height;
    const nextContext = next.getContext('2d');
    if (!nextContext) return;
    nextContext.imageSmoothingQuality = 'high';
    nextContext.drawImage(base, region.x * k, region.y * k, region.w * k, region.h * k, 0, 0, next.width, next.height);
    if (keep && last) nextContext.drawImage(keep, (last.x - region.x) * s, (last.y - region.y) * s, last.w * s, last.h * s);
    detailDrawn.current = region;
    engineRef.current?.refreshDetail();
    const controller = new AbortController();
    let animation = 0;
    const flush = () => {
      engineRef.current?.refreshDetail();
    };
    void streamRelief(projection, s, region, nextContext, controller.signal, () => {})
      .then(() => {
        if (controller.signal.aborted) return;
        const started = performance.now();
        const crossfade = (now: number) => {
          if (controller.signal.aborted) return;
          const progress = Math.min(1, (now - started) / 220);
          context.clearRect(0, 0, el.width, el.height);
          context.globalAlpha = 1 - progress;
          context.drawImage(start, 0, 0);
          context.globalAlpha = progress;
          context.drawImage(next, 0, 0);
          context.globalAlpha = 1;
          flush();
          if (progress < 1) animation = requestAnimationFrame(crossfade);
        };
        animation = requestAnimationFrame(crossfade);
      })
      .catch((error) => {
        if (!controller.signal.aborted) reportWarning('load_detail_relief', error);
      });
    return () => {
      controller.abort();
      cancelAnimationFrame(animation);
    };
  }, [shownDetail, projection, baseMapStyle]);

  useLayoutEffect(() => {
    engineRef.current?.refreshPop();
  }, [pop, month, peek, date]);

  // ---------------------------------------------------------------- pickers
  const openDate = () => {
    const engine = engineRef.current;
    if (!engine || engine.popBusy('pop-date')) return;
    addAction('date_picker_opened');
    popSeq.current += 1;
    setMonth(date.slice(0, 7));
    setPeek(null);
    setPop({ seq: popSeq.current, kind: 'date', anchor: 'pop-date' });
  };
  const openTime = (target: string, minutes: number, anchor: string, label: string) => {
    const engine = engineRef.current;
    if (!engine || engine.popBusy(anchor)) return;
    addAction('elapsed_time_picker_opened', { target });
    popSeq.current += 1;
    const relative = target !== 'start';
    setPop({
      seq: popSeq.current,
      kind: 'time',
      anchor,
      target,
      minutes: relative ? elapsedFrom(startMinutes, minutes) : ((minutes % 1440) + 1440) % 1440,
      baseMinutes: relative ? startMinutes : 0,
      label,
    });
  };
  const peekDate = (iso: string | null) => {
    setPeek(iso);
    engineRef.current?.previewDate(iso);
  };
  const isOpen = (anchor: string) => (pop?.anchor === anchor ? '' : undefined);

  // ---------------------------------------------------------------- actions
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const requestId = ++fileRequestRef.current;
    addAction('gpx_file_open_requested', { file_name: file.name, file_size: file.size });
    let xml = '';
    try {
      xml = await file.text();
      const next = ensureWaypoints(parseGpx(xml));
      if (requestId !== fileRequestRef.current) return;
      touchedRef.current = true;
      engineRef.current?.together();
      setPop(null);
      setOverrides({});
      setRoute(next);
      setFileName(file.name);
      // a new GPX starts now, and is what opens next time; the start then stays as it is set for it
      const now = startNow();
      setDate(now.date);
      setMonth(now.date.slice(0, 7));
      setStartTime(now.time);
      planReadyRef.current = true;
      void saveGpx({ name: file.name, xml });
      const routeStats = statsFor(next.points);
      reportInfo('gpx-topo GPX loaded', {
        event_type: 'gpx_loaded',
        source: 'file',
        file_name: file.name,
        file_size: file.size,
        gpx_content: xml,
        waypoint_count: next.waypoints.length,
        route_distance_km: routeStats.distanceKm,
      });
      addAction('gpx_loaded', { source: 'file', file_name: file.name, file_size: file.size, waypoint_count: next.waypoints.length });
      setToast(copy.toast.gpxLoaded(file.name, next.points.length));
    } catch (error) {
      if (requestId !== fileRequestRef.current) return;
      reportError('load_gpx_file', error, { file_name: file.name, file_size: file.size, gpx_content: xml });
      setToast(error instanceof Error ? error.message : copy.toast.gpxLoadFailed);
    }
  };

  // the camera key takes a photo of the view; it comes out as a print floating over the map (see the engine's photo),
  // with buttons to save, copy, or post it
  const exportPng = async () => {
    const engine = engineRef.current;
    // one photo at a time: while one is out, the key takes no other
    if (!engine || shotOpen || shot) return;
    addAction('photo_requested', { route_name: route?.name || 'gpx-topo' });
    try {
      const blob = await engine.capture();
      if (!blob) {
        reportError('export_png', new Error('PNG capture returned no blob'), { route_name: route?.name || 'gpx-topo' });
        setToast(copy.toast.pngExportFailed);
        return;
      }
      const url = URL.createObjectURL(blob);
      const picture = await createImageBitmap(blob);
      const aspect = picture.width / Math.max(1, picture.height);
      picture.close();
      setShot((current) => {
        if (current) URL.revokeObjectURL(current.url);
        return { url, blob, aspect };
      });
    } catch (error) {
      reportError('export_png', error, { route_name: route?.name || 'gpx-topo' });
      setToast(copy.toast.pngExportFailed);
    }
  };
  const shotName = () => `${route?.name || 'gpx-topo'}.png`;
  const saveShot = () => {
    if (!shot) return;
    try {
      downloadBlob(shot.blob, shotName());
      addAction('photo_saved', { route_name: route?.name || 'gpx-topo' });
    } catch (error) {
      reportError('save_png', error, { route_name: route?.name || 'gpx-topo' });
      setToast(copy.toast.imageSavedFailed);
    }
  };
  const copyShot = async () => {
    if (!shot) return false;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': shot.blob })]);
      addAction('photo_copied', { route_name: route?.name || 'gpx-topo' });
      return true;
    } catch (error) {
      reportWarning('copy_png', error);
      setToast(copy.toast.imageCopiedFailed);
      return false;
    }
  };
  const SHARE_TEXT = copy.shareText;
  const postShot = async () => {
    // X takes no picture from here: it goes on the clipboard, to paste into the post
    const copied = await copyShot();
    const postWindow = window.open(`https://x.com/intent/post?text=${encodeURIComponent(SHARE_TEXT)}`, '_blank', 'noopener');
    if (postWindow) addAction('photo_post_opened', { route_name: route?.name || 'gpx-topo' });
    if (copied) setToast(copy.toast.imageCopiedWithPaste);
  };

  if (!native) return <Fallback copy={copy} />;

  const initialSun = Math.max(sunRange.min, Math.min(sunRange.max, 630));
  const flyoverPlaying =
    flyoverPhase === 'intro' || flyoverPhase === 'run' || flyoverPhase === 'outro' || flyoverPhase === 'paused';
  const flyoverRunning = flyoverPhase === 'intro' || flyoverPhase === 'run' || flyoverPhase === 'outro';
  const flyoverPaused = flyoverPhase === 'paused';
  const flyoverReturning = flyoverPhase === 'return';
  const photoRouteOverlay = baseMapStyle === 'photo' && apart && !!shownDetail;
  const mapStyle = { left: layout.mapX, top: layout.mapY, width: layout.mapWidth, height: layout.mapHeight };

  return (
    <main lang={language} className={`app${photoRouteOverlay ? ' photo-route-overlay' : ''}`}>
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
                {!terrain && <span className="terrain-status">{route ? copy.ui.loadingTerrain : copy.ui.loadingGpx}</span>}
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
                  <path className="route-casing" d={routeD} style={{ strokeWidth: Math.max(1.2, 5.6 / shownDetail.zoom ** 0.75) }} />
                  <path className="route-line" d={routeD} style={{ strokeWidth: Math.max(0.7, 2.6 / shownDetail.zoom ** 0.75) }} />
                </svg>
              )}
            </div>

            <div className="map" data-map="" style={mapStyle}>
              <div className="map-switch" data-piece="content" data-map-control="" drawable="" role="group" aria-label={copy.ui.mapType}>
                <span>{copy.ui.map}</span>
                <button
                  type="button"
                  className="map-switch-option"
                  aria-pressed={baseMapStyle === 'pale'}
                  onClick={() => {
                    addAction('map_style_changed', { style: 'pale' });
                    setBaseMapStyle('pale');
                  }}
                >
                  {copy.ui.paleMap}
                </button>
                <button
                  type="button"
                  className="map-switch-option"
                  aria-pressed={baseMapStyle === 'photo'}
                  onClick={() => {
                    addAction('map_style_changed', { style: 'photo' });
                    setBaseMapStyle('photo');
                  }}
                >
                  {copy.ui.aerial}
                </button>
              </div>
              {ways.map((way, index) => (
                <button
                  key={way.id}
                  type="button"
                  className="pin"
                  data-piece="pin"
                  data-way={way.id}
                  drawable=""
                  onClick={() => focusWaypoint(way.id, 'map_pin')}
                >
                  <span className="pin-label">
                    <b>{index + 1}</b>
                    <strong>{way.name}</strong>
                    <small>{elapsedInput(startMinutes, way.minutes)}</small>
                  </span>
                </button>
              ))}
              {showHigh && high && (
                <div className="pin pin-high" data-piece="pin" data-mark="high" drawable="" role="img" aria-label={copy.ui.highestPoint(high.ele)}>
                  <span className="pin-label">
                    <b>▲</b>
                    <strong>{Math.round(high.ele).toLocaleString(copy.locale)} m</strong>
                  </span>
                </div>
              )}
              <div className="hiker" data-piece="hiker" drawable="" role="img" aria-label={copy.ui.positionAtTime} />
              <div className="probe" data-piece="probe" drawable="" aria-hidden="true">
                <b data-probe-text="">-</b>
              </div>
            </div>

            <aside className="side" style={{ left: layout.sideX, top: PAD, width: PANEL_WIDTH, height: layout.pageHeight - PAD * 2 }}>
              <section className="slot">
                <div className="card" data-piece="card" drawable="" />
                <div className="in in-title" data-piece="content" drawable="">
                  <div className="brand">
                    <img className="brand-mark" src="/gpx-topo-logo.png" alt="" aria-hidden="true" />
                    <span>{copy.appName}</span>
                  </div>
                  <input
                    className="route-name"
                    value={route?.name ?? ''}
                    spellCheck={false}
                    aria-label={copy.ui.routeName}
                    onChange={(event) => setRoute((current) => (current ? { ...current, name: event.target.value } : current))}
                  />
                  <small className="file-name" data-selectable="">
                    {fileName}
                  </small>
                </div>
              </section>

              <section className="slot">
                <div className="card" data-piece="card" drawable="" />
                <div className="in in-stats" data-piece="content" drawable="">
                  <dl className="stats" data-selectable="">
                    <div>
                      <dt>{copy.ui.distance}</dt>
                      <dd>
                        {stats ? stats.distanceKm.toFixed(1) : '-'}
                        <span>km</span>
                      </dd>
                    </div>
                    <div>
                      <dt>{copy.ui.elevationGain}</dt>
                      <dd>
                        {stats ? stats.ascentM.toLocaleString(copy.locale) : '-'}
                        <span>m</span>
                      </dd>
                    </div>
                  </dl>
                  <div className="profile-box" data-profile="">
                    <svg className="profile" viewBox={`0 0 ${PROFILE_WIDTH} ${PROFILE_HEIGHT}`} role="img" aria-label={copy.ui.elevationProfile}>
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
                    <span className="label">{copy.ui.sunlight}</span>
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
                    aria-label={copy.ui.time}
                    style={{ ['--track' as string]: sunTrack }}
                  />
                  <div className="row row-inputs">
                    <label>
                      {copy.ui.start}
                      <button
                        id="pop-start"
                        type="button"
                        className="field"
                        data-open={isOpen('pop-start')}
                        onClick={() => openTime('start', startMinutes, 'pop-start', copy.ui.startTime)}
                      >
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <circle cx="8" cy="8" r="6.2" />
                          <path d="M8 4.6V8l2.4 1.6" />
                        </svg>
                        {startTime}
                      </button>
                    </label>
                    <label>
                      {copy.ui.date}
                      <button id="pop-date" type="button" className="field" data-open={isOpen('pop-date')} onClick={openDate}>
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <rect x="2" y="3.2" width="12" height="10.6" rx="2" />
                          <path d="M2 6.6h12M5.2 1.8v2.6M10.8 1.8v2.6" />
                        </svg>
                        {copy.dateLabel(date)}
                      </button>
                    </label>
                  </div>
                  <p className="daylight" data-selectable="">
                    {copy.ui.sunrise} {daylight?.rise != null ? formatClock(daylight.rise) : '-'} · {copy.ui.sunset}{' '}
                    {daylight?.set != null ? formatClock(daylight.set) : '-'}
                  </p>
                </div>
              </section>

              <section className="slot slot-fill">
                <div className="card" data-piece="card" drawable="" />
                <div className="in in-ways" data-piece="content" drawable="">
                  <div className="row">
                    <span className="label">{copy.ui.waypoints}</span>
                    {apart && <small data-selectable="">{copy.ui.sunlightHint}</small>}
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
                      aria-label={copy.ui.addPositionAria}
                      value={addKm}
                      onChange={(event) => setAddKm(event.target.value)}
                    />
                    <span>{copy.ui.kmAt}</span>
                    <button type="submit" className="field">
                      {copy.ui.add}
                    </button>
                    <button type="button" className="high-toggle" role="switch" aria-checked={showHigh} onClick={toggleHigh}>
                      ▲ {copy.ui.highestPointLabel}
                      <i aria-hidden="true" />
                    </button>
                  </form>
                  <ol className="ways" data-scroll="">
                    {ways.map((way, index) => (
                      <li key={way.id} className="way" data-way={way.id}>
                        <button
                          type="button"
                          className="way-go"
                          aria-label={copy.ui.waypointLightAria(way.name)}
                          onClick={() => focusWaypoint(way.id, 'side_panel')}
                        >
                          <b>{index + 1}</b>
                        </button>
                        <span className="way-body">
                          <WayNameField
                            name={way.name}
                            label={copy.ui.waypointNameAria(index + 1)}
                            onCommit={(name) => renameWay(way.id, name)}
                          />
                          <small>
                            <KmField km={way.km} label={copy.ui.waypointKmAria(way.name)} onCommit={(km) => moveWay(way.id, km)} />
                            km · {way.ele != null ? `${Math.round(way.ele).toLocaleString(copy.locale)} m` : '-'}
                            {way.estimated ? ` · ${copy.ui.estimated}` : ''}
                          </small>
                        </span>
                        <button
                          id={`pop-${way.id}`}
                          type="button"
                          className="field field-way"
                          aria-label={copy.ui.waypointElapsedAria(way.name)}
                          data-open={isOpen(`pop-${way.id}`)}
                          onClick={() => openTime(way.id, way.minutes, `pop-${way.id}`, `${index + 1}. ${way.name}`)}
                        >
                          {elapsedInput(startMinutes, way.minutes)}
                        </button>
                        {way.fixed ? (
                          <span className="way-fixed" aria-hidden="true" />
                        ) : (
                            <button type="button" className="way-del" aria-label={copy.ui.deleteWaypointAria(way.name)} onClick={() => removeWay(way.id)}>
                            ×
                          </button>
                        )}
                      </li>
                    ))}
                  </ol>
                  <p className="credit" data-selectable="">
                    {copy.ui.gsiCredit}
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
                        <button type="button" className="cal-nav" aria-label={copy.ui.previousMonth} onClick={() => setMonth((m) => shiftMonth(m, -1))}>
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <path d="M10 3.5 5.5 8l4.5 4.5" />
                        </svg>
                      </button>
                      <strong>
                        {copy.monthLabel(calendar.y, calendar.m)}
                      </strong>
                      <button type="button" className="cal-nav" aria-label={copy.ui.nextMonth} onClick={() => setMonth((m) => shiftMonth(m, 1))}>
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <path d="M6 3.5 10.5 8 6 12.5" />
                        </svg>
                      </button>
                    </div>
                    <div className="cal-week">
                      {copy.week.map((w, i) => (
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
                          aria-label={copy.dateLabel(c.iso)}
                          onPointerEnter={() => peekDate(c.iso)}
                          onClick={() => {
                            addAction('date_changed', { date: c.iso });
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
                          <strong>{copy.dateLabel(iso)}</strong>
                          {sun && (
                            <span>
                              {copy.ui.sunrise} {sun.rise !== null ? formatClock(sun.rise) : '-'} · {copy.ui.sunset}{' '}
                              {sun.set !== null ? formatClock(sun.set) : '-'} · {copy.ui.daylight} {copy.dayLength(sun.rise, sun.set)}
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
                      data-base={pop.baseMinutes}
                      data-seq={pop.seq}
                      drawable=""
                    >
                      <div className="pop-head">
                        <strong>{pop.label}</strong>
                        <small>{pop.target === 'start' ? copy.ui.startTime : copy.ui.elapsedTime}</small>
                        <small>
                          {copy.ui.sunrise} {daylight?.rise != null ? formatClock(daylight.rise) : '-'} · {copy.ui.sunset}{' '}
                          {daylight?.set != null ? formatClock(daylight.set) : '-'}
                        </small>
                      </div>
                      <div className="drums">
                        <span className="drum-slot" data-drum-slot="h" data-focus="" />
                        <span className="drum-colon">:</span>
                        <span className="drum-slot" data-drum-slot="m" />
                      </div>
                      <div className="pop-foot">
                        <small>{pop.target === 'start' ? copy.ui.startClockHint : copy.ui.elapsedClockHint}</small>
                        <button type="button" className="pop-btn" onClick={() => engineRef.current?.closePop(false)}>
                          {copy.ui.cancel}
                        </button>
                        <button type="button" className="pop-btn pop-ok" onClick={() => engineRef.current?.closePop(true)}>
                          {copy.ui.confirm}
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
            {/* the photo of the view, as a print the engine floats over the map, front and back; its buttons stay real buttons */}
            <div
              className="photo"
              data-piece="photo"
              data-face="front"
              drawable=""
              role="dialog"
              aria-label={copy.ui.imageOfView}
              aria-hidden={!shotOpen}
            >
              <div className="photo-frame" style={{ aspectRatio: String(shot?.aspect ?? 16 / 10) }}>
                {shot && (
                  <img
                    className="photo-shot"
                    src={shot.url}
                    alt={copy.ui.imageOfView}
                    onLoad={() => engineRef.current?.showPhoto()}
                  />
                )}
              </div>
              <div className="photo-foot">
                <span className="photo-caption">
                  {copy.photoAppName}<small>{route?.name}</small>
                </span>
                <span className="photo-actions">
                  <button type="button" onClick={saveShot}>
                    {copy.ui.save}
                  </button>
                  <button
                    type="button"
                    onClick={() => void copyShot().then((ok) => ok && setToast(copy.toast.imageCopied))}
                  >
                    {copy.ui.copyImage}
                  </button>
                  <button type="button" className="photo-post" onClick={() => void postShot()}>
                    {copy.ui.postToX}
                  </button>
                  <button type="button" onClick={() => engineRef.current?.hidePhoto('button')}>
                    {copy.ui.close}
                  </button>
                </span>
              </div>
            </div>
            <div className="photo photo-back" data-piece="photo" data-face="back" drawable="" aria-hidden="true">
              <div className="photo-frame" style={{ aspectRatio: String(shot?.aspect ?? 16 / 10) }}>
                <img className="photo-logo" src="/gpx-topo-logo.png" alt="" />
                <span>{copy.photoAppName}</span>
              </div>
              <div className="photo-foot" />
            </div>
            {/* the (i) flag: a pirate flag the engine drops onto the map and flies in the wind; its links stay real links */}
            <div ref={flagRef} className="flag" data-piece="flag" drawable="" role="dialog" aria-label={`${copy.appName} ${copy.about}`} aria-hidden={!infoOpen}>
              <FlagContent brushes={flagBrushes} copy={copy} />
            </div>
          </div>

          {/* the bar: each button is drawn as a key on a slab in front of the camera, and still is the button */}
          <nav className="hud" data-hud="" aria-label={copy.ui.controls}>
            <div className="bar" data-piece="bar" drawable="">
              <span className="well" data-well="open" />
              <span className="well" data-well="place" />
              <span className="well well-flip" data-well="flip" />
              <span className="well" data-well="fly" />
              {flyoverPlaying && (
                <span className="well" data-well="stop" data-appear="" />
              )}
              <span className="well" data-well="camera" />
              <span className="bar-hint">
                {copy.ui.dragHint}
                <br />
                {copy.ui.scrollHint}
              </span>
            </div>
            <button
              type="button"
              className="key key-open"
              data-piece="key"
              data-key="open"
              drawable=""
              onClick={() => {
                addAction('gpx_file_picker_opened');
                fileRef.current?.click();
              }}
            >
              {copy.ui.openGpx}
            </button>
            <button
              type="button"
              className="key key-place"
              data-piece="key"
              data-key="place"
              data-latched={placing ? '' : undefined}
              drawable=""
              aria-pressed={placing}
              onClick={() => {
                addAction('waypoint_placement_toggled', { enabled: !placing });
                setPlacing((on) => !on);
              }}
            >
              {placing ? copy.ui.clickRouteMode : copy.ui.addWaypoint}
            </button>
            <button
              type="button"
              className="key key-flip"
              data-piece="key"
              data-key="flip"
              data-face="front"
              drawable=""
              tabIndex={apart ? -1 : 0}
              onClick={() => {
                addAction('view_mode_toggled', { target: 'raised' });
                engineRef.current?.toggle();
              }}
            >
              {copy.ui.raise}
            </button>
            <button
              type="button"
              className="key key-flip"
              data-piece="key"
              data-key="flip"
              data-face="back"
              drawable=""
              tabIndex={apart ? 0 : -1}
              onClick={() => {
                addAction('view_mode_toggled', { target: 'flat' });
                engineRef.current?.toggle();
              }}
            >
              {copy.ui.layFlat}
            </button>
            <button
              type="button"
              className={`key key-fly${flyoverRunning ? ' key-flip' : ''}`}
              data-piece="key"
              data-key="fly"
              data-playing={flyoverRunning ? '' : undefined}
              drawable=""
              aria-label={flyoverPlaying ? (flyoverPaused ? copy.ui.flyoverResume : copy.ui.flyoverPause) : copy.ui.flyoverPlay}
              aria-pressed={flyoverPlaying}
              disabled={flyoverReturning}
              onClick={() => {
                addAction('flyover_control', { action: flyoverPlaying ? (flyoverPaused ? 'resume' : 'pause') : 'play' });
                if (flyoverPlaying) engineRef.current?.toggleFlyoverPause();
                else engineRef.current?.flyover();
              }}
            >
              {flyoverPlaying ? (flyoverPaused ? '▶' : 'Ⅱ') : '▶'}
            </button>
            {flyoverPlaying && (
              <button
                type="button"
                className="key key-stop"
                data-piece="key"
                data-key="stop"
                data-appear=""
                drawable=""
                aria-label={copy.ui.flyoverStop}
                onClick={() => {
                  addAction('flyover_control', { action: 'stop' });
                  engineRef.current?.flyover();
                }}
              >
                ■
              </button>
            )}
            <button type="button" className="key key-camera" data-piece="key" data-key="camera" drawable="" aria-label={copy.ui.captureImage} onClick={() => void exportPng()}>
              <svg className="camera-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M7.5 6.5 9 4h6l1.5 2.5H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h3.5Z" />
                <circle cx="12" cy="12.5" r="3.5" />
              </svg>
            </button>
          </nav>
        </div>
      </canvas>

      <div ref={flagTwinRef} className="flag flag-twin" aria-hidden="true">
        <FlagContent brushes={[]} copy={copy} twin />
      </div>
      <button
        type="button"
        className="info-button"
        aria-label={copy.ui.helpLinks}
        title={copy.ui.helpLinks}
        aria-pressed={infoOpen}
        disabled={flyoverPlaying || flyoverReturning}
        onClick={() => engineRef.current?.toggleInfo()}
      >
        i
      </button>

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
