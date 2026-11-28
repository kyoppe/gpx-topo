import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { renderBasemaps, streamNames, streamRelief, type MapStyle } from './basemap';
import { cropElevationGrid, gpxElevationGrid, loadDemGrid, tutorialElevationGrid, type ElevationGrid } from './dem';
import {
  createEngine,
  FRAME_X,
  FRAME_Y,
  pageFit,
  type DetailRequest,
  type Engine,
  type EngineModel,
  type FlightPhase,
  type FpvViewState,
  type HudHitArea,
} from './engine';
import { calculateStats, parseGpx, serializeGpx, type GpxRoute, type Waypoint } from './gpx';
import { createCenteredProjection, createMapProjection, pathD, projectTrack, type MapProjection } from './geo';
import { searchGsiAddress } from './gsiSearch';
import { installFallbackPaint, type FallbackPaint } from './fallbackPaint';
import { getHtmlInCanvasContext, supportsHtmlInCanvas, type HtmlInCanvasElement } from './htmlInCanvas';
import { createFallbackUi, FallbackDialog, FallbackTimePicker, KeyFace, listenDialogEscape, PanelTabs, SheetGrip, type PanelTabId } from './fallbackUi';
import { DOCK_WIDTH, compactHudSize, fallbackLayoutFor, isCompactBar, isDocked } from './fallbackLayout';
import { fallbackPerformanceFor } from './fallbackPerf';
import { canShareFile, isTouchDevice, mediaActions, plainMimeType, saveFailureMessage, shareFile, type MediaActions } from './mediaShare';
import { fallbackEnabled, resolveRenderPath } from './renderPath';
import { shouldSwitchToGpxAfterFileLoad, toggleViewMode, type ViewMode } from './mapMode';
import { shouldShowCurrentLocationControl } from './currentLocationControl';
import { MAP_MANEUVER_KINDS, type MapManeuverKind, type MapManeuverPhase } from './mapManeuver';
import { buildMapPermalink, normalizeMapPinLabel, parseMapPermalink, stripMapPermalinkParameters, type MapPermalinkPan, type MapPermalinkPin, type MapPermalinkSunSpeed } from './mapPermalink';
import { MapCredit } from './MapCredit';
import { CurrentLocationError, requestCurrentLocation, type CurrentLocation } from './geolocation';
import { fromPermalinkView, toPermalinkView, type PermalinkFrame } from './permalinkView';
import { ensureWaypoints, highestIndex, nextWaypointName, parseKm, planWaypoints, pointAtKm, trackProgress } from './plan';
import { isGoogleMapsUrl, normalizeSearchResponse, parseMapSearchInput, type Coordinates, type SearchLocation } from './mapSearch';
import { regionForCoordinates, type CoverageRegion } from './regions';
import { shareTextWithPermalink } from './sharePermalink';
import { formatClock, instantFor, parseClock, solarPosition, sunTimes } from './sun';
import { FlagContent, useFlagBrushes } from './Flag';
import { CurrentLocationButton } from './CurrentLocationButton';
import { detectLanguage, getCopy, type Copy } from './i18n';
import {
  legacyFixtureProjectionScale,
  resolveInitialMapViewport,
  shouldWaitForInitialMapViewport,
  type GpxRestoreState,
} from './initialMapViewport';
import { addAction, reportError, reportInfo, reportWarning, startVital } from './observability';
import { loadGpx, loadPlan, loadStart, loadView, saveGpx, savePlan, saveStart, saveView, startNow, type MapViewport } from './session';
import { buildTerrain } from './terrain';
import { MAX_VIDEO_RECORDING_MS, VIDEO_RECORDING_FRAME_RATE, supportedVideoMimeType, videoFileName } from './video';

/** Where the map opens when there is no permalink, saved view, or restored GPX: Mt. Fuji, the whole cone in frame. */
const DEFAULT_MAP_VIEWPORT: MapViewport = { lat: 35.3606, lon: 138.7274, scale: 5000 };
/** The tutorial's GPX steps use a real route, the SFMT 110 km, loaded only when the tutorial needs it. */
async function loadTutorialRoute() {
  const { default: text } = await import('./tutorialRoute.gpx?raw');
  return ensureWaypoints(parseGpx(text));
}
const PANEL_WIDTH = 400;
const PAD = 20;
const MIN_PAGE_WIDTH = 1080;
const MIN_PAGE_HEIGHT = 640;
/** Height lattice nodes per map px: a quick first pass, then as fine as one texture allows. */
const COARSE_DENSITY = 0.4;
const FINE_DENSITY = 2.5;
const MAX_LATTICE = 2047;
const MAX_DEM_CACHE_ENTRIES = 2;
/** Extra map pixels kept around the viewport so flat-map dragging never exposes an empty edge. */
const MAP_PAN_BUFFER = 512;
/** DEM prefetch extends beyond the visual drag buffer so the next viewport is already covered. */
const DEM_PREFETCH = MAP_PAN_BUFFER * 2;
const PROFILE_WIDTH = PANEL_WIDTH - 36;
const PROFILE_HEIGHT = 84;
const MAP_SUN_SPEEDS = [12, 24, 72] as const;
const MAP_SUN_SPEED_NAMES: readonly MapPermalinkSunSpeed[] = ['slow', 'normal', 'fast'];
const MAP_SUN_FPS = 30;
const MAP_SUNRISE_OFFSET = 60;

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

function flatElevationGrid(nx: number, ny: number): ElevationGrid {
  return { nx, ny, values: new Float32Array((nx + 1) * (ny + 1)), source: 'flat' };
}

function parseGpxWithVital(xml: string, source: 'file' | 'restore'): GpxRoute {
  const stop = startVital('gpx_parse', { source });
  try {
    const parsed = parseGpx(xml);
    stop('ok', { point_count: parsed.points.length });
    return parsed;
  } catch (error) {
    stop('error');
    throw error;
  }
}

type DemCache = {
  projection: MapProjection;
  grid: ElevationGrid;
};

type DemLoadRequest = {
  controller: AbortController;
  projection: MapProjection;
  region: CoverageRegion;
  coarse: Promise<ElevationGrid>;
  fine: Promise<ElevationGrid>;
  coarseGrid: ElevationGrid | null;
  coarseError: unknown | null;
  consumers: number;
  settled: boolean;
  abortQueued: boolean;
};

function demCacheKey(region: CoverageRegion, projection: MapProjection) {
  return [
    region,
    projection.width,
    projection.height,
    projection.scale,
    projection.originX,
    projection.originY,
  ]
    .map((value) => String(value))
    .join('|');
}

function createDemLoadRequest(
  sourceProjection: MapProjection,
  coarseNx: number,
  coarseNy: number,
  fineNx: number,
  fineNy: number,
  coverageRegion: CoverageRegion,
): DemLoadRequest {
  const controller = new AbortController();
  let resolveCoarse!: (grid: ElevationGrid) => void;
  let rejectCoarse!: (error: unknown) => void;
  let resolveFine!: (grid: ElevationGrid) => void;
  let rejectFine!: (error: unknown) => void;
  const request: DemLoadRequest = {
    controller,
    projection: sourceProjection,
    region: coverageRegion,
    coarse: new Promise<ElevationGrid>((resolve, reject) => {
      resolveCoarse = resolve;
      rejectCoarse = reject;
    }),
    fine: new Promise<ElevationGrid>((resolve, reject) => {
      resolveFine = resolve;
      rejectFine = reject;
    }),
    coarseGrid: null,
    coarseError: null,
    consumers: 0,
    settled: false,
    abortQueued: false,
  };
  const { signal } = controller;
  void (async () => {
    const stopCoarse = startVital('dem_load', { phase: 'coarse', nx: coarseNx, ny: coarseNy }, signal);
    try {
      const first = await loadDemGrid(sourceProjection, coarseNx, coarseNy, signal, coverageRegion, 'coarse');
      stopCoarse('ok');
      request.coarseGrid = first;
      resolveCoarse(first);
    } catch (error) {
      stopCoarse(signal.aborted ? 'aborted' : 'error');
      request.coarseError = error;
      rejectCoarse(error);
      rejectFine(error);
      request.settled = true;
      return;
    }

    const stopFine = startVital('dem_load', { phase: 'fine', nx: fineNx, ny: fineNy }, signal);
    try {
      const fine = await loadDemGrid(sourceProjection, fineNx, fineNy, signal, coverageRegion, 'fine');
      stopFine('ok');
      resolveFine(fine);
    } catch (error) {
      stopFine(signal.aborted ? 'aborted' : 'error');
      rejectFine(error);
    } finally {
      request.settled = true;
    }
  })();
  return request;
}

function rememberDemCache(cache: Map<string, DemCache>, key: string, value: DemCache) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > MAX_DEM_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function acquireDemRequest(request: DemLoadRequest) {
  request.consumers += 1;
  request.abortQueued = false;
}

function releaseDemRequest(request: DemLoadRequest) {
  request.consumers = Math.max(0, request.consumers - 1);
  if (request.consumers > 0 || request.settled || request.abortQueued) return;
  request.abortQueued = true;
  queueMicrotask(() => {
    request.abortQueued = false;
    if (request.consumers === 0 && !request.settled) request.controller.abort();
  });
}

function projectionRect(source: MapProjection, target: MapProjection) {
  if (Math.abs(source.scale - target.scale) > 1e-6) return null;
  const x = (target.originX - source.originX) * source.scale;
  const y = (target.originY - source.originY) * source.scale;
  if (x < -0.5 || y < -0.5 || x + target.width > source.width + 0.5 || y + target.height > source.height + 0.5) return null;
  return { x: Math.max(0, x), y: Math.max(0, y) };
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

type GpxSource = 'user';
type PendingGpxFile = { file: File; xml: string; route: GpxRoute };

type LatestMedia = 'photo' | 'video';
type HintKind = LatestMedia | 'permalink' | 'map-pin';

type MapBuffer = {
  flat: HTMLCanvasElement;
  relief: HTMLCanvasElement;
  density: number;
  pad: number;
};

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

/** Fallback: a photo or a video made here, with the file the share sheet takes. */
type FallbackMedia = { kind: 'photo' | 'video'; url: string; blob: Blob; file: File; actions: MediaActions };

export async function shareFallbackMedia(
  media: Pick<FallbackMedia, 'file' | 'actions'>,
  shareText: string,
  currentPermalink: () => string | null,
  dependencies: {
    share: typeof shareFile;
    onShared: () => void;
    save: () => void;
    warn: (error: unknown) => void;
  },
) {
  if (media.actions !== 'save') {
    try {
      const permalink = currentPermalink();
      const text = permalink ? shareTextWithPermalink(shareText, permalink) : shareText;
      const result = await dependencies.share(media.file, text);
      if (result === 'shared') dependencies.onShared();
      if (result !== 'unsupported') return;
    } catch (error) {
      dependencies.warn(error);
      // with a Save key of its own beside it, a sheet that is busy or refused is left alone
      if (media.actions === 'split') return;
    }
  }
  dependencies.save();
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

/**
 * Inside the canvas (native) the page renders where it always has. The fallback renders the same
 * page into an ordinary element, because a browser without HTML-in-Canvas does not lay out canvas children.
 */
function StageHost({ host, children }: { host: HTMLElement | null; children: ReactNode }) {
  return host ? createPortal(children, host) : <>{children}</>;
}

/** The sun slider, wherever the page keeps it: in the sheet (native), or in the visible side panel (fallback). */
function sunInput(root: ParentNode | null): HTMLInputElement | null {
  return root?.querySelector<HTMLInputElement>('input[data-sun]') ?? null;
}

function Fallback({ copy }: { copy: Copy }) {
  return (
    <main lang={copy.language} className="unsupported">
      <div className="unsupported-card">
        <p className="unsupported-mark">{copy.appName}</p>
        <h1>{copy.fallbackTitle}</h1>
        <p>{copy.fallbackBody}</p>
      </div>
    </main>
  );
}

export default function App() {
  const [renderPath] = useState(() => resolveRenderPath(supportsHtmlInCanvas(), fallbackEnabled()));
  const native = renderPath === 'native';
  const tutorialParams = new URLSearchParams(window.location.search);
  const tutorialMode = tutorialParams.get('tutorial');
  const tutorialGpx = tutorialMode === 'gpx';
  // The tutorial page keeps one frame open and moves it from step to step with messages, so the screen
  // changes in place instead of reloading. The query only says where the first step starts.
  const [tutorial, setTutorial] = useState(() => ({
    mode: tutorialGpx ? ('gpx' as ViewMode) : ('map' as ViewMode),
    step: Math.max(0, Number(tutorialParams.get('step') ?? 0) || 0),
    target: tutorialParams.get('target') ?? '',
  }));
  const tutorialStep = tutorial.step;
  const tutorialTarget = tutorial.target;
  // The fallback renders the page into an ordinary element beside the canvas; null on the native path.
  // It exists from the first render, so every ref in the page is set in the same commit as on the native path.
  const [fallbackHost] = useState<HTMLDivElement | null>(() => (renderPath === 'fallback' ? document.createElement('div') : null));
  const fallbackMountRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const mount = fallbackMountRef.current;
    if (!fallbackHost || !mount) return;
    mount.append(fallbackHost);
    return () => fallbackHost.remove();
  }, [fallbackHost]);
  // The fallback's visible controls (side panel, bar, dialogs); null on the native path, where they are in the scene.
  const [fb] = useState(() => (renderPath === 'fallback' ? createFallbackUi() : null));
  const fbMountRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const mount = fbMountRef.current;
    if (!fb || !mount) return;
    mount.append(fb.root);
    const stop = fb.connect();
    return () => {
      stop();
      fb.root.remove();
    };
  }, [fb]);
  // the sheet (a window too small for a docked panel): folded down at first, and showing the route's cards when pulled up
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTabId>('route');
  const [language] = useState(detectLanguage);
  const copy = useMemo(() => getCopy(language), [language]);
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = copy.appName;
  }, [copy.appName, language]);
  const [permalink] = useState(() => parseMapPermalink(window.location.search));
  const [savedView] = useState(() => (tutorialMode ? null : loadView()));
  const [route, setRoute] = useState<GpxRoute | null>(null);
  const [fileName, setFileName] = useState('');
  const [gpxSource, setGpxSource] = useState<GpxSource | null>(null);
  const [gpxRestoreState, setGpxRestoreState] = useState<GpxRestoreState>(() => (tutorialMode ? 'ready' : 'pending'));
  const [gpxDirty, setGpxDirty] = useState(false);
  const [pendingGpxFile, setPendingGpxFile] = useState<PendingGpxFile | null>(null);
  // the start set last time carries over; a GPX opened afresh starts now (see onFile)
  const [startTime, setStartTime] = useState(() => loadStart()?.time ?? '06:00');
  const [date, setDate] = useState(() => permalink?.date ?? (permalink ? todayIso() : loadStart()?.date ?? todayIso()));
  const [dateExplicit, setDateExplicit] = useState(() => Boolean(permalink?.date));
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  /** the projection whose whole map has finished drawing */
  const [basemap, setBasemap] = useState<MapProjection | null>(null);
  const [baseMapStyle, setBaseMapStyle] = useState<MapStyle>(() => permalink?.mapStyle ?? savedView?.baseMapStyle ?? 'pale');
  const [hillshade, setHillshade] = useState(() => permalink?.hillshade ?? savedView?.hillshade ?? true);
  const [mapSunlight, setMapSunlight] = useState(() => (permalink?.sun === 'off' ? false : permalink?.sun ? true : savedView?.mapSunlight ?? true));
  const [mapSunAuto, setMapSunAuto] = useState(false);
  const [mapSunSpeed, setMapSunSpeed] = useState(() => MAP_SUN_SPEED_NAMES.indexOf(permalink?.sunSpeed ?? 'normal'));
  const [mapLoading, setMapLoading] = useState(false);
  const [demLoading, setDemLoading] = useState(false);
  const [mapSwitchOpen, setMapSwitchOpen] = useState(false);
  const [demGrid, setDemGrid] = useState<DemCache | null>(null);
  const demCacheRef = useRef(new Map<string, DemCache>());
  const demRequestsRef = useRef(new Map<string, DemLoadRequest>());
  const [apart, setApart] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('map');
  const [mapViewport, setMapViewport] = useState<MapViewport | null>(() => {
    if (tutorialMode === 'map') return DEFAULT_MAP_VIEWPORT;
    // a permalink with its display area sets the scale itself (below), from the frame this window has
    if (permalink?.center && savedView?.mapViewport && !permalink.area) return { ...savedView.mapViewport, ...permalink.center };
    if (permalink?.center) return null;
    return savedView?.mapViewport ?? null;
  });
  const [mapSearch, setMapSearch] = useState('');
  const [mapSearchResults, setMapSearchResults] = useState<SearchLocation[]>([]);
  const [mapSearchLocation, setMapSearchLocation] = useState<SearchLocation | null>(null);
  const [mapSearchBusy, setMapSearchBusy] = useState(false);
  const [mapSearchError, setMapSearchError] = useState<string | null>(null);
  const [mapPin, setMapPin] = useState<MapPermalinkPin | null>(() => permalink?.pin ?? null);
  const [currentLocation, setCurrentLocation] = useState<CurrentLocation | null>(null);
  const [currentLocationBusy, setCurrentLocationBusy] = useState(false);
  const [mapPinRemoving, setMapPinRemoving] = useState(false);
  const [mapPinSelecting, setMapPinSelecting] = useState(false);
  const [fpvSelecting, setFpvSelecting] = useState(false);
  const [fpvActive, setFpvActive] = useState(false);
  const [fpvView, setFpvView] = useState<FpvViewState | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  /** the photo of the view: its picture, while it is out of the camera key */
  const [shot, setShot] = useState<{ url: string; blob: Blob; aspect: number } | null>(null);
  const [shotOpen, setShotOpen] = useState(false);
  /** Fallback: the photo or the video just made. It has a dialog of its own (the scene's print is not there) to share or save from. */
  const [fbMedia, setFbMedia] = useState<FallbackMedia | null>(null);
  const [latestMedia, setLatestMedia] = useState<LatestMedia | null>(null);
  const [xHint, setXHint] = useState<{ kind: HintKind; seq: number; phase: 'in' | 'out' } | null>(null);
  const [videoRecording, setVideoRecording] = useState(false);
  const flagRef = useRef<HTMLDivElement>(null);
  const flagTwinRef = useRef<HTMLDivElement>(null);
  const flagBrushes = useFlagBrushes(flagRef, flagTwinRef);
  const [placing, setPlacing] = useState(false);
  const [showHigh, setShowHigh] = useState(false);
  const [addKm, setAddKm] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [detailWanted, setDetailWanted] = useState<DetailRequest | null>(null);
  const [detailShown, setDetailShown] = useState<DetailRequest | null>(null);
  const [flyoverPhase, setFlyoverPhase] = useState<FlightPhase | null>(null);
  const [mapManeuverMenuOpen, setMapManeuverMenuOpen] = useState(false);
  const [mapManeuver, setMapManeuver] = useState<{ kind: MapManeuverKind; phase: MapManeuverPhase } | null>(null);
  const [pop, setPop] = useState<Pop | null>(null);
  const [month, setMonth] = useState(() => date.slice(0, 7));
  const [peek, setPeek] = useState<string | null>(null);
  const popSeq = useRef(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hudHitLayerRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<Engine | null>(null);
  const routeNameRef = useRef<string | null>(null);
  const videoRecorderRef = useRef<MediaRecorder | null>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const videoChunksRef = useRef<Blob[]>([]);
  const videoRecordingRef = useRef(false);
  const videoTimerRef = useRef<number | null>(null);
  const videoFrameRafRef = useRef<number | null>(null);
  const videoCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoLastFrameRef = useRef(0);
  const videoFrameErrorRef = useRef(false);
  const videoStartedAtRef = useRef(0);
  const videoStartedAtDateRef = useRef<Date | null>(null);
  const videoStopReasonRef = useRef<'manual' | 'max_duration'>('manual');
  const xHintTimerRef = useRef<number | null>(null);
  const xHintExitTimerRef = useRef<number | null>(null);
  const xHintSeqRef = useRef(0);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const flatRef = useRef<HTMLCanvasElement | null>(null);
  const reliefRef = useRef<HTMLCanvasElement | null>(null);
  const photoRef = useRef<HTMLCanvasElement | null>(null);
  const detailRef = useRef<HTMLCanvasElement | null>(null);
  /** the part of the map the detail canvas holds now */
  const detailDrawn = useRef<DetailRequest | null>(null);
  const mapProjectionRef = useRef<MapProjection | null>(null);
  const basemapRef = useRef<MapProjection | null>(null);
  const mapBufferRef = useRef<MapBuffer | null>(null);
  const mapDragOffsetRef = useRef<[number, number]>([0, 0]);
  const apartRef = useRef(false);
  const viewModeRef = useRef<ViewMode>('map');
  const pendingViewModeRef = useRef<ViewMode | null>(null);
  const enterGpxAfterLoadRef = useRef(false);
  const [modeTransition, setModeTransition] = useState<ViewMode | null>(null);
  const modeTransitionTimerRef = useRef<number | null>(null);
  const modeTransitionSeqRef = useRef(0);
  const viewRestoredRef = useRef(false);
  const permalinkApplyingRef = useRef(false);
  // what the permalink's saved pan is multiplied by: this frame's ground scale over the one it was made at
  // the pan of a permalink made with a display area, put back for this window (set when the map viewport is made)
  const permalinkFitRef = useRef<{ pan: MapPermalinkPan | null } | null>(null);
  const permalinkAppliedRef = useRef(false);
  const permalinkDetachedRef = useRef(false);
  const mapPinPlacedAtRef = useRef<number | null>(null);
  const currentLocationRequestRef = useRef(0);
  const currentLocationRecenterRef = useRef(false);
  const pendingCurrentLocationRef = useRef<{ requestId: number; location: CurrentLocation } | null>(
    permalink?.currentPin ? { requestId: 0, location: permalink.currentPin } : null,
  );
  const mapSearchRequestRef = useRef(0);
  const autoSunDispatchRef = useRef(false);
  const touchedRef = useRef(false);
  const fileRequestRef = useRef(0);
  const detachPermalink = useCallback(
    (reason: string) => {
      const url = new URL(window.location.href);
      if (url.searchParams.get('mode') !== 'map' || permalinkDetachedRef.current || permalinkApplyingRef.current) return;
      stripMapPermalinkParameters(url.searchParams);
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
      permalinkDetachedRef.current = true;
      addAction('map_permalink_detached', { reason });
    },
    [permalink],
  );
  const cancelCurrentLocationRequest = useCallback((resetBusy = true) => {
    currentLocationRequestRef.current += 1;
    pendingCurrentLocationRef.current = null;
    currentLocationRecenterRef.current = false;
    if (resetBusy) setCurrentLocationBusy(false);
  }, []);
  const invalidateMapSearchRequest = useCallback(() => {
    mapSearchRequestRef.current += 1;
    setMapSearchBusy(false);
  }, []);
  const syncHudHitAreas = useCallback((areas: HudHitArea[]) => {
    const layer = hudHitLayerRef.current;
    if (!layer) return;
    const byKey = new Map<string, HudHitArea>();
    for (const area of areas) byKey.set(area.key, area);
    layer.querySelectorAll<HTMLElement>('[data-hud-hit]').forEach((button) => {
      const area = byKey.get(button.dataset.hudHit ?? '');
      if (!area || button.hidden) {
        button.style.display = 'none';
        return;
      }
      button.style.display = 'block';
      button.style.left = `${area.x}px`;
      button.style.top = `${area.y}px`;
      button.style.width = `${Math.max(1, area.width)}px`;
      button.style.height = `${Math.max(1, area.height)}px`;
    });
  }, []);
  const statsCacheRef = useRef<{ points: GpxRoute['points']; stats: ReturnType<typeof calculateStats> } | null>(null);
  routeNameRef.current = route?.name ?? null;
  apartRef.current = apart;
  viewModeRef.current = viewMode;

  // Fallback: a wide, tall window keeps the panel beside the map (the canvas gives it room); a smaller one has a drawer.
  const docked = fb !== null && isDocked(viewport.width, viewport.height);
  const hudWidth = viewport.width - (docked ? DOCK_WIDTH : 0);
  // a narrow bar has one key for the first person view and the aerial shots; a wider one has a key of each, as the scene does
  const compactBar = fb !== null && isCompactBar(hudWidth);
  const compactSize = compactBar ? compactHudSize(hudWidth) : 'wide';
  const layout = useMemo(
    () => (fb ? fallbackLayoutFor(hudWidth, viewport.height) : layoutFor(viewport.width, viewport.height)),
    [fb, hudWidth, viewport],
  );
  // what a permalink needs to know of this window: the sheet, the map on it, and how the sheet is fitted to the stage
  const permalinkFrame = useMemo<PermalinkFrame>(
    () => ({
      pageWidth: layout.pageWidth,
      pageHeight: layout.pageHeight,
      mapX: layout.mapX,
      mapY: layout.mapY,
      mapWidth: layout.mapWidth,
      mapHeight: layout.mapHeight,
      fit: pageFit(viewport.width - (docked ? DOCK_WIDTH : 0), viewport.height, layout.pageWidth, layout.pageHeight),
    }),
    [docked, layout, viewport],
  );
  const points = route?.points ?? null;
  const gpxProjection = useMemo(
    () => (points ? createMapProjection({ points }, layout.mapWidth, layout.mapHeight) : null),
    [points, layout.mapWidth, layout.mapHeight],
  );
  const legacyPermalinkScale = useMemo(
    () => legacyFixtureProjectionScale(layout.mapWidth, layout.mapHeight),
    [layout.mapHeight, layout.mapWidth],
  );
  const mapProjection = useMemo(
    () =>
      mapViewport
        ? createCenteredProjection(mapViewport.lat, mapViewport.lon, layout.mapWidth, layout.mapHeight, mapViewport.scale)
        : null,
    [mapViewport, layout.mapWidth, layout.mapHeight],
  );
  const projection = viewMode === 'map' ? mapProjection : gpxProjection;
  const coverageRegion: CoverageRegion = projection ? regionForCoordinates(projection.centerLat, projection.centerLon) : 'japan';
  const effectiveMapStyle: MapStyle = coverageRegion === 'united-states' ? 'std' : baseMapStyle;
  // Map-only prefetching is useful while flat for dragging, but the raised model
  // should use the same visible-area terrain pipeline as GPX mode.
  const flatMapMode = viewMode === 'map' && !apart;
  mapProjectionRef.current = mapProjection;
  basemapRef.current = basemap;
  const progress = useMemo(() => (points ? trackProgress(points) : null), [points]);
  const track = useMemo(() => (points && gpxProjection ? projectTrack(points, gpxProjection, 1.5) : []), [points, gpxProjection]);
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
    () => (gpxProjection ? plan.map((way) => ({ ...way, ...gpxProjection.project(way), ele: way.ele })) : []),
    [plan, gpxProjection],
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

  const grid = useMemo(() => {
    if (coverageRegion === 'unsupported' || !demGrid || !projection) return null;
    const rect = projectionRect(demGrid.projection, projection);
    if (!rect) return null;
    const nx = Math.max(1, Math.round((demGrid.grid.nx * projection.width) / demGrid.projection.width));
    const ny = Math.max(1, Math.round((demGrid.grid.ny * projection.height) / demGrid.projection.height));
    return cropElevationGrid(
      demGrid.grid,
      demGrid.projection.width,
      demGrid.projection.height,
      rect.x,
      rect.y,
      projection.width,
      projection.height,
      nx,
      ny,
    );
  }, [coverageRegion, demGrid, projection]);
  const terrain = useMemo(
    () => (grid && projection ? buildTerrain(grid, layout.mapWidth, layout.mapHeight, projection.metersPerPixel) : null),
    [grid, projection, layout.mapWidth, layout.mapHeight],
  );
  const mapReady = !!projection && basemap === projection;
  const mapDataLoading = mapLoading || demLoading;
  const canRaise = coverageRegion !== 'unsupported' && terrain !== null;
  const mapHillshade = coverageRegion === 'japan' && hillshade;

  const switchViewMode = useCallback(
    (next: ViewMode) => {
      if (fpvActive || fpvSelecting || mapManeuver || apart || modeTransition || next === viewMode || !engineRef.current?.isFlat()) return;
      detachPermalink('view_mode');
      const target = toggleViewMode(viewMode, true);
      if (target !== next) return;
      invalidateMapSearchRequest();
      if (viewMode === 'map' && target === 'gpx') cancelCurrentLocationRequest();
      if (target === 'map') {
        if (!gpxProjection) return;
        setMapViewport((current) => current ?? { lat: gpxProjection.centerLat, lon: gpxProjection.centerLon, scale: gpxProjection.scale });
      }
      const engine = engineRef.current;
      const transitionSeq = ++modeTransitionSeqRef.current;
      if (modeTransitionTimerRef.current !== null) window.clearTimeout(modeTransitionTimerRef.current);
      setMapSearchResults([]);
      setMapSearchLocation(null);
      setMapSearchError(null);
      setPop(null);
      setModeTransition(target);
      engine?.transitionPanels(false);
      modeTransitionTimerRef.current = window.setTimeout(() => {
        if (modeTransitionSeqRef.current !== transitionSeq) return;
        modeTransitionTimerRef.current = null;
        setViewMode(target);
        setModeTransition(null);
        addAction('view_mode_changed', { mode: target });
        window.requestAnimationFrame(() => {
          if (modeTransitionSeqRef.current === transitionSeq) engineRef.current?.transitionPanels(true);
        });
      }, 260);
    },
    [
      apart,
      cancelCurrentLocationRequest,
      detachPermalink,
      fpvActive,
      fpvSelecting,
      gpxProjection,
      invalidateMapSearchRequest,
      mapManeuver,
      modeTransition,
      viewMode,
    ],
  );
  const requestViewMode = useCallback(
    (next: ViewMode) => {
      if (fpvActive || fpvSelecting || mapManeuver) return;
      const engine = engineRef.current;
      if (!apart && engine?.isFlat()) {
        switchViewMode(next);
        return;
      }
      pendingViewModeRef.current = next;
      addAction('view_mode_switch_deferred', { mode: next });
      engine?.together();
    },
    [apart, fpvActive, fpvSelecting, mapManeuver, switchViewMode],
  );

  useEffect(() => {
    if (!pendingViewModeRef.current) return;
    let frame = 0;
    const settle = () => {
      const engine = engineRef.current;
      if (!engine) return;
      if (!engine.isFlat()) {
        frame = requestAnimationFrame(settle);
        return;
      }
      const next = pendingViewModeRef.current;
      pendingViewModeRef.current = null;
      if (next) switchViewMode(next);
    };
    frame = requestAnimationFrame(settle);
    return () => cancelAnimationFrame(frame);
  }, [apart, switchViewMode]);

  const openGpxPicker = () => {
    addAction('gpx_file_picker_opened');
    fileRef.current?.click();
  };

  const modeButtonAction = () => {
    if (viewMode === 'gpx') {
      requestViewMode('map');
      return;
    }
    if (gpxRestoreState === 'pending') return;
    if (gpxSource === 'user' && route) requestViewMode('gpx');
    // the tutorial has no file picker: the button brings up its sample route instead
    else if (tutorialMode) setTutorial((current) => ({ ...current, mode: 'gpx' }));
    else openGpxPicker();
  };

  const drawMapBuffer = useCallback((offset: [number, number]) => {
    const buffer = mapBufferRef.current;
    const flat = flatRef.current;
    const relief = reliefRef.current;
    if (!buffer || !flat || !relief) return;
    const sx = (buffer.pad - offset[0]) * buffer.density;
    const sy = (buffer.pad - offset[1]) * buffer.density;
    const sourceWidth = flat.width;
    const sourceHeight = flat.height;
    for (const [target, source] of [
      [flat, buffer.flat],
      [relief, buffer.relief],
    ] as const) {
      const context = target.getContext('2d');
      if (!context) continue;
      context.clearRect(0, 0, target.width, target.height);
      context.drawImage(source, sx, sy, sourceWidth, sourceHeight, 0, 0, target.width, target.height);
    }
    engineRef.current?.setFlatMapDragOffset(offset[0], offset[1]);
    engineRef.current?.refreshMap();
  }, []);
  const panMapPreview = useCallback(
    (dx: number, dy: number) => {
      const buffer = mapBufferRef.current;
      if (!buffer || buffer.pad <= 0) return;
      const [x, y] = mapDragOffsetRef.current;
      const next: [number, number] = [
        Math.max(-MAP_PAN_BUFFER, Math.min(MAP_PAN_BUFFER, x + dx)),
        Math.max(-MAP_PAN_BUFFER, Math.min(MAP_PAN_BUFFER, y + dy)),
      ];
      mapDragOffsetRef.current = next;
      drawMapBuffer(next);
    },
    [drawMapBuffer],
  );
  // How the map image stood when a two-finger move began moving it: a cancel puts it back exactly there. (The moves are
  // clamped to the buffer, so undoing their sum would not.)
  const mapDragBeginRef = useRef<[number, number] | null>(null);
  const beginMapDrag = useCallback(() => {
    mapDragBeginRef.current = [...mapDragOffsetRef.current];
  }, []);
  const cancelMapDrag = useCallback(() => {
    const begin = mapDragBeginRef.current;
    mapDragBeginRef.current = null;
    if (!begin) return;
    mapDragOffsetRef.current = begin;
    drawMapBuffer(begin);
  }, [drawMapBuffer]);
  const panMap = useCallback((dx: number, dy: number) => {
    const [offsetX, offsetY] = mapDragOffsetRef.current;
    const buffer = mapBufferRef.current;
    const panX = buffer?.pad === 0 ? dx : offsetX;
    const panY = buffer?.pad === 0 ? dy : offsetY;
    const current = mapProjectionRef.current;
    if (!current || (panX === 0 && panY === 0)) return;
    invalidateMapSearchRequest();
    cancelCurrentLocationRequest();
    detachPermalink('map_pan');
    addAction('map_pan_completed', {
      distance_px: Math.round(Math.hypot(panX, panY)),
      delta_x_px: Math.round(panX),
      delta_y_px: Math.round(panY),
    });
    setMapViewport((viewportState) => {
      if (!viewportState) return viewportState;
      const projection = createCenteredProjection(
        viewportState.lat,
        viewportState.lon,
        current.width,
        current.height,
        viewportState.scale,
      );
      const center = projection.inverse(projection.width / 2 - panX, projection.height / 2 - panY);
      return { ...viewportState, ...center };
    });
  }, [cancelCurrentLocationRequest, detachPermalink, invalidateMapSearchRequest]);
  const centerMap = useCallback(
    (center: Coordinates, source: string, location?: SearchLocation) => {
      if (apartRef.current) return;
      invalidateMapSearchRequest();
      cancelCurrentLocationRequest();
      if (regionForCoordinates(center.lat, center.lon) === 'unsupported') {
        setMapSearchResults([]);
        setMapSearchLocation(null);
        setMapSearchError(copy.ui.mapSearchUnsupported);
        addAction('map_search_unsupported_region', { source, region: 'unsupported' });
        return;
      }
      detachPermalink('map_center');
      setMapViewport((viewportState) => ({
        lat: center.lat,
        lon: center.lon,
        scale: viewportState?.scale ?? gpxProjection?.scale ?? 1,
      }));
      setMapSearchResults([]);
      setMapSearchLocation(location ?? null);
      setMapSearchError(null);
      setMapSearchBusy(false);
      addAction('map_search_selected', { source });
    },
    [cancelCurrentLocationRequest, copy.ui.mapSearchUnsupported, detachPermalink, gpxProjection, invalidateMapSearchRequest],
  );
  const searchMap = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      if (apartRef.current) return;
      const query = mapSearch.trim();
      if (!query) return;
      const googleMapsUrl = isGoogleMapsUrl(query);
      const coordinates = parseMapSearchInput(query);
      if (coordinates && !googleMapsUrl) {
        centerMap(coordinates, 'coordinates');
        return;
      }
      cancelCurrentLocationRequest();
      const request = ++mapSearchRequestRef.current;
      setMapSearchBusy(true);
      setMapSearchError(null);
      setMapSearchResults([]);
      setMapSearchLocation(null);
      try {
        let results: SearchLocation[];
        if (googleMapsUrl) {
          const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
          if (!response.ok) throw new Error(`Search failed: ${response.status}`);
          const body: unknown = await response.json();
          results = normalizeSearchResponse(body);
        } else {
          results = await searchGsiAddress(query);
        }
        if (request !== mapSearchRequestRef.current) return;
        if (googleMapsUrl && results.length > 0) {
          centerMap(results[0], 'google_maps_url', results[0]);
        } else {
          setMapSearchResults(results);
        }
        if (!results.length) setMapSearchError(copy.ui.mapSearchNoResults);
        addAction('map_search_requested', { source: googleMapsUrl ? 'google_maps_url' : 'gsi', result_count: results.length });
      } catch (error) {
        if (request === mapSearchRequestRef.current) {
          setMapSearchError(copy.ui.mapSearchFailed);
          reportWarning('map_search_failed', error);
        }
      } finally {
        if (request === mapSearchRequestRef.current) setMapSearchBusy(false);
      }
    },
    [cancelCurrentLocationRequest, centerMap, copy.ui.mapSearchFailed, copy.ui.mapSearchNoResults, mapSearch],
  );

  // elevation profile: distance across, height up
  /** The highest point of the route, from the file's elevations or else the terrain's. */
  const high = useMemo(() => {
    if (viewMode !== 'gpx' || !points || !progress || !gpxProjection) return null;
    const index = highestIndex(points);
    if (index >= 0) {
      const { x, y } = gpxProjection.project(points[index]);
      return { km: progress.km[index], ele: points[index].ele as number, x, y };
    }
    if (!terrain) return null;
    let best: { km: number; ele: number; x: number; y: number } | null = null;
    for (const p of track) {
      const ele = terrain.elev(p.x, p.y);
      if (!best || ele > best.ele) best = { km: progress.km[p.index], ele, x: p.x, y: p.y };
    }
    return best;
  }, [gpxProjection, points, progress, terrain, track, viewMode]);

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
    if (viewMode === 'map') return { min: 0, max: 1440 };
    const lastMinutes = plan.length ? plan[plan.length - 1].minutes : startMinutes + 600;
    return { min: startMinutes - 60, max: Math.max(startMinutes + 120, lastMinutes + 60) };
  }, [plan, startMinutes, viewMode]);
  useLayoutEffect(() => {
    const sun = sunInput(fb?.root ?? pageRef.current);
    if (!sun) return;
    const current = Number(sun.value);
    const bounded = Number.isFinite(current) ? Math.max(sunRange.min, Math.min(sunRange.max, current)) : 630;
    if (current !== bounded) sun.value = String(Math.round(bounded));
  }, [sunRange]);
  useEffect(() => {
    if (viewMode !== 'map' || !apart || !mapSunAuto || !mapSunlight) return;
    const sun = sunInput(fb?.root ?? pageRef.current);
    if (!sun) return;
    let frame = 0;
    let previous = performance.now();
    const speed = MAP_SUN_SPEEDS[mapSunSpeed];
    const tick = (now: number) => {
      if (now - previous < 1000 / MAP_SUN_FPS - 2) {
        frame = requestAnimationFrame(tick);
        return;
      }
      const elapsed = Math.min(0.1, Math.max(0, (now - previous) / 1000));
      previous = now;
      const current = Number(sun.value);
      const next = ((Number.isFinite(current) ? current : 0) + elapsed * speed) % 1440;
      autoSunDispatchRef.current = true;
      sun.value = String(next);
      sun.dispatchEvent(new Event('input', { bubbles: true }));
      autoSunDispatchRef.current = false;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [apart, mapSunAuto, mapSunlight, mapSunSpeed, viewMode]);
  useEffect(() => {
    if (viewMode !== 'map' || !apart || !mapSunlight) setMapSunAuto(false);
  }, [apart, mapSunlight, viewMode]);
  useEffect(() => {
    const sun = sunInput(fb?.root ?? pageRef.current);
    if (!sun) return;
    autoSunDispatchRef.current = true;
    sun.dispatchEvent(new Event('input', { bubbles: true }));
    autoSunDispatchRef.current = false;
  }, [mapSunAuto, mapSunSpeed]);
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
  // Restore a user-opened GPX from the previous session, if one was saved. With no saved GPX the app
  // simply opens on the map; no sample route is loaded.
  useEffect(() => {
    if (tutorialMode) {
      planReadyRef.current = true;
      return;
    }
    let cancelled = false;
    const initialRequest = fileRequestRef.current;
    const isCurrent = () => !cancelled && fileRequestRef.current === initialRequest && !touchedRef.current;
    void (async () => {
      try {
        const saved = await loadGpx();
        if (!isCurrent()) return;
        if (!saved) {
          setGpxRestoreState('none');
          return;
        }
        let parsed: GpxRoute;
        try {
          parsed = ensureWaypoints(parseGpxWithVital(saved.xml, 'restore'));
        } catch {
          setGpxRestoreState('none');
          return;
        }
        const savedPlan = await loadPlan<Waypoint>(saved.name);
        if (!isCurrent()) return;
        const next = savedPlan ? { ...parsed, name: savedPlan.title, waypoints: savedPlan.waypoints } : parsed;
        setRoute(next);
        setOverrides(savedPlan?.overrides ?? {});
        setFileName(saved.name);
        setGpxSource('user');
        setGpxRestoreState('ready');
        setGpxDirty(false);
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
        if (isCurrent()) {
          setGpxRestoreState('none');
          reportWarning('load_saved_gpx_session', error);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tutorialMode]);

  useEffect(() => {
    if (!enterGpxAfterLoadRef.current) return;
    if (viewMode !== 'map') {
      enterGpxAfterLoadRef.current = false;
      return;
    }
    if (gpxSource !== 'user' || !route || !gpxProjection || !engineRef.current) return;
    enterGpxAfterLoadRef.current = false;
    requestViewMode('gpx');
  }, [gpxProjection, gpxSource, requestViewMode, route, viewMode]);

  useEffect(() => {
    if (viewRestoredRef.current) return;
    if (viewMode === 'map' && !mapViewport) {
      // opened in a window of another size: keep the area the permalink showed in view, at the scale that fits it here;
      // with no permalink and no restored GPX, the map opens on the default view (Mt. Fuji)
      const fitted = permalink?.center && permalink.area ? fromPermalinkView(permalinkFrame, permalink.area, permalink.pan) : null;
      if (fitted) permalinkFitRef.current = { pan: fitted.pan };
      // a session GPX still restoring outranks the default view: wait for it, as the map did before
      if (shouldWaitForInitialMapViewport(permalink?.center ?? null, gpxProjection, gpxRestoreState)) return;
      setMapViewport(
        resolveInitialMapViewport({
          permalinkCenter: permalink?.center ?? null,
          fittedScale: fitted?.scale ?? null,
          savedMapViewport: savedView?.mapViewport ?? null,
          gpxProjection,
          legacyPermalinkScale: permalink?.center && !permalink.area ? legacyPermalinkScale : null,
          defaultViewport: DEFAULT_MAP_VIEWPORT,
        }),
      );
      return;
    }
    viewRestoredRef.current = true;
    addAction('view_state_restored', {
      restored: !!savedView,
      mode: viewMode,
      map_viewport: !!mapViewport,
      map_style: savedView?.baseMapStyle ?? 'pale',
    });
  }, [gpxProjection, gpxRestoreState, legacyPermalinkScale, mapViewport, permalink, permalinkFrame, savedView, viewMode]);

  useEffect(() => {
    if (!viewRestoredRef.current) return;
    const timer = window.setTimeout(
      () => saveView({ viewMode, mapViewport, baseMapStyle, hillshade, mapSunlight }),
      100,
    );
    return () => window.clearTimeout(timer);
  }, [baseMapStyle, hillshade, mapSunlight, mapViewport, viewMode]);

  // the plan is kept as it is changed, for the GPX it was made on (once that GPX is in, so as not to write over it)
  useEffect(() => {
    if (!planReadyRef.current || gpxSource !== 'user' || !route) return;
    const timer = window.setTimeout(
      () => void savePlan<Waypoint>({ file: fileName, title: route.name, waypoints: route.waypoints, overrides }),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [fileName, gpxSource, overrides, route]);

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
    const photo = photoRef.current;
    if (!projection || !flat || !relief || !photo) {
      setMapLoading(false);
      return;
    }
    if (coverageRegion === 'unsupported') {
      for (const canvas of [flat, relief, photo]) {
        canvas.width = 1;
        canvas.height = 1;
      }
      detailDrawn.current = null;
      mapBufferRef.current = null;
      setBasemap(null);
      setMapLoading(false);
      return;
    }
    const controller = new AbortController();
    setMapLoading(true);
    const density = Math.min(2, window.devicePixelRatio || 1);
    const pad = flatMapMode && coverageRegion !== 'united-states' ? MAP_PAN_BUFFER : 0;
    const renderProjection = pad
      ? createCenteredProjection(projection.centerLat, projection.centerLon, projection.width + pad * 2, projection.height + pad * 2, projection.scale)
      : projection;
    const snapshot = (source: HTMLCanvasElement) => {
      if (source.width < 2 || source.height < 2) return null;
      const copy = document.createElement('canvas');
      copy.width = source.width;
      copy.height = source.height;
      copy.getContext('2d')?.drawImage(source, 0, 0);
      return copy;
    };
    const previousFlat = basemapRef.current ? snapshot(flat) : null;
    const previousRelief = basemapRef.current ? snapshot(relief) : null;
    const previousPhoto = basemapRef.current ? snapshot(photo) : null;
    const nextFlat = document.createElement('canvas');
    const nextRelief = document.createElement('canvas');
    const nextPhoto = document.createElement('canvas');
    let animation = 0;
    const drawTransition = (alpha: number) => {
      const targetWidth = Math.max(1, Math.round(projection.width * density));
      const targetHeight = Math.max(1, Math.round(projection.height * density));
      if (flat.width !== targetWidth || flat.height !== targetHeight) {
        flat.width = targetWidth;
        flat.height = targetHeight;
      }
      if (relief.width !== targetWidth || relief.height !== targetHeight) {
        relief.width = targetWidth;
        relief.height = targetHeight;
      }
      if (photo.width !== targetWidth || photo.height !== targetHeight) {
        photo.width = targetWidth;
        photo.height = targetHeight;
      }
      const sourceX = Math.round(pad * density);
      const sourceY = sourceX;
      const sourceWidth = nextFlat.width - sourceX * 2;
      const sourceHeight = nextFlat.height - sourceY * 2;
      for (const [target, previous] of [
        [flat, previousFlat],
        [relief, previousRelief],
      ] as const) {
        const source = target === flat ? nextFlat : nextRelief;
        const context = target.getContext('2d');
        if (!context) continue;
        context.clearRect(0, 0, target.width, target.height);
        if (previous) {
          context.globalAlpha = 1 - alpha;
          context.drawImage(previous, 0, 0, target.width, target.height);
        }
        context.globalAlpha = alpha;
        context.drawImage(source, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, target.width, target.height);
        context.globalAlpha = 1;
      }
      const photoContext = photo.getContext('2d');
      if (photoContext) {
        photoContext.clearRect(0, 0, photo.width, photo.height);
        if (previousPhoto) {
          photoContext.globalAlpha = 1 - alpha;
          photoContext.drawImage(previousPhoto, 0, 0);
        }
        if (nextPhoto.width > 1 && nextPhoto.height > 1) {
          photoContext.globalAlpha = alpha;
          photoContext.drawImage(nextPhoto, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, photo.width, photo.height);
        }
        photoContext.globalAlpha = 1;
      }
      engineRef.current?.refreshMap();
    };
    const commit = () => {
      if (viewMode === 'map') {
        mapBufferRef.current = { flat: nextFlat, relief: nextRelief, density, pad };
        mapDragOffsetRef.current = [0, 0];
        engineRef.current?.setFlatMapDragOffset(0, 0);
      } else {
        mapBufferRef.current = null;
      }
      setBasemap(projection);
    };
    void renderBasemaps(
      renderProjection,
      density,
      { flat: nextFlat, relief: nextRelief, photo: nextPhoto },
      controller.signal,
      () => {},
      effectiveMapStyle,
      mapHillshade,
      coverageRegion,
    )
      .then(() => {
        if (controller.signal.aborted) return;
        setMapLoading(false);
        if (!previousFlat || !previousRelief) {
          drawTransition(1);
          commit();
          return;
        }
        const started = performance.now();
        const crossfade = (now: number) => {
          if (controller.signal.aborted) return;
          const progress = Math.min(1, (now - started) / 220);
          drawTransition(progress);
          if (progress < 1) {
            animation = requestAnimationFrame(crossfade);
          } else {
            commit();
          }
        };
        animation = requestAnimationFrame(crossfade);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          cancelCurrentLocationRequest();
          setMapLoading(false);
          reportError('load_basemap', error, { map_style: effectiveMapStyle });
          setToast(copy.toast.mapTilesFailed);
        }
      });
    return () => {
      controller.abort();
      cancelAnimationFrame(animation);
    };
  }, [cancelCurrentLocationRequest, coverageRegion, effectiveMapStyle, flatMapMode, mapHillshade, projection, viewMode]);

  useEffect(() => {
    if (!projection) {
      setDemLoading(false);
      return;
    }
    if (coverageRegion === 'unsupported') {
      setDemGrid(null);
      setDemLoading(false);
      return;
    }
    const sourcePad = flatMapMode && coverageRegion !== 'united-states' ? DEM_PREFETCH : 0;
    const sourceProjection = sourcePad
      ? createCenteredProjection(
          projection.centerLat,
          projection.centerLon,
          projection.width + sourcePad * 2,
          projection.height + sourcePad * 2,
          projection.scale,
        )
      : projection;
    const lattice = (density: number) => {
      const k = Math.min(density, MAX_LATTICE / Math.max(sourceProjection.width, sourceProjection.height));
      return [Math.round(sourceProjection.width * k), Math.round(sourceProjection.height * k)] as const;
    };
    const [cx, cy] = lattice(COARSE_DENSITY);
    const [fx, fy] = lattice(FINE_DENSITY);
    const key = demCacheKey(coverageRegion, sourceProjection);
    const expectedSource = coverageRegion === 'japan' ? 'gsi-dem' : 'usgs-3dep';
    const cached = demCacheRef.current.get(key);
    if (cached?.grid.source === expectedSource) {
      demCacheRef.current.delete(key);
      demCacheRef.current.set(key, cached);
      setDemGrid(cached);
      setDemLoading(false);
      return;
    }
    const hasPrefetch =
      viewMode === 'gpx' ||
      (flatMapMode &&
        demGrid &&
        demGrid.projection.width >= projection.width + DEM_PREFETCH * 2 &&
        demGrid.projection.height >= projection.height + DEM_PREFETCH * 2);
    const canReuse =
      demGrid &&
      (viewMode === 'gpx'
        ? hasPrefetch && demGrid.grid.source === expectedSource && projectionRect(demGrid.projection, projection)
        : flatMapMode
          ? hasPrefetch &&
            demGrid.grid.source === expectedSource &&
            !!projectionRect(demGrid.projection, projection)
          : demGrid.grid.source === expectedSource && !!projectionRect(demGrid.projection, projection));
    const exactPending = demRequestsRef.current.get(key);
    const pendingEntry =
      exactPending && !exactPending.controller.signal.aborted
        ? ([key, exactPending] as const)
        : [...demRequestsRef.current.entries()].find(
            ([, candidate]) =>
              !candidate.controller.signal.aborted &&
              candidate.region === coverageRegion &&
              candidate.projection.width >= projection.width &&
              candidate.projection.height >= projection.height &&
              projectionRect(candidate.projection, projection),
          );
    const pendingKey = pendingEntry?.[0] ?? key;
    const pending = pendingEntry?.[1];
    if (!pending && canReuse) {
      setDemLoading(false);
      return;
    }
    const request = pending ?? createDemLoadRequest(sourceProjection, cx, cy, fx, fy, coverageRegion);
    if (!pending) demRequestsRef.current.set(key, request);
    acquireDemRequest(request);
    const requestProjection = pending?.projection ?? sourceProjection;
    if (request.coarseGrid) setDemGrid({ projection: requestProjection, grid: request.coarseGrid });
    else if (!canReuse) setDemGrid(null);
    setDemLoading(true);

    let active = true;
    const removeRequest = () => {
      if (demRequestsRef.current.get(pendingKey) === request) demRequestsRef.current.delete(pendingKey);
    };
    const applyCoarseFallback = (error: unknown) => {
      if (viewMode === 'gpx' && points) {
        setToast(copy.toast.demFallback);
        setDemGrid({
          projection: sourceProjection,
          grid: gpxElevationGrid(projectTrack(points, sourceProjection, 4), cx, cy, sourceProjection.width, sourceProjection.height),
        });
      } else {
        if (!tutorialMode) setToast(copy.toast.demUnavailable);
        setDemGrid({ projection: sourceProjection, grid: tutorialMode ? tutorialElevationGrid(cx, cy) : flatElevationGrid(cx, cy) });
      }
      reportWarning('load_dem_coarse', error);
      setDemLoading(false);
    };
    void request.coarse
      .then((first) => {
        if (!active) return;
        setDemGrid({ projection: requestProjection, grid: first });
      })
      .catch((error) => {
        removeRequest();
        if (!active || request.controller.signal.aborted) return;
        applyCoarseFallback(error);
      });
    void request.fine
      .then((fine) => {
        removeRequest();
        rememberDemCache(demCacheRef.current, pendingKey, { projection: requestProjection, grid: fine });
        if (!active) return;
        setDemGrid({ projection: requestProjection, grid: fine });
        setDemLoading(false);
      })
      .catch((error) => {
        removeRequest();
        if (!active || request.controller.signal.aborted || request.coarseError !== null) return;
        // The coarse grid remains visible when only the refinement fails.
        reportWarning('load_dem_fine', error);
        setDemLoading(false);
      });
    return () => {
      active = false;
      releaseDemRequest(request);
    };
  }, [copy, coverageRegion, flatMapMode, points, projection, tutorialMode, viewMode]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Fallback: choosing a spot is a tap on the map, and nothing on the bar says so
  const choosingSpot = fpvSelecting || mapManeuver?.phase === 'select';
  useEffect(() => {
    if (fb && choosingSpot) setToast(copy.toast.pickPoint);
  }, [fb, choosingSpot, copy]);

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
      setGpxDirty(true);
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
    setGpxDirty(true);
    setRoute((current) => current && { ...current, waypoints: current.waypoints.map((w) => (w.id === id ? { ...w, name } : w)) });
  };
  const moveWay = (id: string, at: number) => {
    const spot = placeAt(at);
    if (spot) {
      addAction('waypoint_move', { waypoint_id: id, distance_km: Number(spot.km.toFixed(2)) });
      setGpxDirty(true);
      setRoute((current) => current && { ...current, waypoints: current.waypoints.map((w) => (w.id === id ? { ...w, ...spot } : w)) });
    }
  };
  const removeWay = (id: string) => {
    const removed = route?.waypoints.find((waypoint) => waypoint.id === id);
    addAction('waypoint_remove', { waypoint_id: id, waypoint_name: removed?.name });
    if (removed) setGpxDirty(true);
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
    if (renderPath === 'unsupported' || !canvas || !page) return;
    const names = native
      ? { start: 'html_in_canvas_engine_start', firstPaint: 'html_in_canvas_first_paint', ready: 'html_in_canvas_ready', painted: 'html_in_canvas_painted' }
      : { start: 'fallback_render_engine_start', firstPaint: 'fallback_render_first_paint', ready: 'fallback_render_ready', painted: 'fallback_render_painted' };
    let fallbackPaint: FallbackPaint | undefined;
    if (native) {
      canvas.setAttribute('content', 'drawable');
      canvas.setAttribute('layoutsubtree', '');
    } else fallbackPaint = installFallbackPaint(canvas, page);
    const htmlInCanvasContext = getHtmlInCanvasContext();
    let engine: Engine;
    let stopFirstPaint: ReturnType<typeof startVital> | undefined;
    const stopEngineStart = startVital(names.start, htmlInCanvasContext);
    try {
      engine = createEngine(canvas, page, {
        onFirstPaint: () => {
          stopFirstPaint?.('ok');
          addAction(names.painted, htmlInCanvasContext);
        },
        onApartChange: (next) => {
          if (!permalinkApplyingRef.current) detachPermalink(next ? 'raise' : 'lay_flat');
          setApart(next);
        },
        onViewInteraction: detachPermalink,
        onFrameRateChange: ({ fps, frameMs, reason }) => addAction('render_fps_changed', { mode: 'motion', fps, frame_ms: frameMs, reason }),
        onMapDrag: panMapPreview,
        onMapPan: panMap,
        onMapDragBegin: beginMapDrag,
        onMapDragCancel: cancelMapDrag,
        onCameraRotate: (change) => addAction('camera_rotate_completed', change),
        onCameraPan: (change) => addAction('camera_pan_completed', change),
        onCameraZoom: (change) => addAction('camera_zoom_completed', change),
        onRouteClick: (km) => routeClickRef.current(km),
        onDetail: setDetailWanted,
        onFlightChange: (phase) => {
          addAction('flyover_state_changed', { phase: phase ?? 'idle' });
          setFlyoverPhase(phase);
        },
        onMapManeuverChange: (state) => {
          setMapManeuver(state);
          if (state) setMapManeuverMenuOpen(false);
          addAction('map_maneuver_state_changed', {
            kind: state?.kind ?? 'none',
            phase: state?.phase ?? 'idle',
          });
        },
        onMapPinSelectionChange: setMapPinSelecting,
        onFpvSelectionChange: setFpvSelecting,
        onFpvChange: (state) => {
          setFpvActive(state !== null);
          setFpvView(state?.view ?? null);
        },
        onMapPinSelected: (x, y) => {
          const projection = mapProjectionRef.current;
          if (!projection) return;
          const center = projection.inverse(x, y);
          detachPermalink('map_pin');
          setMapPinRemoving(false);
          const falls = engineRef.current?.startMapPinDrop() ?? false;
          mapPinPlacedAtRef.current = performance.now();
          setMapPin((current) => ({ lat: center.lat, lon: center.lon, label: current?.label ?? '' }));
          // in 3D the hint waits for the landing; flat, the pin is there at once
          if (!falls) showXHint('map-pin');
          addAction('map_pin_placed', { lat: center.lat, lon: center.lon });
        },
        onMapPinLanded: () => {
          const placedAt = mapPinPlacedAtRef.current;
          mapPinPlacedAtRef.current = null;
          addAction('map_pin_landed', { duration_ms: placedAt === null ? undefined : Math.round(performance.now() - placedAt) });
          showXHint('map-pin');
        },
        onMapPinRemoved: () => {
          setMapPinRemoving(false);
          setMapPin(null);
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
        onXHintExit: (seq) => {
          setXHint((current) => (current && String(current.seq) === seq ? null : current));
        },
        onHudHitAreas: syncHudHitAreas,
        onTimeCommit: (target, minutes) => {
          addAction('elapsed_time_committed', { target, minutes });
          if (target === 'start') setStartTime(clockInput(minutes));
          else {
            setGpxDirty(true);
            setOverrides((current) => ({ ...current, [target]: minutes }));
          }
        },
        onPopClosed: (seq) => setPop((current) => (current && String(current.seq) === seq ? null : current)),
      }, {
        ...(native ? {} : { renderPath: 'fallback' as const, uiRoot: fb?.root ?? null, ...fallbackPerformanceFor(window) }),
        ...(tutorialMode ? { rotateAboutModelCenter: true } : {}),
      });
    } catch (error) {
      stopEngineStart('error');
      fallbackPaint?.dispose();
      reportError(native ? 'create_html_in_canvas_engine' : 'create_fallback_render_engine', error);
      setToast(error instanceof Error ? error.message : copy.toast.threeDStartFailed);
      return;
    }
    stopEngineStart('ok');
    stopFirstPaint = startVital(names.firstPaint, htmlInCanvasContext);
    addAction(names.ready, htmlInCanvasContext);
    engineRef.current = engine;
    engine.refreshHud();
    return () => {
      stopFirstPaint?.('aborted');
      engineRef.current = null;
      engine.dispose();
      fallbackPaint?.dispose();
    };
  }, [detachPermalink, native, renderPath, fb]);

  useEffect(() => {
    if (!mapPinSelecting) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      engineRef.current?.cancelMapPinPlacement();
      setMapPinSelecting(false);
      addAction('map_pin_placement_cancelled', { source: 'escape' });
    };
    window.addEventListener('keydown', onEscape, true);
    return () => window.removeEventListener('keydown', onEscape, true);
  }, [mapPinSelecting]);

  // Both render paths need a second measurement after text and layout resources settle.
  useEffect(() => {
    let cancelled = false;
    let firstFrame = 0;
    let secondFrame = 0;
    let lateRefresh = 0;
    let finalRefresh = 0;
    const refreshHud = () => {
      if (cancelled) return;
      if (native) engineRef.current?.refreshHud();
      else engineRef.current?.refreshFallbackLayout();
    };
    firstFrame = requestAnimationFrame(() => {
      refreshHud();
      secondFrame = requestAnimationFrame(refreshHud);
    });
    lateRefresh = window.setTimeout(refreshHud, 250);
    finalRefresh = window.setTimeout(refreshHud, 1000);
    window.addEventListener('load', refreshHud, { once: true });
    const fontsReady = document.fonts?.ready;
    if (fontsReady) void fontsReady.then(refreshHud);
    return () => {
      cancelled = true;
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      window.clearTimeout(lateRefresh);
      window.clearTimeout(finalRefresh);
      window.removeEventListener('load', refreshHud);
    };
  }, [native]);

  useEffect(() => {
    const page = pageRef.current;
    if (!native || !page) return;
    const observer = new MutationObserver((records) => {
      if (records.some((record) => record.type === 'childList' || record.type === 'attributes')) {
        engineRef.current?.refreshHud();
      }
    });
    observer.observe(page, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-hidden', 'class', 'data-piece', 'data-key', 'data-latched', 'data-x', 'data-y', 'data-w', 'data-h', 'data-density', 'data-x-hint-phase', 'style'],
    });
    return () => observer.disconnect();
  }, [native]);

  // Fallback: the visible panel is replaced as the view changes; the engine finds its slider and profile again.
  useEffect(() => {
    if (!fb) return;
    let frame = 0;
    const observer = new MutationObserver(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        engineRef.current?.refreshUi();
      });
    });
    observer.observe(fb.panelBody, { subtree: true, childList: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [fb]);
  // Fallback sheet: the groups of cards on offer (the map's search card is only there while the map lies flat).
  // The pin's name is typed there too, as the drawn pin cannot take typing.
  const pinTab: PanelTabId[] = fb && viewMode === 'map' && mapPin ? ['pin'] : [];
  const panelTabs: PanelTabId[] = viewMode === 'gpx' ? ['route', 'sun', 'ways'] : apart ? [...pinTab, 'sun'] : ['search', ...pinTab, 'sun'];
  const activePanelTab = panelTabs.includes(panelTab) ? panelTab : panelTabs[0];
  const hasMapPin = Boolean(mapPin);
  // a new pin brings its card forward, so the name can be typed at once
  useEffect(() => {
    if (fb && hasMapPin) setPanelTab('pin');
  }, [fb, hasMapPin]);
  // Fallback: the shell's state, as attributes its CSS reads.
  useLayoutEffect(() => {
    if (!fb) return;
    fb.root.dataset.panel = panelOpen ? 'open' : 'closed';
    fb.root.dataset.apart = apart ? 'true' : 'false';
    fb.root.dataset.dock = docked ? 'true' : 'false';
    fb.root.dataset.compact = compactBar ? 'true' : 'false';
    fb.root.dataset.compactSize = compactSize;
    fb.root.dataset.tab = activePanelTab;
  }, [activePanelTab, apart, compactBar, compactSize, docked, fb, panelOpen]);
  // Fallback sheet: pulled up while open, and out of the way when the panel is docked.
  useLayoutEffect(() => {
    if (!fb) return;
    fb.setSheet(panelOpen && !docked ? fb.openHeight() : 0);
  }, [docked, fb, panelOpen, viewport]);

  useEffect(() => {
    engineRef.current?.refreshHud();
  }, [flyoverPhase]);

  useEffect(() => {
    engineRef.current?.refreshHud();
  }, [fpvActive, fpvSelecting, mapManeuver, mapManeuverMenuOpen, mapPin, mapPinSelecting]);

  useEffect(() => {
    if (viewMode === 'map') setPlacing(false);
    if (viewMode !== 'map') cancelCurrentLocationRequest();
    if (viewMode !== 'map' || !apart) setMapManeuverMenuOpen(false);
    engineRef.current?.refreshHud();
  }, [apart, cancelCurrentLocationRequest, viewMode]);

  useEffect(() => {
    const pending = pendingCurrentLocationRef.current;
    if (!pending || viewMode !== 'map' || !mapProjection || !mapReady) return;
    const frame = window.requestAnimationFrame(() => {
      if (pendingCurrentLocationRef.current?.requestId !== pending.requestId || viewMode !== 'map') return;
      pendingCurrentLocationRef.current = null;
      setCurrentLocation(pending.location);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [apart, mapProjection, mapReady, viewMode]);

  useEffect(() => {
    return () => {
      cancelCurrentLocationRequest(false);
    };
  }, [cancelCurrentLocationRequest]);

  const model = useMemo<EngineModel | null>(() => {
    if (!projection) return null;
    const gpx = viewMode === 'gpx' && progress && profile;
    return {
      ...layout,
      terrain,
      // every point of the track, as the drawn line has them, so the runner keeps to the line round every bend
      route: gpx ? track.map((p) => ({ x: p.x, y: p.y, km: progress.km[p.index] })) : [],
      ways: gpx ? ways.map((w) => ({ id: w.id, x: w.x, y: w.y, km: w.km, minutes: w.minutes })) : [],
      marks: gpx && showHigh && high ? [{ id: 'high', x: high.x, y: high.y }] : [],
      mapPin: viewMode === 'map' && mapProjection && mapPin ? mapProjection.project(mapPin) : null,
      currentLocation: viewMode === 'map' && mapProjection && currentLocation ? mapProjection.project(currentLocation) : null,
      date,
      lat: projection.centerLat,
      lon: projection.centerLon,
      mapStyle: effectiveMapStyle,
      mapMode: viewMode === 'map',
      sunlightEnabled: viewMode !== 'map' || mapSunlight,
      profilePoint: gpx ? (km: number) => [profile.X(km), profile.Y(profile.eleAt(km))] : () => [0, 0],
      profileKm: gpx ? profile.K : () => 0,
    };
  }, [
    coverageRegion,
    currentLocation,
    date,
    effectiveMapStyle,
    high,
    layout,
    mapPin,
    mapProjection,
    mapSunlight,
    profile,
    progress,
    projection,
    showHigh,
    terrain,
    track,
    viewMode,
    ways,
  ]);

  useLayoutEffect(() => {
    if (model) engineRef.current?.setModel(model);
  }, [model]);

  useLayoutEffect(() => {
    if (!tutorialMode || !model || !engineRef.current) return;
    // raised only on the steps that look at terrain, and only once the screen is in that step's mode
    const raised =
      !modeTransition &&
      ((['terrain', 'sun', 'maneuver'].includes(tutorialTarget) && viewMode === 'map') ||
        (['route', 'waypoints', 'progress', 'flyover'].includes(tutorialTarget) && viewMode === 'gpx'));
    // laying it down is the same as the Lay flat key: the turn, the zoom and the move go with it, so it settles exactly in the frame
    if (raised) engineRef.current.setViewState({ raised });
    else engineRef.current.together();
  }, [model, modeTransition, tutorialMode, tutorialTarget, viewMode]);

  // The tutorial page asks for the next step by message; follow it without reloading.
  useEffect(() => {
    if (!tutorialMode) return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      const data = event.data as { type?: string; step?: number; target?: string; mode?: string } | null;
      if (data?.type !== 'gpx-topo-tutorial' || typeof data.step !== 'number') return;
      setTutorial({ mode: data.mode === 'gpx' ? 'gpx' : 'map', step: Math.max(0, data.step), target: String(data.target ?? '') });
    };
    window.addEventListener('message', onMessage);
    window.parent.postMessage({ type: 'gpx-topo-tutorial-ready' }, window.location.origin);
    return () => window.removeEventListener('message', onMessage);
  }, [tutorialMode]);

  // tell the tutorial page whether the settings panel is a bottom sheet with a handle right now
  const sheetShown = fb !== null && !docked;
  useEffect(() => {
    if (!tutorialMode) return;
    window.parent.postMessage({ type: 'gpx-topo-tutorial-sheet', sheet: sheetShown }, window.location.origin);
  }, [sheetShown, tutorialMode]);

  const tutorialRouteLoadingRef = useRef(false);
  const tutorialFollowedRef = useRef('');
  // Bring the screen to the step's mode: load the sample route for GPX steps, go back to the map for the others.
  // This only follows a step change. Once the screen has got there, a visitor pressing the GPX button on the
  // "open a GPX" steps is left in the mode they chose instead of being pulled back.
  useEffect(() => {
    if (!tutorialMode) return;
    const followKey = `${tutorial.step}:${tutorial.mode}`;
    if (tutorialFollowedRef.current === followKey) return;
    if (viewMode === tutorial.mode && !modeTransition && (tutorial.mode === 'map' || route)) {
      tutorialFollowedRef.current = followKey;
      return;
    }
    if (tutorial.mode === 'gpx') {
      if (!route) {
        if (tutorialRouteLoadingRef.current) return;
        tutorialRouteLoadingRef.current = true;
        loadTutorialRoute()
          .then((loaded) => {
            setRoute(loaded);
            setFileName('sfmt-110km.gpx');
            setGpxSource('user');
            setGpxRestoreState('ready');
          })
          .catch((error) => {
            tutorialRouteLoadingRef.current = false;
            reportError('load_tutorial_route', error);
          });
        return;
      }
      if (viewMode !== 'gpx') requestViewMode('gpx');
    } else if (viewMode !== 'map') {
      requestViewMode('map');
    }
  }, [modeTransition, requestViewMode, route, tutorial.mode, tutorial.step, tutorialMode, viewMode]);

  useLayoutEffect(() => {
    const location = model?.currentLocation;
    if (!apart || !currentLocationRecenterRef.current || !location) return;
    currentLocationRecenterRef.current = false;
    engineRef.current?.centerViewOnMapPoint(location.x, location.y);
  }, [apart, model]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!permalink || permalinkAppliedRef.current || !engine || !model || viewMode !== 'map') return;
    const wantsRaisedView = permalink.view === '3d' || permalink.view === 'fpv';
    if (wantsRaisedView && coverageRegion !== 'unsupported' && !terrain) return;
    permalinkApplyingRef.current = true;
    const focusPoint =
      permalink.view === '3d' && permalink.focus && mapProjection
        ? mapProjection.project(permalink.focus)
        : null;
    try {
      if (permalink.view === 'fpv' && permalink.fpv && mapProjection && canRaise) {
        const point = mapProjection.project({ lat: permalink.fpv.lat, lon: permalink.fpv.lon });
        engine.startFpvAtMapPoint(point.x, point.y, {
          bearing: permalink.fpv.bearing,
          pitch: permalink.fpv.pitch,
          zoom: permalink.fpv.zoom,
        }, {
          raised: true,
          bearing: permalink.bearing ?? 0,
          pitch: permalink.pitch ?? undefined,
          zoom: permalink.zoom ?? undefined,
          pan: (permalinkFitRef.current ? permalinkFitRef.current.pan : permalink.pan) ?? undefined,
        });
      } else {
        engine.setViewState({
          raised: wantsRaisedView && canRaise,
          bearing: permalink.bearing ?? undefined,
          pitch: permalink.pitch ?? undefined,
          zoom: permalink.zoom ?? undefined,
          pan: (permalinkFitRef.current ? permalinkFitRef.current.pan : permalink.pan) ?? undefined,
        });
        if (focusPoint) engine.centerViewOnMapPoint(focusPoint.x, focusPoint.y);
      }
      if (permalink.sun === 'auto' && permalink.view === '3d' && canRaise) {
        const sun = sunInput(fb?.root ?? pageRef.current);
        if (sun) {
          const start = daylight?.rise == null ? 0 : Math.max(0, daylight.rise - MAP_SUNRISE_OFFSET);
          autoSunDispatchRef.current = true;
          sun.value = String(start);
          sun.dispatchEvent(new Event('input', { bubbles: true }));
          autoSunDispatchRef.current = false;
        }
        setMapSunAuto(true);
      }
    } finally {
      permalinkApplyingRef.current = false;
    }
    permalinkAppliedRef.current = true;
    addAction('map_permalink_applied', {
      parameters: permalink.usedParameters,
      ignored_parameters: permalink.ignoredParameters,
      view: permalink.view,
      date_source: permalink.date ? 'query' : 'today',
      sun: permalink.sun ?? 'default',
    });
  }, [canRaise, coverageRegion, daylight, mapProjection, model, permalink, terrain, viewMode]);

  useEffect(() => {
    engineRef.current?.setPlacing(placing);
  }, [placing]);

  // A close view: keep the current picture visible while a padded, sharper picture is prepared,
  // then crossfade once the new tiles are ready.
  useLayoutEffect(() => {
    if (detailWanted) setDetailShown(detailWanted);
  }, [detailWanted]);
  const shownDetail = mapReady ? detailShown : null;
  useLayoutEffect(() => {
    const el = detailRef.current;
    const base = reliefRef.current;
    if (!el || !base || !projection) {
      if (el && el.width > 1) {
        el.width = 1;
        el.height = 1;
      }
      detailDrawn.current = null;
      engineRef.current?.refreshDetail();
      return;
    }
    if (!shownDetail) {
      detailDrawn.current = null;
      engineRef.current?.refreshDetail();
      return;
    }
    if (!detailWanted) {
      const fading = new OffscreenCanvas(el.width, el.height);
      fading.getContext('2d')?.drawImage(el, 0, 0);
      const context = el.getContext('2d');
      if (!context) return;
      let animation = 0;
      const started = performance.now();
      const fade = (now: number) => {
        const progress = Math.min(1, (now - started) / 220);
        context.clearRect(0, 0, el.width, el.height);
        context.globalAlpha = 1 - progress;
        context.drawImage(fading, 0, 0);
        context.globalAlpha = 1;
        engineRef.current?.refreshDetail();
        if (progress < 1) {
          animation = requestAnimationFrame(fade);
        } else {
          detailDrawn.current = null;
          setDetailShown(null);
        }
      };
      animation = requestAnimationFrame(fade);
      return () => cancelAnimationFrame(animation);
    }
    const region = shownDetail;
    const s = region.density;
    const last = detailDrawn.current;
    const photoOnly = effectiveMapStyle === 'photo';
    const namesOnly = effectiveMapStyle === 'photoNames';
    const photoBase = photoRef.current;
    if (namesOnly && !photoBase) return;
    let keep: OffscreenCanvas | null = null;
    if (!photoOnly && last && el.width > 1) {
      keep = new OffscreenCanvas(el.width, el.height);
      keep.getContext('2d')?.drawImage(el, 0, 0);
    }
    el.width = Math.max(1, Math.round(region.w * s));
    el.height = Math.max(1, Math.round(region.h * s));
    const context = el.getContext('2d');
    if (!context) return;
    context.imageSmoothingQuality = 'high';
    if (photoOnly) {
      context.clearRect(0, 0, el.width, el.height);
      detailDrawn.current = region;
      engineRef.current?.refreshDetail();
      return;
    }
    const k = base.width / projection.width;
    const drawStart = (target: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) => {
      target.clearRect(0, 0, el.width, el.height);
      target.drawImage(base, region.x * k, region.y * k, region.w * k, region.h * k, 0, 0, el.width, el.height);
      if (keep && last) target.drawImage(keep, (last.x - region.x) * s, (last.y - region.y) * s, last.w * s, last.h * s);
    };
    drawStart(context);
    const start = new OffscreenCanvas(el.width, el.height);
    start.getContext('2d')?.drawImage(context.canvas, 0, 0);
    const next = document.createElement('canvas');
    next.width = el.width;
    next.height = el.height;
    const nextContext = next.getContext('2d');
    if (!nextContext) return;
    nextContext.imageSmoothingQuality = 'high';
    nextContext.clearRect(0, 0, next.width, next.height);
    const nextBase = namesOnly ? photoBase ?? base : base;
    nextContext.drawImage(nextBase, region.x * k, region.y * k, region.w * k, region.h * k, 0, 0, next.width, next.height);
    if (!namesOnly && keep && last) nextContext.drawImage(keep, (last.x - region.x) * s, (last.y - region.y) * s, last.w * s, last.h * s);
    detailDrawn.current = region;
    engineRef.current?.refreshDetail();
    const controller = new AbortController();
    let animation = 0;
    const flush = () => {
      engineRef.current?.refreshDetail();
    };
    const stream = namesOnly
      ? streamNames(projection, s, region, nextContext, controller.signal, () => {}, coverageRegion)
      : streamRelief(projection, s, region, nextContext, controller.signal, () => {}, effectiveMapStyle, coverageRegion);
    void stream
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
        if (!controller.signal.aborted) reportWarning(namesOnly ? 'load_detail_names' : 'load_detail_relief', error);
      });
    return () => {
      controller.abort();
      cancelAnimationFrame(animation);
    };
  }, [coverageRegion, detailWanted, effectiveMapStyle, shownDetail, projection]);

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
  /** Fold the open picker away: the engine does it in the scene; in the fallback it is a dialog and simply goes. */
  const dismissPop = () => {
    if (native) engineRef.current?.closePop(false);
    else setPop(null);
  };
  /** Fallback: the picker's own fields chose a time (the scene's drums report it through the engine instead). */
  const commitPopTime = (target: string, minutes: number) => {
    addAction('elapsed_time_committed', { target, minutes });
    if (target === 'start') setStartTime(clockInput(minutes));
    else {
      setGpxDirty(true);
      setOverrides((current) => ({ ...current, [target]: minutes }));
    }
    setPop(null);
  };
  /** Fallback: the help flag is a static dialog; in the scene the engine flies it in. */
  const toggleInfo = () => {
    if (native) {
      engineRef.current?.toggleInfo();
      return;
    }
    const next = !infoOpen;
    addAction('info_flag_toggled', { open: next });
    setInfoOpen(next);
  };
  // Fallback: Esc closes the dialog that is up. The engine's own Esc handling knows nothing of these dialogs and
  // would lay the model flat, so this listens first and keeps the key from reaching it.
  useEffect(() => {
    if (!fb && !pendingGpxFile) return;
    if (!infoOpen && !pop && !fbMedia && !mapManeuverMenuOpen && !pendingGpxFile) return;
    return listenDialogEscape(() => {
      if (fbMedia) closeFbMedia();
      else if (mapManeuverMenuOpen) setMapManeuverMenuOpen(false);
      else if (infoOpen) {
        addAction('info_flag_toggled', { open: false });
        setInfoOpen(false);
      } else if (pendingGpxFile) cancelPendingGpxFile();
      else setPop(null);
    });
  }, [fb, infoOpen, pop, fbMedia, mapManeuverMenuOpen, pendingGpxFile]);

  // ---------------------------------------------------------------- actions
  const applyGpxFile = (candidate: PendingGpxFile) => {
    if (shouldSwitchToGpxAfterFileLoad(viewMode)) enterGpxAfterLoadRef.current = true;
    touchedRef.current = true;
    engineRef.current?.together();
    setPendingGpxFile(null);
    setPop(null);
    setOverrides({});
    setRoute(candidate.route);
    setFileName(candidate.file.name);
    setGpxSource('user');
    setGpxRestoreState('ready');
    setGpxDirty(false);
    // a new GPX starts now, and is what opens next time; the start then stays as it is set for it
    const now = startNow();
    setDate(now.date);
    setDateExplicit(false);
    setMonth(now.date.slice(0, 7));
    setStartTime(now.time);
    planReadyRef.current = true;
    void saveGpx({ name: candidate.file.name, xml: candidate.xml });
    const routeStats = statsFor(candidate.route.points);
    reportInfo('gpx-topo GPX loaded', {
      event_type: 'gpx_loaded',
      source: 'file',
      file_name: candidate.file.name,
      file_size: candidate.file.size,
      gpx_content: candidate.xml,
      waypoint_count: candidate.route.waypoints.length,
      route_distance_km: routeStats.distanceKm,
    });
    addAction('gpx_loaded', {
      source: 'file',
      file_name: candidate.file.name,
      file_size: candidate.file.size,
      waypoint_count: candidate.route.waypoints.length,
    });
    setToast(copy.toast.gpxLoaded(candidate.file.name, candidate.route.points.length));
  };

  const saveCurrentGpx = () => {
    if (!route) return false;
    try {
      const exportRoute: GpxRoute = {
        ...route,
        waypoints: route.waypoints.map((waypoint) => {
          const elapsed = overrides[waypoint.id];
          return elapsed === undefined ? waypoint : { ...waypoint, targetTime: clockInput(startMinutes + elapsed) };
        }),
      };
      const filename = fileName.toLowerCase().endsWith('.gpx') ? fileName : `${fileName}.gpx`;
      downloadBlob(new Blob([serializeGpx(exportRoute)], { type: 'application/gpx+xml' }), filename);
      addAction('gpx_saved', { file_name: filename, waypoint_count: exportRoute.waypoints.length });
      return true;
    } catch (error) {
      reportError('save_gpx', error, { file_name: fileName });
      return false;
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const requestId = ++fileRequestRef.current;
    addAction('gpx_file_open_requested', { file_name: file.name, file_size: file.size });
    let xml = '';
    try {
      xml = await file.text();
      const next = ensureWaypoints(parseGpxWithVital(xml, 'file'));
      if (requestId !== fileRequestRef.current) return;
      const candidate = { file, xml, route: next };
      if (gpxDirty) {
        setPendingGpxFile(candidate);
        addAction('gpx_file_replacement_prompted', { file_name: file.name });
        return;
      }
      applyGpxFile(candidate);
    } catch (error) {
      if (requestId !== fileRequestRef.current) return;
      reportError('load_gpx_file', error, { file_name: file.name, file_size: file.size, gpx_content: xml });
      setToast(error instanceof Error ? error.message : copy.toast.gpxLoadFailed);
    }
  };

  const cancelPendingGpxFile = () => {
    setPendingGpxFile(null);
    addAction('gpx_file_replacement_cancelled');
  };

  const openPendingGpxFile = (save: boolean) => {
    const pending = pendingGpxFile;
    if (!pending) return;
    if (save && !saveCurrentGpx()) return;
    addAction('gpx_file_replacement_confirmed', { saved: save, file_name: pending.file.name });
    applyGpxFile(pending);
  };

  const showXHint = (kind: HintKind) => {
    addAction('x_hint_shown', { kind });
    const seq = ++xHintSeqRef.current;
    setXHint({ kind, seq, phase: 'in' });
    if (xHintTimerRef.current !== null) window.clearTimeout(xHintTimerRef.current);
    if (xHintExitTimerRef.current !== null) window.clearTimeout(xHintExitTimerRef.current);
    const visibleFor = kind === 'video' ? 8000 : 5200;
    xHintTimerRef.current = window.setTimeout(() => {
      xHintTimerRef.current = null;
      setXHint((current) => (current?.seq === seq ? { ...current, phase: 'out' } : current));
      xHintExitTimerRef.current = window.setTimeout(() => {
        xHintExitTimerRef.current = null;
        setXHint((current) => (current?.seq === seq ? null : current));
      }, 1100);
    }, visibleFor);
  };

  // the camera key takes a photo of the view; it comes out as a print floating over the map
  /** Fallback: lay a photo or a video out in its dialog. The one before it (if any) is let go. */
  const showFbMedia = (kind: FallbackMedia['kind'], blob: Blob, name: string) => {
    const type = plainMimeType(blob.type, kind === 'photo' ? 'image/png' : 'video/mp4');
    const file = new File([blob], name, { type });
    const url = URL.createObjectURL(blob);
    setFbMedia((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return { kind, url, blob, file, actions: mediaActions(canShareFile(file), isTouchDevice(window)) };
    });
    addAction(kind === 'photo' ? 'photo_shown' : 'video_shown', { route_name: route?.name || 'gpx-topo' });
  };
  const closeFbMedia = () => {
    setFbMedia((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
  };
  /** Fallback: the file goes into Downloads (Files on a phone, so a phone is offered the share sheet instead). */
  const saveFbMedia = () => {
    const media = fbMedia;
    if (!media) return;
    const props = { route_name: route?.name || 'gpx-topo', kind: media.kind };
    try {
      downloadBlob(media.blob, media.file.name);
      addAction('media_saved', props);
    } catch (error) {
      reportError('save_media', error, props);
      setToast(saveFailureMessage(media.kind, copy.toast));
    }
  };
  /**
   * Fallback: the share sheet of the device, which can put the file in Photos or send it to X. Where there is none, or
   * the one button is also the way to save (a phone's sheet), a sheet that fails ends in a download.
   */
  const shareFbMedia = async () => {
    const media = fbMedia;
    if (!media) return;
    await shareFallbackMedia(media, copy.shareText, () => buildCurrentMapPermalink()?.url ?? null, {
      share: shareFile,
      onShared: () => addAction('media_shared', { route_name: route?.name || 'gpx-topo', kind: media.kind }),
      save: saveFbMedia,
      warn: (error) => reportWarning('share_media', error),
    });
  };

  const exportPng = async () => {
    const engine = engineRef.current;
    // one photo at a time: while one is out, the key takes no other
    if (!engine || shotOpen || shot || fbMedia) return;
    addAction('photo_requested', { route_name: route?.name || 'gpx-topo' });
    try {
      const blob = await engine.capture();
      if (!blob) {
        reportError('export_png', new Error('PNG capture returned no blob'), { route_name: route?.name || 'gpx-topo' });
        setToast(copy.toast.pngExportFailed);
        return;
      }
      if (fb) {
        showFbMedia('photo', blob, shotName());
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
  const stopVideoRecording = (reason: 'manual' | 'max_duration' = 'manual') => {
    const recorder = videoRecorderRef.current;
    if (!recorder) return;
    videoStopReasonRef.current = reason;
    if (videoTimerRef.current !== null) {
      window.clearTimeout(videoTimerRef.current);
      videoTimerRef.current = null;
    }
    if (videoFrameRafRef.current !== null) {
      cancelAnimationFrame(videoFrameRafRef.current);
      videoFrameRafRef.current = null;
    }
    if (recorder.state !== 'inactive') recorder.stop();
  };
  const startVideoRecording = () => {
    if (videoRecordingRef.current) {
      stopVideoRecording();
      return;
    }
    const engine = engineRef.current;
    if (!engine || typeof MediaRecorder === 'undefined') {
      reportWarning('start_video_recording', 'Video recording is not supported by this browser.');
      addAction('video_recording_unavailable');
      setToast(copy.toast.videoRecordingUnsupported);
      return;
    }
    const recordingCanvas = document.createElement('canvas');
    const mimeType = supportedVideoMimeType((type) => MediaRecorder.isTypeSupported(type));
    let stream: MediaStream | null = null;
    let recorder: MediaRecorder;
    try {
      engine.captureFrame(recordingCanvas);
      if (typeof recordingCanvas.captureStream !== 'function') throw new Error('Canvas recording is not supported by this browser.');
      stream = recordingCanvas.captureStream(VIDEO_RECORDING_FRAME_RATE);
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      reportError('start_video_recording', error, { mime_type: mimeType || 'browser-default' });
      setToast(copy.toast.videoRecordingFailed);
      return;
    }
    if (!stream) return;
    const videoTrack = stream.getVideoTracks()[0] as (MediaStreamTrack & { requestFrame?: () => void }) | undefined;
    videoStreamRef.current = stream;
    videoRecorderRef.current = recorder;
    videoCanvasRef.current = recordingCanvas;
    videoChunksRef.current = [];
    videoStartedAtRef.current = performance.now();
    videoStartedAtDateRef.current = new Date();
    videoStopReasonRef.current = 'manual';
    let stopRecording: ReturnType<typeof startVital> | undefined;
    let recordingFailed = false;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) videoChunksRef.current.push(event.data);
    };
    recorder.onerror = () => {
      recordingFailed = true;
      reportError('video_recording', new Error('MediaRecorder reported an error.'), {
        mime_type: recorder.mimeType || mimeType || 'browser-default',
      });
      setToast(copy.toast.videoRecordingFailed);
    };
    recorder.onstop = () => {
      const durationMs = Math.round(performance.now() - videoStartedAtRef.current);
      const reason = videoStopReasonRef.current;
      const chunks = videoChunksRef.current;
      const outputMimeType = recorder.mimeType || mimeType || 'video/webm';
      const startedAt = videoStartedAtDateRef.current ?? new Date();
      const blob = new Blob(chunks, { type: outputMimeType });
      stopRecording?.(recordingFailed || !blob.size ? 'error' : 'ok', {
        reason,
        mime_type: outputMimeType,
        file_size: blob.size,
      });
      videoChunksRef.current = [];
      videoStartedAtDateRef.current = null;
      videoRecorderRef.current = null;
      videoStreamRef.current?.getTracks().forEach((track) => track.stop());
      videoStreamRef.current = null;
      videoCanvasRef.current = null;
      videoRecordingRef.current = false;
      setVideoRecording(false);
      try {
        if (!blob.size) throw new Error('Video recording returned an empty blob.');
        const fileName = videoFileName(outputMimeType, startedAt);
        if (fb) {
          // the phone's share sheet saves it to Photos or sends it on; a download would land in Files
          showFbMedia('video', blob, fileName);
        } else {
          downloadBlob(blob, fileName);
          setLatestMedia('video');
          showXHint('video');
        }
        addAction('video_recording_stopped', {
          reason,
          duration_ms: durationMs,
          file_size: blob.size,
          mime_type: blob.type,
        });
      } catch (error) {
        reportError('save_video_recording', error, { reason, duration_ms: durationMs });
        setToast(copy.toast.videoRecordingFailed);
      }
    };
    try {
      stopRecording = startVital('video_recording', { mime_type: mimeType || 'browser-default', capture_source: 'canvas' });
      recorder.start(1000);
      videoRecordingRef.current = true;
      videoFrameErrorRef.current = false;
      setVideoRecording(true);
      addAction('video_recording_started', {
        route_name: routeNameRef.current || 'gpx-topo',
        max_duration_ms: MAX_VIDEO_RECORDING_MS,
        capture_source: 'canvas',
        hud: 'excluded',
        cursor: 'excluded',
        mime_type: mimeType || 'browser-default',
      });
      videoLastFrameRef.current = performance.now();
      const captureNextFrame = (now: number) => {
        if (!videoRecordingRef.current || videoCanvasRef.current !== recordingCanvas) return;
        if (now - videoLastFrameRef.current >= 1000 / VIDEO_RECORDING_FRAME_RATE) {
          try {
            engineRef.current?.captureFrame(recordingCanvas);
            videoTrack?.requestFrame?.();
          } catch (error) {
            if (!videoFrameErrorRef.current) {
              videoFrameErrorRef.current = true;
              reportWarning('video_frame_capture', error);
            }
          }
          videoLastFrameRef.current = now;
        }
        videoFrameRafRef.current = requestAnimationFrame(captureNextFrame);
      };
      videoFrameRafRef.current = requestAnimationFrame(captureNextFrame);
      videoTimerRef.current = window.setTimeout(() => stopVideoRecording('max_duration'), MAX_VIDEO_RECORDING_MS);
    } catch (error) {
      stopRecording?.('error');
      videoRecorderRef.current = null;
      videoStreamRef.current?.getTracks().forEach((track) => track.stop());
      videoStreamRef.current = null;
      videoCanvasRef.current = null;
      reportError('start_video_recording', error, { mime_type: mimeType || 'browser-default' });
      setToast(copy.toast.videoRecordingFailed);
    }
  };
  useEffect(() => () => {
    if (videoTimerRef.current !== null) window.clearTimeout(videoTimerRef.current);
    if (videoFrameRafRef.current !== null) cancelAnimationFrame(videoFrameRafRef.current);
    if (xHintTimerRef.current !== null) window.clearTimeout(xHintTimerRef.current);
    if (xHintExitTimerRef.current !== null) window.clearTimeout(xHintExitTimerRef.current);
    if (modeTransitionTimerRef.current !== null) window.clearTimeout(modeTransitionTimerRef.current);
    const recorder = videoRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    videoStreamRef.current?.getTracks().forEach((track) => track.stop());
    videoCanvasRef.current = null;
  }, []);
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
      setLatestMedia('photo');
      showXHint('photo');
      return true;
    } catch (error) {
      reportWarning('copy_png', error);
      setToast(copy.toast.imageCopiedFailed);
      return false;
    }
  };
  const buildCurrentMapPermalink = () => {
    const activeProjection = viewMode === 'map' ? mapProjection : gpxProjection;
    const center = activeProjection
      ? { lat: activeProjection.centerLat, lon: activeProjection.centerLon }
      : mapViewport
        ? { lat: mapViewport.lat, lon: mapViewport.lon }
        : null;
    const engine = engineRef.current;
    if (!center || !engine) return null;

    const view = engine.getViewState();
    const currentFpv = engine.getFpvState() ?? fpvView;
    const fpvLocation = currentFpv && activeProjection ? activeProjection.inverse(currentFpv.x, currentFpv.y) : null;
    const permalinkView = currentFpv ? 'fpv' : view.raised ? '3d' : 'flat';
    const sun = sunInput(fb?.root ?? pageRef.current);
    const timeMinutes = Number(sun?.value);
    const focusPoint = !currentFpv && activeProjection ? engine.getViewFocus() : null;
    const focus = focusPoint ? activeProjection?.inverse(focusPoint.x, focusPoint.y) ?? null : null;
    const saved = activeProjection ? toPermalinkView(permalinkFrame, activeProjection.scale, view.pan) : null;
    const url = buildMapPermalink(
      {
        center,
        view: permalinkView,
        bearing: view.bearing,
        pitch: view.pitch,
        zoom: view.zoom,
        pan: saved ? saved.pan : view.pan,
        focus,
        date: dateExplicit ? date : null,
        mapStyle: baseMapStyle,
        hillshade,
        pin: mapPin,
        currentPin: currentLocation,
        fpv:
          currentFpv && fpvLocation
            ? {
                lat: fpvLocation.lat,
                lon: fpvLocation.lon,
                bearing: currentFpv.bearing,
                pitch: currentFpv.pitch,
                zoom: currentFpv.zoom,
              }
            : null,
        area: saved ? saved.area : null,
        sunlight: mapSunlight,
        sunAuto: mapSunAuto,
        sunSpeed: MAP_SUN_SPEED_NAMES[mapSunSpeed] ?? 'normal',
        timeMinutes: Number.isFinite(timeMinutes) ? timeMinutes : 630,
      },
      window.location.href,
    );
    return { url, view: permalinkView };
  };
  const SHARE_TEXT = copy.shareText;
  const postLatestMedia = () => {
    if (!latestMedia) return;
    const permalink = buildCurrentMapPermalink();
    if (!permalink) {
      setToast(copy.toast.xPostFailed);
      return;
    }
    const shareText = shareTextWithPermalink(SHARE_TEXT, permalink.url);
    const postWindow = window.open(`https://x.com/intent/post?text=${encodeURIComponent(shareText)}`, '_blank', 'noopener');
    if (!postWindow) {
      setToast(copy.toast.xPostFailed);
      return;
    }
    if (latestMedia === 'photo') addAction('photo_post_opened', { route_name: route?.name || 'gpx-topo' });
  };

  if (renderPath === 'unsupported') return <Fallback copy={copy} />;

  const permalinkSun =
    permalink?.sun === 'time'
      ? permalink.timeMinutes
      : permalink?.sun === 'auto' && daylight?.rise != null
        ? Math.max(0, daylight.rise - MAP_SUNRISE_OFFSET)
        : null;
  const initialSun = Math.max(sunRange.min, Math.min(sunRange.max, permalinkSun ?? 630));
  const flyoverPlaying =
    flyoverPhase === 'intro' || flyoverPhase === 'run' || flyoverPhase === 'outro' || flyoverPhase === 'paused';
  const flyoverRunning = flyoverPhase === 'intro' || flyoverPhase === 'run' || flyoverPhase === 'outro';
  const flyoverPaused = flyoverPhase === 'paused';
  const flyoverReturning = flyoverPhase === 'return';
  const mapManeuverActive = mapManeuver !== null;
  const mapManeuverKeyAvailable = viewMode === 'map' && apart && mapReady && !!terrain;
  const mapManeuverAvailable = mapManeuverKeyAvailable && !fpvActive && !fpvSelecting;
  const fpvAvailable =
    viewMode === 'map' &&
    mapReady &&
    !!terrain &&
    !mapManeuverActive &&
    (apart || fpvActive || fpvSelecting);
  const photoRouteOverlay = (effectiveMapStyle === 'photo' || effectiveMapStyle === 'photoNames') && apart && !!shownDetail;
  const mapStyle = { left: layout.mapX, top: layout.mapY, width: layout.mapWidth, height: layout.mapHeight };
  const mapStyleLabel =
    effectiveMapStyle === 'std'
      ? copy.ui.standardMap
      : effectiveMapStyle === 'pale'
        ? copy.ui.paleMap
        : effectiveMapStyle === 'blank'
          ? copy.ui.blankMap
          : effectiveMapStyle === 'photo'
            ? copy.ui.aerial
            : copy.ui.photoNames;
  const gpxActionLabel =
    gpxRestoreState === 'pending' ? copy.ui.loadingGpx : gpxSource === 'user' ? copy.ui.gpxMode : copy.ui.openGpx;
  const startMapManeuver = (kind: MapManeuverKind) => {
    if (!mapManeuverAvailable || mapManeuverActive) return;
    addAction('map_maneuver_requested', { kind });
    engineRef.current?.startMapManeuver(kind);
  };
  const cancelMapManeuver = () => {
    if (!mapManeuverActive) return;
    addAction('map_maneuver_cancelled', { kind: mapManeuver.kind });
    engineRef.current?.cancelMapManeuver();
  };
  const toggleFpv = () => {
    if (!fpvAvailable && !fpvActive && !fpvSelecting) return;
    if (fpvActive || fpvSelecting) {
      detachPermalink('fpv_exit');
      engineRef.current?.cancelFpv();
      addAction('fpv_cancelled');
      return;
    }
    detachPermalink('fpv_start');
    engineRef.current?.startFpv();
    addAction('fpv_selection_started');
  };
  /** Fallback, narrow bar: the one key for the view. It opens the menu; while the first person view or an aerial shot is on, it ends it. */
  const onMovesKey = () => {
    if (fpvActive || fpvSelecting) toggleFpv();
    else if (mapManeuverActive) cancelMapManeuver();
    else setMapManeuverMenuOpen((open) => !open);
  };
  const movesKeyShown = compactBar && (fpvAvailable || mapManeuverKeyAvailable || fpvActive || fpvSelecting || mapManeuverActive);
  const movesRunning = fpvActive || fpvSelecting || mapManeuverActive;
  const selectMapStyle = (style: MapStyle) => {
    detachPermalink('map_style');
    addAction('map_style_changed', { style });
    setBaseMapStyle(style);
    setMapSwitchOpen(false);
  };
  const clearMapPin = () => {
    if (!mapPin || mapPinRemoving) return;
    detachPermalink('map_pin_clear');
    const engine = engineRef.current;
    if (engine && !engine.isFlat()) {
      setMapPinRemoving(true);
      engine.startMapPinRemoval();
    } else {
      setMapPin(null);
    }
    addAction('map_pin_cleared');
  };
  const toggleMapPin = () => {
    if (viewMode !== 'map' || !mapReady) return;
    if (mapPinSelecting) {
      engineRef.current?.cancelMapPinPlacement();
      addAction('map_pin_placement_cancelled');
      return;
    }
    if (mapPin || mapPinRemoving) {
      clearMapPin();
      return;
    }
    detachPermalink('map_pin_place');
    addAction('map_pin_placement_started');
    engineRef.current?.startMapPinPlacement();
  };
  const clearCurrentLocation = () => {
    if (!currentLocation) return;
    detachPermalink('current_location_clear');
    invalidateMapSearchRequest();
    cancelCurrentLocationRequest();
    setCurrentLocation(null);
  };
  const showCurrentLocation = async () => {
    if (viewMode !== 'map' || !mapReady) return;
    invalidateMapSearchRequest();
    const requestId = ++currentLocationRequestRef.current;
    setCurrentLocationBusy(true);
    try {
      const location = await requestCurrentLocation(typeof navigator === 'undefined' ? undefined : navigator.geolocation);
      if (requestId !== currentLocationRequestRef.current || viewModeRef.current !== 'map') return;
      detachPermalink('map_center');
      currentLocationRecenterRef.current = apartRef.current;
      pendingCurrentLocationRef.current = { requestId, location };
      setMapViewport((viewportState) => ({
        lat: location.lat,
        lon: location.lon,
        scale: viewportState?.scale ?? gpxProjection?.scale ?? 1,
      }));
    } catch (error) {
      if (requestId !== currentLocationRequestRef.current) return;
      const kind = error instanceof CurrentLocationError ? error.kind : 'unknown';
      const message =
        kind === 'unsupported'
          ? copy.toast.currentLocationUnsupported
          : kind === 'permission-denied'
            ? copy.toast.currentLocationPermissionDenied
            : kind === 'timeout'
              ? copy.toast.currentLocationTimeout
              : kind === 'unavailable'
                ? copy.toast.currentLocationUnavailable
                : copy.toast.currentLocationFailed;
      reportWarning('get_current_location', error, { reason: kind });
      setToast(message);
    } finally {
      if (requestId === currentLocationRequestRef.current) setCurrentLocationBusy(false);
    }
  };
  const toggleCurrentLocation = () => {
    if (viewMode !== 'map' || currentLocationBusy) return;
    if (currentLocation) {
      clearCurrentLocation();
      return;
    }
    if (!mapReady) return;
    void showCurrentLocation();
  };
  const commitMapPinLabel = (label: string) => {
    const normalized = normalizeMapPinLabel(label);
    if (!mapPin || mapPin.label === normalized) return;
    detachPermalink('map_pin_label');
    setMapPin((current) => (current ? { ...current, label: normalized } : current));
    addAction('map_pin_label_changed', { has_label: Boolean(normalized.trim()) });
  };
  const toggleHillshade = () => {
    detachPermalink('hillshade');
    const next = !hillshade;
    addAction('map_hillshade_changed', { enabled: next });
    setHillshade(next);
    setMapSwitchOpen(false);
  };
  const toggleMapSunlight = () => {
    detachPermalink('sunlight');
    const next = !mapSunlight;
    addAction('map_sunlight_changed', { enabled: next });
    setMapSunlight(next);
    if (!next) setMapSunAuto(false);
  };
  const toggleMapSunAuto = () => {
    if (!apart || !mapSunlight) return;
    detachPermalink('sun_auto');
    const next = !mapSunAuto;
    if (next) {
      const sun = sunInput(fb?.root ?? pageRef.current);
      if (sun) {
        const start = daylight?.rise == null ? 0 : Math.max(0, daylight.rise - MAP_SUNRISE_OFFSET);
        autoSunDispatchRef.current = true;
        sun.value = String(start);
        sun.dispatchEvent(new Event('input', { bubbles: true }));
        autoSunDispatchRef.current = false;
      }
    }
    addAction('map_sun_auto_changed', {
      enabled: next,
      speed: mapSunSpeed,
      start_minutes: next && daylight?.rise != null ? Math.max(0, daylight.rise - MAP_SUNRISE_OFFSET) : 0,
    });
    setMapSunAuto(next);
  };
  const selectMapSunSpeed = (speed: number) => {
    if (speed < 0 || speed >= MAP_SUN_SPEEDS.length) return;
    detachPermalink('sun_auto_speed');
    setMapSunSpeed(speed);
    addAction('map_sun_auto_speed_changed', { speed });
  };
  const copyMapPermalink = async () => {
    const permalink = buildCurrentMapPermalink();
    if (!permalink) return;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(permalink.url);
      else {
        const input = document.createElement('textarea');
        input.value = permalink.url;
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.append(input);
        input.select();
        if (!document.execCommand('copy')) throw new Error('Clipboard copy failed.');
        input.remove();
      }
      addAction('map_permalink_copied', { view: permalink.view, sunlight: mapSunlight, sun_auto: mapSunAuto });
      // the hint is a card drawn in the scene above the key, which the fallback does not draw: it gets the toast
      if (fb) setToast(copy.toast.permalinkCopied);
      else showXHint('permalink');
    } catch (error) {
      reportWarning('copy_map_permalink', error);
      setToast(copy.toast.permalinkCopyFailed);
    }
  };

  return (
    <main
      lang={language}
      className={`app${photoRouteOverlay ? ' photo-route-overlay' : ''}${mapManeuverActive ? ' map-maneuver-active' : ''}${mapPinSelecting ? ' map-pin-selecting' : ''}${fpvSelecting ? ' fpv-selecting' : ''}${fpvActive ? ' fpv-active' : ''}${fb ? ' fallback-ui' : ''}${docked ? ' fb-docked' : ''}`}
      // the "raise" prompt is dropped once the map is up; it comes back if the map is laid flat again
      data-tutorial-target={(tutorialTarget === 'raise' && apart ? '' : tutorialTarget) || undefined}
    >
      <canvas ref={canvasRef} className="stage-canvas" tabIndex={-1}>
        <StageHost host={fallbackHost}>
        <div className="stage">
          <div ref={pageRef} className="page" style={{ width: layout.pageWidth, height: layout.pageHeight }}>
            <div className="sheet" data-piece="sheet" drawable="" />

            {/* the same map twice: with the hillshade for the flat page, and plain for the model */}
            {(['terrain', 'relief'] as const).map((piece) => (
              <div key={piece} className="terrain" data-piece={piece} drawable="" style={mapStyle}>
                <canvas ref={piece === 'terrain' ? flatRef : reliefRef} />
                {viewMode === 'gpx' && (
                  <svg viewBox={`0 0 ${layout.mapWidth} ${layout.mapHeight}`} aria-hidden="true">
                    <path className="route-casing" d={routeD} />
                    <path className="route-line" d={routeD} />
                  </svg>
                )}
                {!terrain && <span className="terrain-status">{viewMode === 'gpx' ? copy.ui.loadingGpx : copy.ui.loadingTerrain}</span>}
              </div>
            ))}
            <canvas ref={photoRef} aria-hidden="true" style={{ display: 'none' }} />

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
              {shownDetail && viewMode === 'gpx' && (
                <svg viewBox={`${shownDetail.x} ${shownDetail.y} ${shownDetail.w} ${shownDetail.h}`} aria-hidden="true">
                  {/* the line stays about as wide on screen as the view closes in */}
                  <path className="route-casing" d={routeD} style={{ strokeWidth: Math.max(1.2, 5.6 / shownDetail.zoom ** 0.75) }} />
                  <path className="route-line" d={routeD} style={{ strokeWidth: Math.max(0.7, 2.6 / shownDetail.zoom ** 0.75) }} />
                </svg>
              )}
            </div>

            <div className="map" data-map="" style={mapStyle}>
              {coverageRegion === 'unsupported' && (
                <div className="map-coverage-message" data-piece="coverage" data-map-control="" drawable="" role="status" data-selectable="">
                  {copy.ui.mapCoverageUnsupported}
                </div>
              )}
              <StageHost host={fb?.mapControls ?? null}>
              <div className="map-actions">
                {shouldShowCurrentLocationControl(viewMode, apart) && (
                  <CurrentLocationButton
                    active={Boolean(currentLocation)}
                    busy={currentLocationBusy}
                    disabled={currentLocationBusy || (!currentLocation && !mapReady)}
                    label={copy.ui.currentLocation}
                    clearLabel={copy.ui.currentLocationClear}
                    onClick={toggleCurrentLocation}
                  />
                )}
                <div
                  className={`map-switch${mapSwitchOpen ? ' is-open' : ''}`}
                  data-piece="content"
                  data-map-control=""
                  drawable=""
                  role="group"
                  aria-label={copy.ui.mapType}
                >
                  <button
                    type="button"
                    className="map-switch-toggle"
                    aria-expanded={mapSwitchOpen}
                    onClick={() => setMapSwitchOpen((open) => !open)}
                  >
                    <span>{mapSwitchOpen ? copy.ui.map : mapStyleLabel}</span>
                  {mapDataLoading && (
                    <span className="map-switch-loading" role="status" aria-live="polite">
                      <i className="map-spinner" aria-hidden="true" />
                      {mapLoading ? copy.ui.mapLoading : copy.ui.elevationLoading}
                    </span>
                  )}
                    <b className="map-switch-chevron" aria-hidden="true">
                      {mapSwitchOpen ? '⌃' : '⌄'}
                    </b>
                  </button>
                  {mapSwitchOpen && (
                    <>
                      <button type="button" className="map-switch-option" aria-pressed={effectiveMapStyle === 'std'} onClick={() => selectMapStyle('std')}>
                        {copy.ui.standardMap}
                      </button>
                      {coverageRegion !== 'united-states' && (
                        <>
                          <button type="button" className="map-switch-option" aria-pressed={effectiveMapStyle === 'pale'} onClick={() => selectMapStyle('pale')}>
                            {copy.ui.paleMap}
                          </button>
                          <button type="button" className="map-switch-option" aria-pressed={effectiveMapStyle === 'blank'} onClick={() => selectMapStyle('blank')}>
                            {copy.ui.blankMap}
                          </button>
                          <button type="button" className="map-switch-option" aria-pressed={effectiveMapStyle === 'photo'} onClick={() => selectMapStyle('photo')}>
                            {copy.ui.aerial}
                          </button>
                          <button type="button" className="map-switch-option" aria-pressed={effectiveMapStyle === 'photoNames'} onClick={() => selectMapStyle('photoNames')}>
                            {copy.ui.photoNames}
                          </button>
                        </>
                      )}
                      <span className="map-switch-divider" aria-hidden="true" />
                      <button
                        type="button"
                        className="map-switch-option"
                        aria-pressed={hillshade}
                        disabled={effectiveMapStyle === 'photo' || effectiveMapStyle === 'photoNames'}
                        onClick={toggleHillshade}
                      >
                        {hillshade ? copy.ui.hillshadeOn : copy.ui.hillshadeOff}
                      </button>
                    </>
                  )}
                </div>
                <MapCredit region={coverageRegion} copy={copy} />
              </div>
              </StageHost>
              {viewMode === 'map' && mapPin && (
                <div className={`pin map-pin${mapPin.label.trim() ? ' map-pin-labeled' : ''}`} data-piece="pin" data-map-pin="" drawable="">
                  <span className="pin-label">
                    <b className="map-pin-marker" aria-hidden="true">●</b>
                    {fb ? (
                      // the fallback draws the name; it is typed in the sheet's pin card (a drawn textarea cannot take typing)
                      <span className="map-pin-input">{mapPin.label}</span>
                    ) : (
                      <textarea
                        className="map-pin-input"
                        defaultValue={mapPin.label}
                        maxLength={40}
                        rows={1}
                        aria-label={copy.ui.mapPinNameAria}
                        onInput={() => engineRef.current?.refreshHud()}
                        onBlur={(event) => commitMapPinLabel(event.currentTarget.value)}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229) return;
                          // Enter finishes the name (the blur commits it); Shift+Enter breaks the line, once at most
                          if (!event.shiftKey || event.currentTarget.value.includes('\n')) {
                            event.preventDefault();
                            if (!event.shiftKey) event.currentTarget.blur();
                          }
                        }}
                      />
                    )}
                  </span>
                </div>
              )}
              {viewMode === 'map' && currentLocation && (
                <div className="pin current-location" data-piece="pin" data-current-location="" drawable="" role="img" aria-label={copy.ui.currentLocation}>
                  <span className="current-location-marker" aria-hidden="true">
                    <svg viewBox="0 0 24 24" focusable="false">
                      <path d="M12 21s7-6.2 7-12A7 7 0 0 0 5 9c0 5.8 7 12 7 12Z" />
                      <circle cx="12" cy="9" r="2.4" />
                    </svg>
                  </span>
                </div>
              )}
              {viewMode === 'gpx' && ways.map((way, index) => (
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
              {viewMode === 'gpx' && showHigh && high && (
                <div className="pin pin-high" data-piece="pin" data-mark="high" drawable="" role="img" aria-label={copy.ui.highestPoint(high.ele)}>
                  <span className="pin-label">
                    <b>▲</b>
                    <strong>{Math.round(high.ele).toLocaleString(copy.locale)} m</strong>
                  </span>
                </div>
              )}
              {viewMode === 'gpx' && <div className="hiker" data-piece="hiker" drawable="" role="img" aria-label={copy.ui.positionAtTime} />}
              <div className="probe" data-piece="probe" drawable="" aria-hidden="true">
                <b data-probe-text="">-</b>
              </div>
            </div>

            <StageHost host={fb?.panelBody ?? null}>
            {fb && !docked && panelTabs.length > 1 && (
              <PanelTabs
                tabs={panelTabs}
                active={activePanelTab}
                labels={{ route: copy.ui.panelRoute, search: copy.ui.panelSearch, pin: copy.ui.panelPin, sun: copy.ui.sunlight, ways: copy.ui.waypoints }}
                onSelect={setPanelTab}
              />
            )}
            <aside className="side" style={fb ? undefined : { left: layout.sideX, top: PAD, width: PANEL_WIDTH, height: layout.pageHeight - PAD * 2 }}>
              {(viewMode === 'gpx' || !apart) && (
                <section className="slot" data-section={viewMode === 'gpx' ? 'route' : 'search'}>
                  <div className="card" data-piece="card" drawable="" />
                  {viewMode === 'gpx' ? (
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
                        onChange={(event) => {
                          setGpxDirty(true);
                          setRoute((current) => (current ? { ...current, name: event.target.value } : current));
                        }}
                      />
                      <small className="file-name" data-selectable="">
                        {fileName}
                      </small>
                    </div>
                  ) : (
                    <div className="in in-map-search" data-piece="content" drawable="">
                      <div className="row">
                        <span className="label">{copy.ui.map}</span>
                      </div>
                      <form className="map-search-form" onSubmit={(event) => void searchMap(event)}>
                        <input
                          value={mapSearch}
                          onChange={(event) => setMapSearch(event.target.value)}
                          placeholder={copy.ui.mapSearchPlaceholder}
                          aria-label={copy.ui.mapSearchPlaceholder}
                          data-dd-privacy="mask"
                          spellCheck={false}
                        />
                        <button type="submit" className="field" disabled={mapSearchBusy}>
                          {copy.ui.mapSearchSubmit}
                        </button>
                      </form>
                      {mapSearchBusy && (
                        <div className="map-search-busy" role="status" aria-live="polite">
                          <i className="map-spinner" aria-hidden="true" />
                          <span>{copy.ui.mapSearchBusy}</span>
                        </div>
                      )}
                      {mapSearchLocation && (
                        <div className="map-search-location" data-dd-privacy="mask" data-selectable="">
                          {mapSearchLocation.label}
                        </div>
                      )}
                      {mapSearchError && <p className="map-search-error" data-selectable="">{mapSearchError}</p>}
                      {mapSearchResults.length > 0 && (
                        <ol className="map-search-results" data-dd-privacy="mask" data-scroll="">
                          {mapSearchResults.map((result) => (
                            <li key={`${result.lat}:${result.lon}:${result.label}`}>
                              <button type="button" onClick={() => centerMap(result, 'result', result)}>
                              <span className="map-search-result-label">{result.label}</span>
                              {result.detail && <small className="map-search-result-detail">{result.detail}</small>}
                              </button>
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                  )}
                </section>
              )}

              {fb && viewMode === 'map' && mapPin && (
                <section className="slot" data-section="pin">
                  <div className="card" data-piece="card" drawable="" />
                  <div className="in in-map-pin" data-piece="content" drawable="">
                    <div className="row">
                      <span className="label">{copy.ui.mapPinNameAria}</span>
                    </div>
                    <div className="map-pin-field">
                      <b className="map-pin-marker" aria-hidden="true">●</b>
                      <textarea
                        key={`${mapPin.lat}:${mapPin.lon}`}
                        defaultValue={mapPin.label}
                        maxLength={40}
                        rows={2}
                        placeholder={copy.ui.mapPinNameAria}
                        aria-label={copy.ui.mapPinNameAria}
                        enterKeyHint="done"
                        onBlur={(event) => commitMapPinLabel(event.currentTarget.value)}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229) return;
                          // the same as on the pin itself: Enter finishes the name (the blur commits it); Shift+Enter breaks the line, once at most
                          if (!event.shiftKey || event.currentTarget.value.includes('\n')) {
                            event.preventDefault();
                            if (!event.shiftKey) event.currentTarget.blur();
                          }
                        }}
                      />
                    </div>
                  </div>
                </section>
              )}

              {viewMode === 'gpx' && (
                <section className="slot" data-section="route">
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
              )}

              <section className="slot" data-section="sun">
                <div className="card" data-piece="card" drawable="" />
                <div className="in in-sun" data-piece="content" drawable="">
                  <div className="row">
                    <span className="label">{copy.ui.sunlight}</span>
                    <output className="clock" data-clock="" data-selectable="">
                      {formatClock(initialSun)}
                    </output>
                    {viewMode === 'map' && (
                      <button type="button" className="field sunlight-toggle" aria-pressed={mapSunlight} onClick={toggleMapSunlight}>
                        {mapSunlight ? copy.ui.sunlightOn : copy.ui.sunlightOff}
                      </button>
                    )}
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
                    disabled={viewMode === 'map' && !mapSunlight}
                    onInput={() => {
                      if (!autoSunDispatchRef.current) {
                        detachPermalink('time');
                        if (mapSunAuto) setMapSunAuto(false);
                      }
                    }}
                    style={{ ['--track' as string]: sunTrack }}
                  />
                  {viewMode === 'map' && apart && (
                    <div className="sun-auto" data-selectable="">
                      <button
                        type="button"
                        className={`field sunlight-auto-toggle${mapSunAuto ? ' is-active' : ''}`}
                        aria-pressed={mapSunAuto}
                        disabled={!mapSunlight}
                        onClick={toggleMapSunAuto}
                      >
                        {mapSunAuto ? copy.ui.sunAutoStop : copy.ui.sunAuto}
                      </button>
                      <div className="sun-auto-speed" role="group" aria-label={copy.ui.sunAutoSpeed}>
                        {copy.ui.sunAutoSpeedLabels.map((label, index) => (
                          <button
                            key={label}
                            type="button"
                            className={mapSunSpeed === index ? 'is-selected' : ''}
                            aria-pressed={mapSunSpeed === index}
                            disabled={!mapSunlight}
                            onClick={() => selectMapSunSpeed(index)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className={`row row-inputs${viewMode === 'map' ? ' map-sun-inputs' : ''}`}>
                    {viewMode === 'gpx' && (
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
                    )}
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

              {viewMode === 'gpx' && (
                <section className="slot slot-fill" data-section="ways">
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
                </div>
                </section>
              )}
            </aside>
            </StageHost>

            {/* pickers: laid out here, raised off the panel by the engine (fallback: a dialog over the map) */}
            <StageHost host={fb?.modal ?? null}>
            {pop && (
              <div
                className="pop-layer"
                key={pop.seq}
                onClick={(event) => {
                  if (!native && event.target === event.currentTarget) dismissPop();
                }}
              >
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
                            detachPermalink('date');
                            addAction('date_changed', { date: c.iso });
                            setDateExplicit(true);
                            setDate(c.iso);
                            setMonth(c.iso.slice(0, 7));
                            dismissPop();
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
                {pop.kind === 'time' && !native && (
                  <FallbackTimePicker
                    key={pop.seq}
                    clock={pop.target === 'start'}
                    minutes={pop.minutes}
                    copy={copy}
                    head={
                      <div className="pop-head">
                        <strong>{pop.label}</strong>
                        <small>{pop.target === 'start' ? copy.ui.startTime : copy.ui.elapsedTime}</small>
                        <small>
                          {copy.ui.sunrise} {daylight?.rise != null ? formatClock(daylight.rise) : '-'} · {copy.ui.sunset}{' '}
                          {daylight?.set != null ? formatClock(daylight.set) : '-'}
                        </small>
                      </div>
                    }
                    onCancel={dismissPop}
                    onCommit={(minutes) => commitPopTime(pop.target, minutes)}
                  />
                )}
                {pop.kind === 'time' && native && (
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
            </StageHost>
            {!fb && mapManeuverAvailable && mapManeuverMenuOpen && !mapManeuverActive && (
              <div className="maneuver-menu-layer" data-hud="">
                <div
                  className="maneuver-menu"
                  data-piece="maneuver"
                  drawable=""
                  role="dialog"
                  aria-label={copy.ui.mapManeuverMenu}
                >
                  <strong>{copy.ui.mapManeuverMenu}</strong>
                  <button type="button" data-hud-hit="maneuver:dronie" onClick={() => startMapManeuver('dronie')}>
                    {copy.ui.dronie}
                  </button>
                  <button type="button" data-hud-hit="maneuver:circle" onClick={() => startMapManeuver('circle')}>
                    {copy.ui.circle}
                  </button>
                  <button type="button" data-hud-hit="maneuver:rocket" onClick={() => startMapManeuver('rocket')}>
                    {copy.ui.rocket}
                  </button>
                  <button type="button" data-hud-hit="maneuver:helix" onClick={() => startMapManeuver('helix')}>
                    {copy.ui.helix}
                  </button>
                  <button type="button" data-hud-hit="maneuver:boomerang" onClick={() => startMapManeuver('boomerang')}>
                    {copy.ui.boomerang}
                  </button>
                  <button type="button" data-hud-hit="maneuver:asteroid" onClick={() => startMapManeuver('asteroid')}>
                    {copy.ui.asteroid}
                  </button>
                  <button type="button" data-hud-hit="maneuver:dollyZoom" onClick={() => startMapManeuver('dollyZoom')}>
                    {copy.ui.dollyZoom}
                  </button>
                  <button
                    type="button"
                    className="maneuver-menu-close"
                    data-hud-hit="maneuver:close"
                    onClick={() => setMapManeuverMenuOpen(false)}
                  >
                    {copy.ui.close}
                  </button>
                </div>
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
            {xHint && (
              <section
                key={xHint.seq}
                className="x-hint"
                data-x-hint=""
                data-x-hint-kind={xHint.kind}
                data-x-hint-seq={xHint.seq}
                data-x-hint-phase={xHint.phase}
                aria-live="polite"
              >
                <div className="card" data-piece="card" drawable="" />
                <div className="x-hint-content" data-piece="content" drawable="" role="status">
                  {xHint.kind === 'photo'
                    ? copy.ui.xHintPhoto
                    : xHint.kind === 'video'
                      ? copy.ui.xHintVideo
                      : xHint.kind === 'map-pin'
                        ? copy.ui.xHintMapPin
                        : copy.toast.permalinkCopied}
                </div>
              </section>
            )}
          </div>

          {/* the bar: each button is drawn as a key on a slab in front of the camera, and still is the button */}
          <StageHost host={fb?.hud ?? null}>
          <nav className="hud" data-hud="" aria-label={copy.ui.controls}>
            <div className="bar" data-piece="bar" drawable="">
              <span className="well" data-well="mode" />
              {viewMode === 'map' && (
                <>
                  <span className="well" data-well="pin" />
                  <span className="well" data-well="permalink" />
                </>
              )}
              {viewMode === 'gpx' && (
                <>
                  <span className="well" data-well="open" />
                  <span className="well" data-well="place" />
                </>
              )}
              <span className="well well-flip" data-well="flip" />
              {viewMode === 'gpx' && <span className="well" data-well="fly" />}
              {flyoverPlaying && (
                <span className="well" data-well="stop" data-appear="" />
              )}
              {fpvAvailable && <span className="well" data-well="fpv" />}
              {mapManeuverKeyAvailable && !mapManeuverActive && <span className="well" data-well="maneuver" />}
              {mapManeuverActive && <span className="well" data-well="map-cancel" data-appear="" />}
              <span className="well" data-well="camera" />
              <span className="well" data-well="video" />
              {latestMedia && <span className="well" data-well="x" data-appear="" />}
              <span className="bar-hint">
                {copy.ui.dragHint}
                <br />
                {copy.ui.scrollHint}
              </span>
            </div>
            <button
              type="button"
              className="key key-mode"
              data-piece="key"
              data-key="mode"
              drawable=""
              disabled={modeTransition !== null || fpvActive || fpvSelecting || mapManeuverActive || (viewMode === 'map' && gpxRestoreState === 'pending')}
              aria-label={viewMode === 'gpx' ? copy.ui.mapMode : gpxActionLabel}
              onClick={modeButtonAction}
            >
              {viewMode === 'gpx' ? (
                <svg className="map-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="m3 6.2 6-2.7 6 2.7 6-2.7v14.7l-6 2.7-6-2.7-6 2.7V6.2Z" />
                  <path d="M9 3.5v14.7M15 6.2v14.7" />
                  <path className="map-icon-pin" d="M15.8 4.5c0-2 1.4-3.5 3.2-3.5s3.2 1.5 3.2 3.5c0 2.5-3.2 6.7-3.2 6.7s-3.2-4.2-3.2-6.7Z" />
                  <circle className="map-icon-pin-hole" cx="19" cy="4.5" r="1.1" />
                </svg>
              ) : fb ? (
                <KeyFace icon="route" label={copy.ui.gpxMode} />
              ) : (
                copy.ui.gpxMode
              )}
            </button>
            {viewMode === 'map' && (
              <button
                type="button"
                className="key key-pin"
                data-piece="key"
                data-key="pin"
                data-latched={mapPinSelecting || mapPin ? '' : undefined}
                drawable=""
                disabled={!mapReady || fpvActive || fpvSelecting}
                aria-label={mapPinSelecting ? copy.ui.mapPinCancel : copy.ui.mapPin}
                onClick={toggleMapPin}
              >
                <svg className="pin-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M12 21s7-6.2 7-12A7 7 0 0 0 5 9c0 5.8 7 12 7 12Z" />
                  <circle cx="12" cy="9" r="2.4" />
                </svg>
              </button>
            )}
            {viewMode === 'map' && (
              <button
                type="button"
                className="key key-permalink"
                data-piece="key"
                data-key="permalink"
                drawable=""
                aria-label={copy.ui.copyPermalink}
                onClick={() => void copyMapPermalink()}
              >
                <svg className="permalink-icon" viewBox="34 39 96 96" aria-hidden="true" focusable="false">
                  <image href="/permalink-icons.png" width="289" height="161" />
                </svg>
              </button>
            )}
            {!compactBar && fpvAvailable && (
              <button
                type="button"
                className={`key key-fpv${fpvActive ? ' fpv-active' : ''}${fpvSelecting ? ' fpv-selecting' : ''}`}
                data-piece="key"
                data-key="fpv"
                data-latched={fpvActive || fpvSelecting ? '' : undefined}
                drawable=""
                aria-label={fpvActive || fpvSelecting ? copy.ui.fpvCancel : copy.ui.fpv}
                aria-pressed={fpvActive}
                disabled={!mapReady || !terrain}
                onClick={toggleFpv}
              >
                <svg className="fpv-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <g className="fpv-outline">
                    <circle cx="12" cy="4.25" r="3.05" />
                    <path className="fpv-outline-body" d="M9.3 7.3c.3-.8 1.2-1.3 2.7-1.3s2.4.5 2.7 1.3l.7 6.1c-.5.8-1.6 1.3-3.4 1.3s-2.9-.5-3.4-1.3Z" />
                    <path className="fpv-outline-limb" d="M9.7 8.1 6.4 12.7M14.3 8.1l3.3 4.6M10.7 14.1 8.5 20M13.3 14.1l2.2 5.9M7.2 20.1h2.7M14.1 20.1h2.7" />
                  </g>
                  <path className="fpv-limb" d="M9.7 8.1 6.4 12.7M14.3 8.1l3.3 4.6M10.7 14.1 8.5 20M13.3 14.1l2.2 5.9M7.2 20.1h2.7M14.1 20.1h2.7" />
                  <path className="fpv-body" d="M9.3 7.3c.3-.8 1.2-1.3 2.7-1.3s2.4.5 2.7 1.3l.7 6.1c-.5.8-1.6 1.3-3.4 1.3s-2.9-.5-3.4-1.3Z" />
                  <circle className="fpv-head" cx="12" cy="4.25" r="2.25" />
                </svg>
              </button>
            )}
            {viewMode === 'gpx' && (
              <>
            {!tutorialMode && (
            <button
              type="button"
              className="key key-open"
              data-piece="key"
              data-key="open"
              drawable=""
              onClick={openGpxPicker}
            >
              {fb ? <KeyFace icon="open" label={copy.ui.openGpx} /> : copy.ui.openGpx}
            </button>
            )}
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
              {fb ? <KeyFace icon="place" label={placing ? copy.ui.clickRouteMode : copy.ui.addWaypoint} /> : placing ? copy.ui.clickRouteMode : copy.ui.addWaypoint}
            </button>
              </>
            )}
            {!compactBar && mapManeuverKeyAvailable && !mapManeuverActive && (
              <button
                type="button"
                className="key key-maneuver"
                data-piece="key"
                data-key="maneuver"
                drawable=""
                aria-label={copy.ui.mapManeuver}
                aria-expanded={mapManeuverMenuOpen}
                disabled={!mapManeuverAvailable}
                onClick={() => setMapManeuverMenuOpen((open) => !open)}
              >
                ✦
              </button>
            )}
            {!compactBar && mapManeuverActive && (
              <button
                type="button"
                className="key key-maneuver-cancel"
                data-piece="key"
                data-key="map-cancel"
                data-appear=""
                drawable=""
                aria-label={copy.ui.cancelManeuver}
                onClick={cancelMapManeuver}
              >
                ×
              </button>
            )}
            {movesKeyShown && (
              <button
                type="button"
                className={`key key-moves${mapManeuverActive ? ' key-maneuver-cancel' : ''}`}
                data-piece="key"
                // the keys the page dims and lets through while something runs, and the engine's pointer check, know these names
                data-key={fpvActive || fpvSelecting ? 'fpv' : mapManeuverActive ? 'map-cancel' : 'moves'}
                data-latched={fpvActive || fpvSelecting ? '' : undefined}
                drawable=""
                aria-label={fpvActive || fpvSelecting ? copy.ui.fpvCancel : mapManeuverActive ? copy.ui.cancelManeuver : copy.ui.viewMoves}
                aria-expanded={movesRunning ? undefined : mapManeuverMenuOpen}
                onClick={onMovesKey}
              >
                {movesRunning ? (
                  '×'
                ) : (
                  <svg className="moves-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            )}
            {fb && compactBar && viewMode === 'map' && !movesKeyShown && (
              <span className="key key-moves key-moves-placeholder" aria-hidden="true" />
            )}
            <button
              type="button"
              className={`key key-flip${fb && compactBar && flyoverPlaying ? ' key-flyover-compact' : ''}`}
              data-piece="key"
              data-key="flip"
              data-face="front"
              drawable=""
              disabled={fpvActive || fpvSelecting || (!apart && !canRaise)}
              tabIndex={apart ? -1 : 0}
              onClick={() => {
                detachPermalink('raise');
                addAction('view_mode_toggled', { target: 'raised' });
                engineRef.current?.toggle();
              }}
            >
              {fb && compactBar && flyoverPlaying ? <KeyFace icon="raise" label={copy.ui.raise} /> : copy.ui.raise}
            </button>
            <button
              type="button"
              className={`key key-flip${fb && compactBar && flyoverPlaying ? ' key-flyover-compact' : ''}`}
              data-piece="key"
              data-key="flip"
              data-face="back"
              drawable=""
              disabled={fpvActive || fpvSelecting}
              tabIndex={apart ? 0 : -1}
              onClick={() => {
                detachPermalink('lay_flat');
                addAction('view_mode_toggled', { target: 'flat' });
                engineRef.current?.toggle();
              }}
            >
              {copy.ui.layFlat}
            </button>
            {viewMode === 'gpx' && (
              <>
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
              </>
            )}
            <button type="button" className="key key-camera" data-piece="key" data-key="camera" drawable="" aria-label={copy.ui.captureImage} onClick={() => void exportPng()}>
              <svg className="camera-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M7.5 6.5 9 4h6l1.5 2.5H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h3.5Z" />
                <circle cx="12" cy="12.5" r="3.5" />
              </svg>
            </button>
            <button
              type="button"
              className="key key-video"
              data-piece="key"
              data-key="video"
              data-recording={videoRecording ? '' : undefined}
              drawable=""
              aria-label={videoRecording ? copy.ui.stopVideoRecording : copy.ui.recordVideo}
              aria-pressed={videoRecording}
              onClick={() => void startVideoRecording()}
            >
              <svg className="video-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                {videoRecording ? (
                  <rect x="7" y="7" width="10" height="10" rx="1.5" />
                ) : (
                  <>
                    <rect x="2.5" y="6" width="13.5" height="12" rx="2" />
                    <path d="m16 10 5-3v10l-5-3Z" />
                  </>
                )}
              </svg>
            </button>
            {latestMedia && (
              <button
                type="button"
                className="key key-x"
                data-piece="key"
                data-key="x"
                data-appear=""
                drawable=""
                aria-label={copy.ui.postToX}
                onClick={postLatestMedia}
              >
                <svg className="x-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M17.8 3h3.1l-6.8 7.7 8 10.3h-6.2l-4.9-6.3L5.4 21H2.3l7.3-8.3L2 3h6.4l4.4 5.8L17.8 3Zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5Z" />
                </svg>
              </button>
            )}
          </nav>
          </StageHost>
        </div>
        </StageHost>
      </canvas>
      {!native && <div ref={fallbackMountRef} className="fallback-host" aria-hidden="true" />}
      {fb && <div ref={fbMountRef} className="fb-mount" />}
      {fb && !docked && (
        <StageHost host={fb.grip}>
          <SheetGrip
            open={panelOpen}
            copy={copy}
            max={fb.openHeight()}
            onDrag={(height) => fb.setSheet(height, true)}
            onSettle={(open) => {
              setPanelOpen(open);
              fb.setSheet(open ? fb.openHeight() : 0);
            }}
          />
        </StageHost>
      )}
      {fb && infoOpen && (
        <StageHost host={fb.modal}>
          <FallbackDialog label={`${copy.appName} ${copy.about}`} closeLabel={copy.ui.closeDialog} className="fb-flag-dialog" onClose={toggleInfo}>
            <div className="flag flag-static">
              <FlagContent brushes={[]} copy={copy} />
            </div>
            <button type="button" className="fb-dialog-close" data-autofocus="" aria-label={copy.ui.closeDialog} onClick={toggleInfo}>
              ×
            </button>
          </FallbackDialog>
        </StageHost>
      )}

      {fb && mapManeuverAvailable && mapManeuverMenuOpen && !mapManeuverActive && (
        <StageHost host={fb.modal}>
          <FallbackDialog
            label={compactBar ? copy.ui.viewMoves : copy.ui.mapManeuverMenu}
            closeLabel={copy.ui.close}
            className="fb-moves-dialog"
            onClose={() => setMapManeuverMenuOpen(false)}
          >
            <div className="fb-moves">
              <strong>{compactBar ? copy.ui.viewMoves : copy.ui.mapManeuverMenu}</strong>
              {compactBar && fpvAvailable && (
                <>
                  <button
                    type="button"
                    className="pop-btn pop-ok"
                    data-autofocus=""
                    aria-label={copy.ui.fpv}
                    onClick={() => {
                      setMapManeuverMenuOpen(false);
                      toggleFpv();
                    }}
                  >
                    {copy.ui.fpvMenu}
                  </button>
                  <div className="fb-moves-divider" role="separator" />
                </>
              )}
              {MAP_MANEUVER_KINDS.map((kind, index) => (
                <button
                  key={kind}
                  type="button"
                  className="pop-btn"
                  data-autofocus={!(compactBar && fpvAvailable) && index === 0 ? '' : undefined}
                  onClick={() => startMapManeuver(kind)}
                >
                  {copy.ui[kind]}
                </button>
              ))}
              <button type="button" className="pop-btn fb-moves-close" onClick={() => setMapManeuverMenuOpen(false)}>
                {copy.ui.close}
              </button>
            </div>
          </FallbackDialog>
        </StageHost>
      )}

      {fb && fbMedia && (
        <StageHost host={fb.modal}>
          <FallbackDialog
            label={fbMedia.kind === 'photo' ? copy.ui.imageOfView : copy.ui.videoOfView}
            closeLabel={copy.ui.close}
            className="fb-media-dialog"
            onClose={closeFbMedia}
          >
            <div className="fb-media">
              {fbMedia.kind === 'photo' ? (
                <img src={fbMedia.url} alt={copy.ui.imageOfView} />
              ) : (
                <video src={fbMedia.url} controls playsInline preload="metadata" aria-label={copy.ui.videoOfView} />
              )}
              <div className="fb-media-foot">
                {fbMedia.actions === 'split' ? (
                  <>
                    <button type="button" className="pop-btn pop-ok" data-autofocus="" onClick={() => void shareFbMedia()}>
                      {copy.ui.share}
                    </button>
                    <button type="button" className="pop-btn pop-ok" onClick={saveFbMedia}>
                      {copy.ui.save}
                    </button>
                  </>
                ) : (
                  <button type="button" className="pop-btn pop-ok" data-autofocus="" onClick={() => void shareFbMedia()}>
                    {fbMedia.actions === 'both' ? copy.ui.shareMedia : copy.ui.save}
                  </button>
                )}
                <button type="button" className="pop-btn" onClick={closeFbMedia}>
                  {copy.ui.close}
                </button>
              </div>
            </div>
          </FallbackDialog>
        </StageHost>
      )}

      {pendingGpxFile && (
        <div className="gpx-replace-overlay">
          <div className="gpx-replace-dialog" role="dialog" aria-modal="true" aria-labelledby="gpx-replace-title">
            <h2 id="gpx-replace-title">{copy.ui.replaceGpxTitle}</h2>
            <p>{copy.ui.replaceGpxMessage(pendingGpxFile.file.name)}</p>
            <div className="gpx-replace-actions">
              <button type="button" className="pop-btn pop-ok" data-autofocus="" onClick={() => openPendingGpxFile(true)}>
                {copy.ui.saveAndOpenGpx}
              </button>
              <button type="button" className="pop-btn" onClick={() => openPendingGpxFile(false)}>
                {copy.ui.openWithoutSavingGpx}
              </button>
              <button type="button" className="pop-btn" onClick={cancelPendingGpxFile}>
                {copy.ui.cancel}
              </button>
            </div>
          </div>
        </div>
      )}

      <div ref={hudHitLayerRef} className="hud-hit-layer" aria-hidden="true">
        {!mapManeuverActive && (
          <>
            <button
              type="button"
              data-hud-hit="mode"
              tabIndex={-1}
              disabled={modeTransition !== null || (viewMode === 'map' && gpxRestoreState === 'pending')}
              onClick={modeButtonAction}
            />
            {viewMode === 'map' && (
              <button type="button" data-hud-hit="pin" tabIndex={-1} disabled={!mapReady || fpvActive || fpvSelecting} onClick={toggleMapPin} />
            )}
            {viewMode === 'map' && (
              <button type="button" data-hud-hit="permalink" tabIndex={-1} onClick={() => void copyMapPermalink()} />
            )}
            {fpvAvailable && (
              <button type="button" data-hud-hit="fpv" tabIndex={-1} disabled={!mapReady || !terrain} onClick={toggleFpv} />
            )}
            {viewMode === 'gpx' && (
              <>
                {!tutorialMode && (
                  <button
                    type="button"
                    data-hud-hit="open"
                    tabIndex={-1}
                    onClick={openGpxPicker}
                  />
                )}
                <button
                  type="button"
                  data-hud-hit="place"
                  tabIndex={-1}
                  onClick={() => {
                    addAction('waypoint_placement_toggled', { enabled: !placing });
                    setPlacing((on) => !on);
                  }}
                />
                <button
                  type="button"
                  data-hud-hit="fly"
                  tabIndex={-1}
                  disabled={flyoverReturning}
                  onClick={() => {
                    addAction('flyover_control', { action: flyoverPlaying ? (flyoverPaused ? 'resume' : 'pause') : 'play' });
                    if (flyoverPlaying) engineRef.current?.toggleFlyoverPause();
                    else engineRef.current?.flyover();
                  }}
                />
                {flyoverPlaying && (
                  <button
                    type="button"
                    data-hud-hit="stop"
                    tabIndex={-1}
                    onClick={() => {
                      addAction('flyover_control', { action: 'stop' });
                      engineRef.current?.flyover();
                    }}
                  />
                )}
              </>
            )}
            {mapManeuverAvailable && (
              <button
                type="button"
                data-hud-hit="maneuver"
                tabIndex={-1}
                onClick={() => setMapManeuverMenuOpen((open) => !open)}
              />
            )}
            <button
              type="button"
              data-hud-hit="flip"
              tabIndex={-1}
              disabled={fpvActive || fpvSelecting || (!apart && !canRaise)}
              onClick={() => {
                addAction('view_mode_toggled', { target: apart ? 'flat' : 'raised' });
                engineRef.current?.toggle();
              }}
            />
            <button type="button" data-hud-hit="camera" tabIndex={-1} onClick={() => void exportPng()} />
            <button type="button" data-hud-hit="video" tabIndex={-1} onClick={() => void startVideoRecording()} />
            {latestMedia && (
              <button type="button" data-hud-hit="x" tabIndex={-1} onClick={postLatestMedia} />
            )}
            {mapManeuverMenuOpen && (
              <>
                <button type="button" data-hud-hit="maneuver:dronie" tabIndex={-1} onClick={() => startMapManeuver('dronie')} />
                <button type="button" data-hud-hit="maneuver:circle" tabIndex={-1} onClick={() => startMapManeuver('circle')} />
                <button type="button" data-hud-hit="maneuver:rocket" tabIndex={-1} onClick={() => startMapManeuver('rocket')} />
                <button type="button" data-hud-hit="maneuver:helix" tabIndex={-1} onClick={() => startMapManeuver('helix')} />
                <button type="button" data-hud-hit="maneuver:boomerang" tabIndex={-1} onClick={() => startMapManeuver('boomerang')} />
                <button type="button" data-hud-hit="maneuver:asteroid" tabIndex={-1} onClick={() => startMapManeuver('asteroid')} />
                <button type="button" data-hud-hit="maneuver:dollyZoom" tabIndex={-1} onClick={() => startMapManeuver('dollyZoom')} />
                <button type="button" data-hud-hit="maneuver:close" tabIndex={-1} onClick={() => setMapManeuverMenuOpen(false)} />
              </>
            )}
          </>
        )}
        {mapManeuverActive && (
          <button type="button" data-hud-hit="map-cancel" tabIndex={-1} onClick={cancelMapManeuver} />
        )}
      </div>

      <div ref={flagTwinRef} className="flag flag-twin" aria-hidden="true">
        <FlagContent brushes={[]} copy={copy} twin />
      </div>
      <button
        type="button"
        className="info-button"
        aria-label={copy.ui.helpLinks}
        title={copy.ui.helpLinks}
        aria-pressed={infoOpen}
        disabled={flyoverPlaying || flyoverReturning || mapManeuverActive}
        onClick={toggleInfo}
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
