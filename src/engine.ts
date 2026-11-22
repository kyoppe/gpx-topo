import { nearestTurn } from './angle';
import { nearestAlong } from './geo';
import type { HtmlInCanvasElement, PaintEvent } from './htmlInCanvas';
import { holdLean } from './lean';
import { separation, type ScreenPoint } from './overlap';
import { createRenderer, type DrawItem, type TextureLayer, type Vec3 } from './renderer';
import { formatClock, lightAt, type Light } from './sun';
import { formatMeters, type Terrain } from './terrain';

export type EngineWay = { id: string; x: number; y: number; km: number; minutes: number };

export type EngineModel = {
  pageWidth: number;
  pageHeight: number;
  mapX: number;
  mapY: number;
  mapWidth: number;
  mapHeight: number;
  terrain: Terrain | null;
  /** The route in map px with the distance from the start (km), every few px. */
  route: { x: number; y: number; km: number }[];
  ways: EngineWay[];
  /** Marks on the map (map px) that are not waypoints, such as the high point. */
  marks: { id: string; x: number; y: number }[];
  date: string;
  lat: number;
  lon: number;
  /** Where a distance along the route sits on the elevation profile drawing. */
  profilePoint(km: number): [number, number];
  /** The distance along the route (km) at an x on the elevation profile drawing. */
  profileKm(x: number): number;
};

/** A part of the map (map px) to draw sharper for a close view, at `density` image px per map px. */
export type DetailRequest = { x: number; y: number; w: number; h: number; density: number; zoom: number };

export type EngineCallbacks = {
  onApartChange(apart: boolean): void;
  /** A click while placing a waypoint: how far along the route (km) it landed, or null when it missed the route. */
  onRouteClick(km: number | null): void;
  onDetail(request: DetailRequest | null): void;
  /** A picker was confirmed: clock minutes for `start`, elapsed minutes for a waypoint id. */
  onTimeCommit(target: string, minutes: number): void;
  /** The picker marked `data-seq` finished folding away. */
  onPopClosed(seq: string): void;
  onFlightChange(phase: 'intro' | 'run' | 'return' | null): void;
};

type Kind = 'sheet' | 'terrain' | 'relief' | 'detail' | 'card' | 'content' | 'pin' | 'bar' | 'key' | 'pop' | 'row';
type Drum = {
  name: string;
  /** how many values go round: 24 hours, 60 minutes */
  n: number;
  v: number;
  vT: number;
  rows: Piece[];
  slot: [number, number, number, number];
  /** screen px per row at the front, for dragging, and where that front is across the screen */
  rowPx: number;
  sx: number;
};
type Piece = {
  el: HTMLElement;
  kind: Kind;
  tex: TextureLayer;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  O: Vec3;
  ex: Vec3;
  ey: Vec3;
  stale: boolean;
  css?: string;
  order: number;
  card?: Piece;
  nrm: Vec3;
  topZ: number;
  /** pins: where on the map (map px) it stands, and how tall its stem is */
  at: { x: number; y: number };
  stand: number;
  hidden: boolean;
  anchor: [number, number, number, number];
  /** detail: the part of the map its texture holds (map uv), set when it is uploaded */
  rect: [number, number, number, number] | null;
  /** keys: which key, which face of it, the well it sits in on the bar, its side colour, and how it moves */
  name: string;
  face: string;
  well: [number, number, number, number];
  side: Vec3;
  hot: number;
  press: number;
  flip: number;
  /** cards: how far they have stepped aside to stay clear of each other on screen (world px along the camera's right and up) */
  dodge: [number, number];
};
type FlyPose = { e: number; yaw: number; tilt: number; zoom: number; pan: Vec3 };
type Flight = {
  phase: 'intro' | 'run' | 'return';
  t: number;
  saved: FlyPose & { km: number; kmT: number; sun: number | null };
  current: FlyPose;
  final: FlyPose | null;
};
/** Where a flat piece stands: its corner, its edge directions, its normal, and its size. */
type Frame = Pick<Piece, 'O' | 'ex' | 'ey' | 'nrm' | 'w' | 'h'>;
type Cam = { vp: Float32Array; eye: Vec3; r: Vec3; u: Vec3; dir: Vec3; base: Vec3; yaw: number; D: number };

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
// The page is laid out to fill the window above a minimum size; these margins leave room for the bar.
export const FRAME_X = 40;
export const FRAME_Y = 120;
const RAISE = 40;
const FOV = 0.5;
/** The model stands on a plinth this many px thick. */
const PLINTH = 6;
const ZOOM_MIN = 1;
const ZOOM_MAX = 8;
/** Closing in, the camera stands up by this share of its tilt at ZOOM_MAX, so it looks down on the ground rather than across the model's sides. */
const ZOOM_STAND = 0.45;
/** Cards turn with the map until their lower edge leans this far on screen (rad), then hold. */
const CARD_LEAN_MAX = (20 * Math.PI) / 180;
/** Within this much (rad) of the map's half turn, cards swing level and over to the other side rather than jump across. */
const CARD_FLIP = (40 * Math.PI) / 180;
/**
 * Cards step aside to keep this many screen px between them (less than they have at rest); they glide to where
 * they step at this rate (1/s).
 */
const CARD_GAP = 4;
const CARD_GLIDE = 10;
/** The part of the map in view is drawn again from finer tiles once it wants this much more than the whole map has. */
const DETAIL_GAIN = 1.25;
/** Longest side of the detail texture at a device pixel ratio of 1; it grows with the ratio. */
const DETAIL_MAX_SIDE = 2048;
/** Time drums: the angle between rows (rad); seven row elements go round and are relabelled. */
const DRUM_STEP = 0.35;
const DRUM_ROWS = 7;
/** A press this close (px) to the runner's dot on the elevation profile picks it up. */
const RUNNER_REACH = 12;
const INTERACTIVE = 'input,button,textarea,select,label,a,[contenteditable]';
const SELECTABLE = '[data-selectable], [data-selectable] *';
/** Fields that take typing: they keep the browser's own menu and Esc only leaves them. */
const EDITABLE = 'input:not([type=range]):not([type=button]):not([type=submit]),textarea,[contenteditable]';
/** A click this close (CSS px) to the route line places a waypoint on it. */
const ROUTE_REACH = 12;

export type Engine = ReturnType<typeof createEngine>;

export function createEngine(canvas: HtmlInCanvasElement, page: HTMLElement, callbacks: EngineCallbacks) {
  const R = createRenderer(canvas);
  const stage = page.parentElement as HTMLElement;

  let model: EngineModel | null = null;
  let PW = 1200;
  let PH = 700;
  let MAPX = 20;
  let MAPY = 20;
  let MW = 660;
  let MH = 660;

  let pieces: Piece[] = [];
  const byEl = new Map<Element, Piece>();
  let sheet: Piece | null = null;
  let land: Piece | null = null;
  let relief: Piece | null = null;
  let detail: Piece | null = null;
  let cards: Piece[] = [];
  let contents: Piece[] = [];
  let pins: Piece[] = [];
  let hiker: Piece | null = null;
  let probe: Piece | null = null;
  let probeText: HTMLElement | null = null;
  let sunEl: HTMLInputElement | null = null;
  let clockEl: HTMLElement | null = null;
  let cursorEl: SVGCircleElement | null = null;
  let profileEl: HTMLElement | null = null;

  const st = {
    sunT: null as number | null,
    sunSlow: false,
    km: 0,
    kmT: 0,
    e: 0,
    ev: 0,
    eT: 0,
    yaw: 0,
    tilt: 0,
    zoom: 1,
    yawT: 0,
    tiltT: 0,
    zoomT: 1,
    pan: [0, 0, 0] as Vec3,
    panT: [0, 0, 0] as Vec3,
    bouncy: false,
  };
  const HERO = { yaw: 0.14, tilt: 0.99 };
  let vw = 1;
  let vh = 1;
  let last = 0;
  let pending = false;
  let drag: 'turn' | 'pan' | 'drum' | 'runner' | null = null;
  let activeWay: string | null = null;
  let flight: Flight | null = null;
  let placing = false;
  let disposed = false;
  let cam: Cam = { vp: new Float32Array(16), eye: [0, 0, 1], r: [1, 0, 0], u: [0, -1, 0], dir: [0, 0, 1], base: [0, 0, 0], yaw: 0, D: 1 };
  let light: Light = { dir: [0, 0, 1], col: [1, 1, 1], amb: [0.5, 0.5, 0.5], expo: 1, night: 0, elevation: 45 };
  /** the elevation under the pointer, in 3D */
  let hover: { x: number; y: number; ele: number } | null = null;
  let probeShown = '';
  let previewMinutes: number | null = null;
  /** what the drums will settle on, for the clock, while the light follows them as they turn */
  let previewClock: number | null = null;
  let previewDay: string | null = null;

  const liftOf = (e: number) => smooth(e / 0.55);
  const perM = () => (model?.terrain ? 1 / model.terrain.metersPerPixel : 0);
  /** Height of the ground (world px) at a map point. */
  function groundZ(mx: number, my: number, lift: number) {
    const T = model?.terrain;
    if (!T) return 0.06;
    return lift * (PLINTH + (T.elev(mx, my) - T.baseElevation) * perM()) + 0.06;
  }
  function topZ(lift: number) {
    const T = model?.terrain;
    return T ? lift * (PLINTH + (T.maxElevation - T.baseElevation) * perM()) : 0;
  }

  const mulBy = (m: Float32Array, v: number[]) => [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * v[3],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * v[3],
    0,
    m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] * v[3],
  ];
  const mul = (v: number[]) => mulBy(cam.vp, v);
  /** On-screen direction (px, y up) of a short step along `d` from `at`. */
  function screenStep(at: Vec3, d: Vec3) {
    const a = mul([at[0], at[1], at[2], 1]);
    const b = mul([at[0] + d[0], at[1] + d[1], at[2] + d[2], 1]);
    return [((b[0] / b[3] - a[0] / a[3]) * vw) / 2, ((b[1] / b[3] - a[1] / a[3]) * vh) / 2];
  }
  /**
   * How far (rad, about the vertical) a card whose lower edge is centred on `at` swivels against the page:
   * none while the page's lean on screen is under the limit, then enough to hold the edge at the limit,
   * going level as the map passes its half turn.
   */
  function cardSwivel(at: Vec3) {
    const a = screenStep(at, [1, 0, 0]);
    const b = screenStep(at, [0, 1, 0]);
    const lean = Math.atan2(a[1], a[0]);
    // the page's x lies flat on screen, so its lean crosses over, exactly when the camera is half a turn round
    const turn = Math.abs(cam.yaw - nearestTurn(cam.yaw));
    const want = holdLean(lean, turn, CARD_LEAN_MAX, CARD_FLIP);
    if (want === lean) return 0;
    // the edge runs along (cos ph, -sin ph, 0), so on screen along a cos ph - b sin ph; turn it onto `want`
    const t = [Math.cos(want), Math.sin(want)];
    const ca = a[0] * t[1] - a[1] * t[0];
    const cb = b[0] * t[1] - b[1] * t[0];
    let ph = Math.atan2(ca, cb);
    if (Math.cos(ph) * (a[0] * t[0] + a[1] * t[1]) - Math.sin(ph) * (b[0] * t[0] + b[1] * t[1]) < 0) ph += Math.PI;
    return ph > Math.PI ? ph - 2 * Math.PI : ph;
  }
  /** Stands a card with the middle of its lower edge at `at`, leaning back (sin, cos) and swivelled by `ph` against the page. */
  function seatCard(p: Frame, at: Vec3, ph: number, sa: number, ca: number) {
    const cp = Math.cos(ph);
    const sp = Math.sin(ph);
    p.ex = [cp, -sp, 0];
    p.ey = [sp * ca, cp * ca, -sa];
    p.nrm = [sp * sa, cp * sa, ca];
    p.O = [0, 1, 2].map((i) => at[i] - (p.ex[i] * p.w) / 2 - p.ey[i] * p.h) as Vec3;
  }
  /** Canvas px (y down) of a world point, or null behind the eye. */
  function toScreen(P: Vec3): ScreenPoint | null {
    const c = mul([P[0], P[1], P[2], 1]);
    return c[3] > 1e-6 ? [((c[0] / c[3]) * 0.5 + 0.5) * vw, ((-c[1] / c[3]) * 0.5 + 0.5) * vh] : null;
  }
  const cornersOf = (p: Frame) =>
    [
      [0, 0],
      [p.w, 0],
      [p.w, p.h],
      [0, p.h],
    ].map(([fx, fy]) => [0, 1, 2].map((i) => p.O[i] + p.ex[i] * fx + p.ey[i] * fy) as Vec3);
  /**
   * Cards that would cover each other on screen step apart the shortest way from their seats, across the view
   * at their own depth and never down into the page. They are never drawn into the view: past its edge they are cut off
   * rather than brought over the map. Sets how far each has stepped (`dodge`) and returns whether any of them is still on its way.
   */
  function dodgeCards(dt: number, rise: number, sa: number, ca: number) {
    const shown = cards.filter((c) => c.w > 0 && c.h > 0);
    const px: number[] = [];
    for (const c of shown) {
      const mid: Vec3 = [0, 1, 2].map((i) => c.O[i] + (c.ex[i] * c.w) / 2 + (c.ey[i] * c.h) / 2) as Vec3;
      const m0 = toScreen(mid);
      const m1 = toScreen([mid[0] + cam.r[0], mid[1] + cam.r[1], mid[2] + cam.r[2]]);
      if (!m0 || !m1) return false;
      px.push(Math.hypot(m1[0] - m0[0], m1[1] - m0[1]) || 1);
    }
    const want: [number, number][] = shown.map(() => [0, 0]);
    const probe: Frame = { w: 0, h: 0, O: [0, 0, 0], ex: [1, 0, 0], ey: [0, 1, 0], nrm: [0, 0, 1] };
    // a card stepped by `want`, turned to face the view from there as it will be
    const at = (k: number): ScreenPoint[] => {
      const c = shown[k];
      const seat = [c.x + c.w / 2, c.y + c.h, c.z].map((v, i) => v + cam.r[i] * want[k][0] + cam.u[i] * want[k][1]) as Vec3;
      probe.w = c.w;
      probe.h = c.h;
      seatCard(probe, seat, cardSwivel(seat) * rise, sa, ca);
      return cornersOf(probe).map((P) => toScreen(P) ?? [0, 0]);
    };
    const apart = () => {
      let clear = true;
      for (let i = 0; i < shown.length; i += 1) {
        for (let j = i + 1; j < shown.length; j += 1) {
          const push = separation(at(i), at(j), CARD_GAP);
          if (!push) continue;
          clear = false;
          want[i][0] -= push[0] / 2 / px[i];
          want[j][0] += push[0] / 2 / px[j];
          want[i][1] = Math.max(0, want[i][1] + push[1] / 2 / px[i]);
          want[j][1] = Math.max(0, want[j][1] - push[1] / 2 / px[j]);
        }
      }
      return clear;
    };
    // zoomed in, the cards keep their seats: drawn into a close view they would stand in front of the ground looked at
    if (st.zoom < 1.02) for (let it = 0; it < 32; it += 1) if (apart()) break;
    const glide = 1 - Math.exp(-dt * CARD_GLIDE);
    let gliding = false;
    shown.forEach((c, k) => {
      const dx = want[k][0] - c.dodge[0];
      const dy = want[k][1] - c.dodge[1];
      if (Math.abs(dx) + Math.abs(dy) < 0.05) c.dodge = want[k];
      else {
        c.dodge = [c.dodge[0] + dx * glide, c.dodge[1] + dy * glide];
        gliding = true;
      }
    });
    return gliding;
  }
  /** Whether a card stands between the eye and a world point. */
  function behindCard(P: Vec3) {
    const e = cam.eye;
    const d = [P[0] - e[0], P[1] - e[1], P[2] - e[2]];
    for (const c of cards) {
      if (!c.w) continue;
      const n = c.nrm;
      const den = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
      if (Math.abs(den) < 1e-9) continue;
      const t = ((c.O[0] - e[0]) * n[0] + (c.O[1] - e[1]) * n[1] + (c.O[2] - e[2]) * n[2]) / den;
      if (t <= 0 || t >= 1) continue;
      const q = [0, 1, 2].map((i) => e[i] + d[i] * t - c.O[i]);
      const u = q[0] * c.ex[0] + q[1] * c.ex[1] + q[2] * c.ex[2];
      const v = q[0] * c.ey[0] + q[1] * c.ey[1] + q[2] * c.ey[2];
      if (u >= 0 && u <= c.w && v >= 0 && v <= c.h) return true;
    }
    return false;
  }
  /** A pin any part of which a card covers gives its clicks to the card. */
  function pinCovered(p: Piece) {
    const mid: Vec3 = [0, 1, 2].map((i) => p.O[i] + (p.ex[i] * p.w) / 2 + (p.ey[i] * p.h) / 2) as Vec3;
    return [...cornersOf(p), mid].some(behindCard);
  }

  // The camera for a pose: straight down when flat, the hero view when up; pulled back until the model fits.
  function camera(e: number, yawOff: number, tiltOff: number, zoom: number, pan: Vec3): Cam {
    const p = smooth(e / 0.5);
    const lift = liftOf(e);
    const top = topZ(lift);
    const yaw = (HERO.yaw + yawOff) * p;
    const stand = 1 - ZOOM_STAND * clamp(Math.log(zoom) / Math.log(ZOOM_MAX), 0, 1);
    const tilt = clamp(HERO.tilt + tiltOff, 0.02, 1.48) * p * stand;
    const fit = Math.min((vw - FRAME_X) / PW, (vh - FRAME_Y) / PH, 1.3);
    const D0 = vh / 2 / Math.tan(FOV / 2) / fit;
    let tx = lerp(PW / 2, PW / 2 - 10, p);
    let ty = lerp(PH / 2 + RAISE / fit, PH / 2 - 10, p);
    let tz = lerp(0, top * 0.4, p);
    const dir: Vec3 = [Math.sin(tilt) * Math.sin(yaw), Math.sin(tilt) * Math.cos(yaw), Math.cos(tilt)];
    const r: Vec3 = [Math.cos(yaw), -Math.sin(yaw), 0];
    const u: Vec3 = [-Math.cos(tilt) * Math.sin(yaw), -Math.cos(tilt) * Math.cos(yaw), Math.sin(tilt)];
    const f = 1 / Math.tan(FOV / 2);
    const asp = vw / vh;
    const m = new Float32Array(16);
    let eye: Vec3 = [0, 0, 1];
    const build = (D: number, x: number, y: number, z: number) => {
      eye = [x + dir[0] * D, y + dir[1] * D, z + dir[2] * D];
      const near = D * 0.1;
      const far = D * 14;
      const a = (far + near) / (near - far);
      const b = (2 * far * near) / (near - far);
      const V = [r, u, dir].map((ax) => [ax[0], ax[1], ax[2], -(ax[0] * eye[0] + ax[1] * eye[1] + ax[2] * eye[2])]);
      const rows = [V[0].map((v) => (v * f) / asp), V[1].map((v) => v * f), V[2].map((v, i) => v * a + (i === 3 ? b : 0)), V[2].map((v) => -v)];
      for (let c = 0; c < 4; c += 1) for (let ri = 0; ri < 4; ri += 1) m[c * 4 + ri] = rows[ri][c];
    };
    let D = D0;
    if (p > 0.001) {
      const cardTop = Math.max(8, ...cards.map((c) => c.topZ || 0)) + 6;
      const summit = model?.terrain?.summit ?? { x: MW / 2, y: MH / 2 };
      const pts: Vec3[] = [
        [0, 0, 0],
        [PW, 0, 0],
        [0, PH, 0],
        [PW, PH, 0],
        [MAPX, MAPY, top * 0.5],
        [MAPX + MW, MAPY, top * 0.5],
        [MAPX, MAPY + MH, top * 0.4],
        [MAPX + MW, MAPY + MH, top * 0.4],
        [MAPX + summit.x, MAPY + summit.y, top + 30 * lift],
        [PW - 20, 60, cardTop],
        [PW - 20, PH - 20, cardTop],
      ];
      const lo = -(1 - 170 / vh);
      const hi = 0.93;
      const tx0 = tx;
      const ty0 = ty;
      const tz0 = tz;
      for (let it = 0; it < 4; it += 1) {
        build(D, tx, ty, tz);
        let mx = 0;
        let y0 = 9;
        let y1 = -9;
        for (const q of pts) {
          const c = mulBy(m, [q[0], q[1], q[2], 1]);
          const x = c[0] / c[3];
          const y = c[1] / c[3];
          mx = Math.max(mx, Math.abs(x) / 0.95);
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
        mx = Math.max(mx, (y1 - y0) / (hi - lo));
        const off = ((y1 + y0) / 2 - (hi + lo) / 2) * D * Math.tan(FOV / 2) * 0.9;
        tx += u[0] * off;
        ty += u[1] * off;
        tz += u[2] * off;
        D *= lerp(1, mx, 0.9);
      }
      tx = lerp(tx0, tx, p);
      ty = lerp(ty0, ty, p);
      tz = lerp(tz0, tz, p);
      D = lerp(D0, D, p);
    }
    D /= zoom;
    build(D, tx + pan[0], ty + pan[1], tz + pan[2]);
    return { vp: m, eye, r, u, dir, base: [tx, ty, tz], yaw, D };
  }

  const FLYOVER_INTRO = 4;
  const FLYOVER_DURATION = 60;
  const FLYOVER_RETURN = 2.5;

  function routeAt(km: number) {
    const route = model?.route ?? [];
    if (route.length < 2) return { x: 0, y: 0, km: 0, tx: 0, ty: 1 };
    let lo = 0;
    let hi = route.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (route[mid].km <= km) lo = mid;
      else hi = mid;
    }
    const a = route[lo];
    const b = route[hi];
    const f = clamp((km - a.km) / Math.max(1e-6, b.km - a.km), 0, 1);
    const tx = b.x - a.x;
    const ty = b.y - a.y;
    const length = Math.hypot(tx, ty) || 1;
    return { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f), km: lerp(a.km, b.km, f), tx: tx / length, ty: ty / length };
  }

  function flyPoseAt(km: number, zoom = 1.45, tilt = -0.22): FlyPose {
    const point = routeAt(km);
    const total = model?.route[model.route.length - 1]?.km ?? point.km;
    const span = Math.min(2.2, Math.max(0.4, total * 0.018));
    const before = routeAt(Math.max(model?.route[0]?.km ?? 0, km - span));
    const after = routeAt(Math.min(total, km + span));
    const tx = after.x - before.x;
    const ty = after.y - before.y;
    const length = Math.hypot(tx, ty) || 1;
    const yaw = Math.atan2(-tx / length, -ty / length) - HERO.yaw;
    const base = camera(1, yaw, tilt, zoom, [0, 0, 0]).base;
    const target: Vec3 = [MAPX + point.x, MAPY + point.y, groundZ(point.x, point.y, liftOf(1))];
    return { e: 1, yaw, tilt, zoom, pan: target.map((v, i) => v - base[i]) as Vec3 };
  }

  function angleStep(from: number, to: number, amount: number) {
    let d = to - from;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return from + d * amount;
  }

  function blendFlyPose(from: FlyPose, to: FlyPose, amount: number): FlyPose {
    return {
      e: lerp(from.e, to.e, amount),
      yaw: angleStep(from.yaw, to.yaw, amount),
      tilt: lerp(from.tilt, to.tilt, amount),
      zoom: Math.exp(lerp(Math.log(from.zoom), Math.log(to.zoom), amount)),
      pan: from.pan.map((v, i) => lerp(v, to.pan[i], amount)) as Vec3,
    };
  }

  function setFlightRoute(km: number) {
    const point = routeAt(km);
    st.km = point.km;
    st.kmT = point.km;
    walkTo(point.km);
    if (sunEl) {
      sunEl.value = String(Math.round(minutesAt(point.km)));
      st.sunT = null;
      updateSun();
      st.km = st.kmT = point.km;
    }
  }

  function restoreFlight() {
    if (!flight) return;
    const saved = flight.saved;
    st.e = saved.e;
    st.eT = saved.e;
    st.ev = 0;
    st.yaw = saved.yaw;
    st.yawT = saved.yaw;
    st.tilt = saved.tilt;
    st.tiltT = saved.tilt;
    st.zoom = saved.zoom;
    st.zoomT = saved.zoom;
    st.pan = [...saved.pan];
    st.panT = [...saved.pan];
    st.km = saved.km;
    st.kmT = saved.kmT;
    st.sunT = null;
    walkTo(saved.km);
    if (saved.sun !== null && sunEl) {
      sunEl.value = String(Math.round(saved.sun));
      updateSun();
      st.km = saved.km;
      st.kmT = saved.kmT;
    }
    flight = null;
    callbacks.onFlightChange(null);
  }

  function returnFromFlight() {
    if (!flight || flight.phase === 'return') return;
    flight.phase = 'return';
    flight.t = 0;
    flight.final ??= flight.current;
    callbacks.onFlightChange('return');
    need();
  }

  function advanceFlight(dt: number): FlyPose | null {
    if (!flight || !model?.route.length) return null;
    flight.t += dt;
    if (flight.phase === 'intro') {
      const start = model.route[0].km;
      const approach = flyPoseAt(start, 0.52, -0.06);
      const chase = flyPoseAt(start);
      const q = smooth(clamp(flight.t / FLYOVER_INTRO, 0, 1));
      const pose =
        q < 0.35
          ? blendFlyPose(flight.saved, approach, smooth(q / 0.35))
          : blendFlyPose(approach, chase, smooth((q - 0.35) / 0.65));
      st.e = pose.e;
      st.eT = pose.e;
      st.ev = 0;
      flight.current = pose;
      if (q >= 1) {
        flight.phase = 'run';
        flight.t = 0;
        callbacks.onFlightChange('run');
        setFlightRoute(start);
      }
      return pose;
    }
    if (flight.phase === 'run') {
      st.e = 1;
      st.eT = 1;
      st.ev = 0;
      const total = model.route[model.route.length - 1].km;
      const q = clamp(flight.t / FLYOVER_DURATION, 0, 1);
      const km = lerp(model.route[0].km, total, smooth(q));
      const target = flyPoseAt(km);
      const pose = blendFlyPose(flight.current, target, 1 - Math.exp(-dt * 5));
      setFlightRoute(km);
      flight.current = pose;
      if (q >= 1) {
        flight.phase = 'return';
        flight.t = 0;
        flight.final = pose;
        callbacks.onFlightChange('return');
      }
      return pose;
    }
    const from = flight.final ?? flight.current;
    const q = smooth(clamp(flight.t / FLYOVER_RETURN, 0, 1));
    const saved = flight.saved;
    const pose: FlyPose = {
      e: lerp(from.e, saved.e, q),
      yaw: lerp(from.yaw, saved.yaw, q),
      tilt: lerp(from.tilt, saved.tilt, q),
      zoom: Math.exp(lerp(Math.log(from.zoom), Math.log(saved.zoom), q)),
      pan: from.pan.map((v, i) => lerp(v, saved.pan[i], q)) as Vec3,
    };
    st.e = pose.e;
    st.eT = pose.e;
    st.ev = 0;
    if (q >= 1) {
      restoreFlight();
      return { e: saved.e, yaw: saved.yaw, tilt: saved.tilt, zoom: saved.zoom, pan: [...saved.pan] };
    }
    return pose;
  }

  function flyover() {
    if (!model?.route.length || !sunEl) return;
    if (flight) {
      returnFromFlight();
      return;
    }
    flight = {
      phase: 'intro',
      t: 0,
      saved: {
        e: st.e,
        yaw: st.yaw,
        tilt: st.tilt,
        zoom: st.zoom,
        pan: [...st.pan],
        km: st.km,
        kmT: st.kmT,
        sun: Number(sunEl.value),
      },
      current: { e: st.e, yaw: st.yaw, tilt: st.tilt, zoom: st.zoom, pan: [...st.pan] },
      final: null,
    };
    st.eT = 1;
    st.bouncy = false;
    setFlightRoute(model.route[0].km);
    callbacks.onFlightChange('intro');
    need();
  }

  const targetCam = () => camera(st.eT, st.yawT, st.tiltT, st.zoomT, st.panT);

  /** The ray through a canvas point (CSS px). */
  function ray(c: Cam, sx: number, sy: number) {
    const f = 1 / Math.tan(FOV / 2);
    const a = (((sx / vw) * 2 - 1) * (vw / vh)) / f;
    const b = (1 - (sy / vh) * 2) / f;
    const d: Vec3 = [0, 1, 2].map((i) => -c.dir[i] + a * c.r[i] + b * c.u[i]) as Vec3;
    const l = Math.hypot(d[0], d[1], d[2]);
    return { o: c.eye, d: d.map((v) => v / l) as Vec3 };
  }
  /** Where a canvas point lands: on the terrain, or on the page around it. */
  function pick(c: Cam, sx: number, sy: number, lift: number): Vec3 | null {
    const { o, d } = ray(c, sx, sy);
    if (d[2] > -1e-4) return null;
    const at = (t: number): Vec3 => [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
    const ground = (P: Vec3) => {
      const mx = P[0] - MAPX;
      const my = P[1] - MAPY;
      return mx >= 0 && my >= 0 && mx <= MW && my <= MH ? groundZ(mx, my, lift) : 0;
    };
    const tEnd = -o[2] / d[2];
    const top = topZ(lift) + 1;
    let t = o[2] > top ? (top - o[2]) / d[2] : 0;
    const step = Math.max(0.4, (tEnd - t) / 600);
    let prev = t;
    for (; t < tEnd; t += step) {
      const P = at(t);
      if (P[2] <= ground(P)) {
        let a = prev;
        let b = t;
        for (let i = 0; i < 10; i += 1) {
          const m = (a + b) / 2;
          const Q = at(m);
          if (Q[2] <= ground(Q)) b = m;
          else a = m;
        }
        return at(b);
      }
      prev = t;
    }
    return at(tEnd);
  }
  function canvasPoint(ev: { clientX: number; clientY: number }) {
    const r = canvas.getBoundingClientRect();
    return [ev.clientX - r.left, ev.clientY - r.top];
  }
  /** Where a canvas point lands on a piece, in px of the piece's own layout, however it is turned. */
  function onPiece(p: Piece, sx: number, sy: number): [number, number] | null {
    const { o, d } = ray(cam, sx, sy);
    const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const w: Vec3 = [o[0] - p.O[0], o[1] - p.O[1], o[2] - p.O[2]];
    const n = cross(p.ey, d);
    const det = dot(p.ex, n);
    if (Math.abs(det) < 1e-12) return null;
    return [dot(w, n) / det, dot(p.ex, cross(w, d)) / det];
  }

  // element px -> canvas CSS px, as a DOMMatrix, from the same camera the picture uses
  let GEOMETRY = false;
  let probed = false;
  let geoN = 0;
  function place(p: Piece) {
    const cols = [mul([p.ex[0], p.ex[1], p.ex[2], 0]), mul([p.ey[0], p.ey[1], p.ey[2], 0]), null, mul([p.O[0], p.O[1], p.O[2], 1])];
    const m = new Float64Array(16);
    for (const c of [0, 1, 3]) {
      const v = cols[c]!;
      m[c * 4] = (v[0] * 0.5 + v[3] * 0.5) * vw;
      m[c * 4 + 1] = (-v[1] * 0.5 + v[3] * 0.5) * vh;
      m[c * 4 + 3] = v[3];
    }
    m[10] = 1;
    if (GEOMETRY) {
      canvas.updateElementGeometry!(p.el, { canvasTransform: new DOMMatrix(Array.from(m)) });
      return;
    }
    // Earlier builds: a CSS transform moves where the element is hit, and leaves its picture alone.
    const lx = p.kind === 'pin' ? MAPX : p.x;
    const ly = p.kind === 'pin' ? MAPY : p.y;
    for (const c of [0, 1, 3]) {
      m[c * 4] -= lx * m[c * 4 + 3];
      m[c * 4 + 1] -= ly * m[c * 4 + 3];
    }
    const s = `matrix3d(${Array.from(m, (v) => +v.toFixed(6)).join(',')})`;
    if (p.css !== s) {
      p.css = s;
      p.el.style.transform = s;
    }
  }
  // Does updateElementGeometry() really move an element here? Try it once and look.
  function probeGeometry() {
    probed = true;
    if (typeof canvas.updateElementGeometry !== 'function' || !sheet) return;
    const el = sheet.el;
    try {
      canvas.updateElementGeometry(el, { canvasTransform: new DOMMatrix([0.01, 0, 0, 0.01, 4, 4]) });
      const c = canvas.getBoundingClientRect();
      const inside = (x: number, y: number) => {
        const h = document.elementFromPoint(c.left + x, c.top + y);
        return !!h && el.contains(h);
      };
      GEOMETRY = inside(6, 6) && !inside(Math.min(300, vw / 2), Math.min(300, vh / 2));
      if (!GEOMETRY) for (const p of pieces) canvas.updateElementGeometry(p.el, { canvasTransform: new DOMMatrix() });
    } catch {
      GEOMETRY = false;
      probed = false;
    }
  }

  // ---------------------------------------------------------------- pieces from the page
  const blank = (el: HTMLElement, kind: Kind): Piece => ({
    el,
    kind,
    tex: R.layer(),
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    z: 0,
    O: [0, 0, 0],
    ex: [1, 0, 0],
    ey: [0, 1, 0],
    stale: true,
    order: 0,
    nrm: [0, 0, 1],
    topZ: 0,
    at: { x: 0, y: 0 },
    stand: 0,
    hidden: false,
    anchor: [0, 0, 0, 0],
    rect: null,
    name: '',
    face: '',
    well: [0, 0, 0, 0],
    side: [0.85, 0.86, 0.88],
    hot: 0,
    press: 0,
    flip: 0,
    dodge: [0, 0],
  });

  function collect() {
    const els = Array.from(stage.querySelectorAll<HTMLElement>('[data-piece]'));
    const keep = new Set<Element>(els);
    for (const [el, p] of byEl) {
      if (!keep.has(el)) {
        R.deleteLayer(p.tex);
        byEl.delete(el);
      }
    }
    const get = (el: HTMLElement, kind: Kind) => {
      let p = byEl.get(el);
      if (!p || p.kind !== kind) {
        if (p) R.deleteLayer(p.tex);
        p = blank(el, kind);
        byEl.set(el, p);
      }
      return p;
    };
    const of = (name: string) => els.filter((el) => el.dataset.piece === name);
    const sheets = of('sheet').map((el) => get(el, 'sheet'));
    sheet = sheets[0] ?? null;
    const lands = of('terrain').map((el) => get(el, 'terrain'));
    land = lands[0] ?? null;
    const reliefs = of('relief').map((el) => get(el, 'relief'));
    relief = reliefs[0] ?? null;
    const details = of('detail').map((el) => get(el, 'detail'));
    detail = details[0] ?? null;
    cards = of('card').map((el, i) => {
      const p = get(el, 'card');
      p.order = i;
      return p;
    });
    contents = of('content').map((el) => {
      const p = get(el, 'content');
      const cardEl = el.parentElement?.querySelector<HTMLElement>('[data-piece="card"]');
      p.card = cardEl ? byEl.get(cardEl) : undefined;
      return p;
    });
    pins = of('pin').map((el) => {
      const p = get(el, 'pin');
      const spot = model?.ways.find((w) => w.id === el.dataset.way) ?? model?.marks.find((m) => m.id === el.dataset.mark);
      p.at = spot ? { x: spot.x, y: spot.y } : { x: 0, y: 0 };
      p.stand = 26;
      return p;
    });
    const hikers = of('hiker').map((el) => {
      const p = get(el, 'pin');
      p.stand = 9;
      return p;
    });
    hiker = hikers[0] ?? null;
    const probes = of('probe').map((el) => {
      const p = get(el, 'pin');
      p.stand = 16;
      p.hidden = !hover;
      return p;
    });
    probe = probes[0] ?? null;
    probeText = probe?.el.querySelector<HTMLElement>('[data-probe-text]') ?? null;
    const bars = of('bar').map((el) => get(el, 'bar'));
    bar = bars[0] ?? null;
    keys = of('key').map((el) => {
      const p = get(el, 'key');
      p.name = el.dataset.key ?? '';
      p.face = el.dataset.face ?? '';
      return p;
    });
    const pops = of('pop').map((el) => get(el, 'pop'));
    const rows = of('row').map((el) => {
      const p = get(el, 'row');
      p.name = el.dataset.drum ?? '';
      return p;
    });
    pieces = [...sheets, ...lands, ...reliefs, ...details, ...cards, ...contents, ...pins, ...hikers, ...probes, ...bars, ...keys, ...pops, ...rows];
    sunEl = page.querySelector<HTMLInputElement>('input[data-sun]');
    clockEl = page.querySelector<HTMLElement>('[data-clock]');
    cursorEl = page.querySelector<SVGCircleElement>('[data-cursor]');
    profileEl = page.querySelector<HTMLElement>('[data-profile]');
  }

  function offsetIn(el: HTMLElement) {
    let x = 0;
    let y = 0;
    let n: HTMLElement | null = el;
    while (n && n !== page) {
      x += n.offsetLeft;
      y += n.offsetTop;
      n = n.offsetParent as HTMLElement | null;
    }
    return [x, y];
  }
  /** Offset of an element inside another (px), minus whatever is scrolled between them. */
  function offsetWithin(el: HTMLElement, root: HTMLElement) {
    let x = 0;
    let y = 0;
    let n: HTMLElement | null = el;
    while (n && n !== root) {
      x += n.offsetLeft;
      y += n.offsetTop;
      n = n.offsetParent as HTMLElement | null;
    }
    for (let a = el.parentElement; a && a !== root; a = a.parentElement) {
      x -= a.scrollLeft;
      y -= a.scrollTop;
    }
    return [x, y];
  }
  function measure() {
    for (const p of pieces) {
      if (p.kind === 'bar' || p.kind === 'key') continue;
      if (p.kind === 'pin') {
        p.w = p.el.offsetWidth;
        p.h = p.el.offsetHeight;
        continue;
      }
      const o = offsetIn(p.el);
      p.x = o[0];
      p.y = o[1];
      p.w = p.el.offsetWidth;
      p.h = p.el.offsetHeight;
    }
  }

  function setModel(next: EngineModel) {
    const terrainChanged = !model || model.terrain !== next.terrain;
    model = next;
    PW = next.pageWidth;
    PH = next.pageHeight;
    MAPX = next.mapX;
    MAPY = next.mapY;
    MW = next.mapWidth;
    MH = next.mapHeight;
    R.setMesh(clamp(Math.round(MW / 2) + 1, 64, 640), clamp(Math.round(MH / 2) + 1, 64, 640));
    const terrain = next.terrain;
    if (terrainChanged) {
      if (terrain) {
        const g = terrain.grid;
        R.setTerrain(g.values, g.nx + 1, g.ny + 1, 1 / terrain.metersPerPixel, terrain.baseElevation, PLINTH);
      } else R.clearTerrain();
      hover = null;
      if (detailReq) {
        detailReq = null;
        callbacks.onDetail(null);
      }
    }
    collect();
    measure();
    for (const p of pieces) p.stale = true;
    measured = true;
    st.km = kmAt(sunEl ? Number(sunEl.value) : 0);
    updateSun();
    walkTo(st.km);
    need();
  }

  // ---------------------------------------------------------------- sun and the runner on the route
  function kmAt(minutes: number) {
    const ways = model?.ways ?? [];
    if (!ways.length) return 0;
    if (minutes <= ways[0].minutes) return ways[0].km;
    for (let i = 1; i < ways.length; i += 1) {
      const a = ways[i - 1];
      const b = ways[i];
      if (minutes <= b.minutes) {
        const f = b.minutes > a.minutes ? (minutes - a.minutes) / (b.minutes - a.minutes) : 1;
        return lerp(a.km, b.km, f);
      }
    }
    return ways[ways.length - 1].km;
  }
  function walkTo(km: number) {
    const route = model?.route ?? [];
    if (!hiker || route.length < 2) return;
    let i = 1;
    while (i < route.length - 1 && route[i].km < km) i += 1;
    const a = route[i - 1];
    const b = route[i];
    const f = clamp((km - a.km) / Math.max(1e-6, b.km - a.km), 0, 1);
    hiker.at = { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f) };
    if (cursorEl && model) {
      const [cx, cy] = model.profilePoint(km);
      cursorEl.setAttribute('cx', cx.toFixed(1));
      cursorEl.setAttribute('cy', cy.toFixed(1));
    }
  }
  /** The time the plan has the runner `km` along the route. */
  function minutesAt(km: number) {
    const ways = model?.ways ?? [];
    if (!ways.length) return 0;
    if (km <= ways[0].km) return ways[0].minutes;
    for (let i = 1; i < ways.length; i += 1) {
      const a = ways[i - 1];
      const b = ways[i];
      if (km <= b.km) return lerp(a.minutes, b.minutes, b.km > a.km ? (km - a.km) / (b.km - a.km) : 1);
    }
    return ways[ways.length - 1].minutes;
  }
  /** Put the runner `km` along the route, and the clock and the light at the time the plan has it there. */
  function runTo(km: number) {
    const ways = model?.ways ?? [];
    if (!sunEl || !ways.length) return;
    const at = clamp(km, ways[0].km, ways[ways.length - 1].km);
    sunEl.value = String(Math.round(minutesAt(at)));
    st.sunT = null;
    updateSun();
    st.km = st.kmT = at;
    walkTo(at);
    need();
  }
  function updateSun() {
    if (!model || !sunEl) return;
    const minutes = Number(sunEl.value);
    // a picker shows the light it would give while it is open
    light = lightAt(previewDay ?? model.date, previewMinutes ?? minutes, model.lat, model.lon);
    if (clockEl) clockEl.textContent = formatClock(previewClock ?? minutes);
    const warm = smooth((light.elevation + 2) / 14);
    const glow = light.night > 0.5 ? 'rgb(64,78,128)' : `rgb(255,${Math.round(lerp(150, 236, warm))},${Math.round(lerp(96, 180, warm))})`;
    sunEl.style.setProperty('--thumb', glow);
    st.kmT = kmAt(minutes);
    need();
  }

  const quad = (p: Piece, extra?: Partial<DrawItem>): DrawItem => ({
    tex: p.tex,
    O: p.O,
    ex: [p.ex[0] * p.w, p.ex[1] * p.w, p.ex[2] * p.w],
    ey: [p.ey[0] * p.h, p.ey[1] * p.h, p.ey[2] * p.h],
    ...extra,
  });
  /** Moves an element's hit area off the canvas, for a face that is turned away. */
  function unplace(p: Piece) {
    if (!GEOMETRY) return;
    canvas.updateElementGeometry!(p.el, { canvasTransform: new DOMMatrix([0.001, 0, 0, 0.001, -99999, -99999]) });
  }

  // ---------------------------------------------------------------- the bar: real buttons, made into keys on a slab in front of the camera
  let bar: Piece | null = null;
  let keys: Piece[] = [];
  let keyHot: string | null = null;
  let keyDown: string | null = null;
  let riseStep = -1;
  let noHud = false;
  const hex = (s: string): Vec3 | null => {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(s.trim());
    return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : null;
  };
  function measureHud() {
    if (!bar) return;
    bar.w = bar.el.offsetWidth;
    bar.h = bar.el.offsetHeight;
    for (const k of keys) {
      k.w = k.el.offsetWidth;
      k.h = k.el.offsetHeight;
      const well = bar.el.querySelector<HTMLElement>(`[data-well="${k.name}"]`);
      if (well) k.well = [well.offsetLeft, well.offsetTop, well.offsetWidth, well.offsetHeight];
      k.side = hex(getComputedStyle(k.el).getPropertyValue('--side')) ?? k.side;
    }
  }
  function hudFrame(dt: number, rise: number) {
    const items: DrawItem[] = [];
    let busy = false;
    if (!bar || noHud) return { items, busy };
    measureHud();
    if (!bar.w) return { items, busy };
    // the wells and the key faces in CSS follow the rise too, in steps so the textures are not redrawn every frame
    const step = Math.round(rise * 20) / 20;
    if (step !== riseStep) {
      riseStep = step;
      bar.el.parentElement?.style.setProperty('--rise', String(step));
      for (const p of [bar, ...keys]) p.stale = true;
      need();
    }
    // a plane where one world unit is one CSS px, kept between the near and far planes
    const Dh = vh / 2 / Math.tan(FOV / 2);
    const Dq = clamp(Dh, cam.D * 0.2, cam.D * 6);
    const s = Dq / Dh;
    const { r, u, dir, eye } = cam;
    // flat, the slab faces the camera and its keys lie flush; it leans back like a keyboard on the table as the page stands up
    const beta = 0.72 * rise;
    const cb = Math.cos(beta);
    const sb = Math.sin(beta);
    const ex = r;
    const ey = [0, 1, 2].map((i) => -u[i] * cb + dir[i] * sb) as Vec3;
    const n = [0, 1, 2].map((i) => u[i] * sb + dir[i] * cb) as Vec3;
    const bw = bar.w;
    const bh = bar.h;
    const B = [0, 1, 2].map((i) => eye[i] - dir[i] * Dq + u[i] * (vh / 2 - (vh - 18)) * s);
    const O = [0, 1, 2].map((i) => B[i] - (ex[i] * bw * 0.5 + ey[i] * bh) * s) as Vec3;
    const at = (x: number, y: number, z: number) => [0, 1, 2].map((i) => O[i] + (ex[i] * x + ey[i] * y + n[i] * z) * s) as Vec3;
    const sc = (v: Vec3, k: number) => v.map((c) => c * k * s) as Vec3;

    bar.O = O;
    bar.ex = sc(ex, 1);
    bar.ey = sc(ey, 1);
    place(bar);
    items.push(quad(bar, { glow: 0.25 }));
    const T = 10 * rise;
    const solid = rise > 0.02;
    if (solid) {
      const slabSide: Vec3 = [0.74, 0.75, 0.78];
      items.push({ solid: slabSide, useNormal: true, nrm: ey, O: at(16, bh, 0), ex: sc(ex, bw - 32), ey: sc(n, -T) });
      items.push({ solid: slabSide, useNormal: true, nrm: [-ex[0], -ex[1], -ex[2]], O: at(0, 16, 0), ex: sc(ey, bh - 32), ey: sc(n, -T) });
      items.push({ solid: slabSide, useNormal: true, nrm: ex, O: at(bw, 16, 0), ex: sc(ey, bh - 32), ey: sc(n, -T) });
      // its soft shadow on whatever is behind
      items.push({ O: at(-26, -14, -T - 2), ex: sc(ex, bw + 52), ey: sc(ey, bh + 46), shade: { w: bw + 52, h: bh + 46, blur: 18, strength: 0.22 * rise } });
    }

    const ease = 1 - Math.exp(-dt * 20);
    const turn = 1 - Math.exp(-dt * 6);
    for (const k of keys) {
      const hotT = keyHot === k.name ? 1 : 0;
      const pressT = keyDown === k.name ? 1 : k.name === 'place' && placing ? 0.62 : 0;
      const flipT = k.name === 'flip' && st.eT > 0.5 ? Math.PI : 0;
      k.hot += (hotT - k.hot) * ease;
      k.press += (pressT - k.press) * ease;
      k.flip += (flipT - k.flip) * turn;
      if (Math.abs(hotT - k.hot) + Math.abs(pressT - k.press) + Math.abs(flipT - k.flip) > 2e-3) busy = true;
      else {
        k.hot = hotT;
        k.press = pressT;
        k.flip = flipT;
      }
      const [wx, wy, ww, wh] = k.well;
      // flat, a key keeps half a px off the slab so its face does not fight the slab's
      const d = Math.max(0.5, rise * Math.max(1.8, 9 + 2 * k.hot - 6.8 * k.press));
      const th = k.flip;
      // a flipping key rises out of its well so it never cuts into the slab
      const up = (k.h / 2) * Math.abs(Math.sin(th)) + 2 * Math.sin(th / 2) ** 2;
      const C = at(wx + ww / 2, wy + wh / 2, d / 2 + up);
      const a = ex;
      const b = [0, 1, 2].map((i) => ey[i] * Math.cos(th) + n[i] * Math.sin(th)) as Vec3;
      const c = [0, 1, 2].map((i) => n[i] * Math.cos(th) - ey[i] * Math.sin(th)) as Vec3;
      const hw = (k.w / 2) * s;
      const hh = (k.h / 2) * s;
      const hd = (d / 2) * s;
      const P = (fa: number, fb: number, fc: number) => [0, 1, 2].map((i) => C[i] + a[i] * fa + b[i] * fb + c[i] * fc) as Vec3;
      const back = k.face === 'back';
      k.O = back ? P(-hw, hh, -hd) : P(-hw, -hh, hd);
      k.ex = sc(a, 1);
      k.ey = back ? sc(b, -1) : sc(b, 1);
      const facing = Math.cos(th) >= 0 ? !back : back;
      if (facing) place(k);
      else unplace(k);
      const neg = (v: Vec3) => v.map((x) => -x) as Vec3;
      const side = k.side;
      const faceEy = back ? neg(b) : b;
      const faceN = back ? neg(c) : c;
      items.push(quad(k, { glow: 1 }));
      // the sides and the shadow belong to the key, not to each face
      if (back || !solid || k.name === 'fly') continue;
      const rr = Math.min(7, k.h / 3) * s;
      items.push({ solid: side, useNormal: true, nrm: b, O: P(-hw + rr, hh, -hd), ex: a.map((v) => v * (2 * hw - 2 * rr)) as Vec3, ey: c.map((v) => v * 2 * hd) as Vec3 });
      items.push({ solid: side, useNormal: true, nrm: neg(b), O: P(-hw + rr, -hh, -hd), ex: a.map((v) => v * (2 * hw - 2 * rr)) as Vec3, ey: c.map((v) => v * 2 * hd) as Vec3 });
      items.push({ solid: side, useNormal: true, nrm: a, O: P(hw, -hh + rr, -hd), ex: b.map((v) => v * (2 * hh - 2 * rr)) as Vec3, ey: c.map((v) => v * 2 * hd) as Vec3 });
      items.push({ solid: side, useNormal: true, nrm: neg(a), O: P(-hw, -hh + rr, -hd), ex: b.map((v) => v * (2 * hh - 2 * rr)) as Vec3, ey: c.map((v) => v * 2 * hd) as Vec3 });
      const blur = 2.2 + d * 0.55 + up * 0.3;
      const m = blur * 1.2;
      const kx = wx + (ww - k.w) / 2;
      const ky = wy + (wh - k.h) / 2 + 1.2 + d * 0.15;
      items.push({
        O: at(kx - m, ky - m, 0.15),
        ex: sc(ex, k.w + 2 * m),
        ey: sc(ey, k.h + 2 * m),
        shade: { w: k.w + 2 * m, h: k.h + 2 * m, blur, strength: (0.16 + d * 0.022) * rise },
      });
    }
    return { items, busy };
  }

  // ---------------------------------------------------------------- pickers: a card that rises off the panel; time drums turn as real cylinders
  type Pop = {
    piece: Piece;
    kind: string;
    target: string;
    baseMinutes: number;
    anchor: HTMLElement | null;
    content: Piece | null;
    open: number;
    ov: number;
    openT: number;
    up: boolean;
    drums: Drum[];
    focus: number;
    typed: string;
  };
  let pop: Pop | null = null;
  let popGone = 0;
  let popGoneFor = '';
  const mod = (a: number, n: number) => ((a % n) + n) % n;
  const boundedDrumValue = (p: Pop, d: Drum, value: number) =>
    p.target !== 'start' && d.name === 'h' ? clamp(value, 0, d.n - 1) : value;
  const popValueMinutes = (p: Pop, live = false) => {
    const [h, m] = p.drums;
    if (!h || !m) return 0;
    const duration = p.target !== 'start';
    const hours = boundedDrumValue(p, h, live ? h.v : h.vT);
    const minutes = live ? m.v : m.vT;
    return (duration ? Math.max(0, hours) : mod(hours, 24)) * 60 + mod(minutes, 60);
  };
  const popAbsoluteMinutes = (p: Pop, live = false) => {
    return p.baseMinutes + popValueMinutes(p, live);
  };

  /** The app opened, changed or removed the picker: pick up its elements. */
  function refreshPop() {
    collect();
    measure();
    const el = stage.querySelector<HTMLElement>('[data-piece="pop"]');
    const piece = el ? byEl.get(el) : undefined;
    if (!el || !piece) {
      pop = null;
      previewMinutes = null;
      previewClock = null;
      previewDay = null;
      updateSun();
      need();
      return;
    }
    if (pop && pop.piece === piece) {
      for (const p of pieces) if (p.kind === 'pop' || p.kind === 'row') p.stale = true;
      need();
      return;
    }
    const anchor = document.getElementById(el.dataset.anchor ?? '');
    const contentEl = anchor?.closest<HTMLElement>('[data-piece="content"]');
    const content = contentEl ? byEl.get(contentEl) ?? null : null;
    const kind = el.dataset.kind ?? 'date';
    const drums: Drum[] = [];
    if (kind === 'time') {
      const duration = el.dataset.target !== 'start';
      const minutes = duration ? Math.max(0, Math.round(Number(el.dataset.value) || 0)) : mod(Math.round(Number(el.dataset.value) || 0), 1440);
      const spec: [string, number, number][] = [
        ['h', duration ? 1000 : 24, Math.floor(minutes / 60)],
        ['m', 60, minutes % 60],
      ];
      for (const [name, n, v] of spec) {
        const slotEl = el.querySelector<HTMLElement>(`[data-drum-slot="${name}"]`);
        const [sx, sy] = slotEl ? offsetWithin(slotEl, el) : [0, 0];
        const rows = pieces.filter((p) => p.kind === 'row' && p.name === name).sort((a, b) => Number(a.el.dataset.i) - Number(b.el.dataset.i));
        drums.push({ name, n, v, vT: v, rows, slot: [sx, sy, slotEl?.offsetWidth ?? 0, slotEl?.offsetHeight ?? 0], rowPx: 24, sx: 0 });
      }
    }
    let up = false;
    if (anchor && content) up = content.y + offsetWithin(anchor, content.el)[1] > PH * 0.52;
    pop = {
      piece,
      kind,
      target: el.dataset.target ?? '',
      baseMinutes: Number(el.dataset.base) || 0,
      anchor,
      content,
      open: 0,
      ov: 0,
      openT: 1,
      up,
      drums,
      focus: 0,
      typed: '',
    };
    need();
  }
  function closePop(commit = false) {
    if (!pop || pop.openT === 0) return;
    if (commit && pop.kind === 'time') callbacks.onTimeCommit(pop.target, popValueMinutes(pop));
    pop.openT = 0;
    popGone = performance.now();
    popGoneFor = pop.anchor?.id ?? '';
    previewMinutes = null;
    previewClock = null;
    previewDay = null;
    updateSun();
    need();
  }
  /** True while a picker for this trigger is open or has just been closed by pressing the trigger itself. */
  function popBusy(anchorId: string) {
    if (pop && pop.openT === 1 && pop.anchor?.id === anchorId) return true;
    return popGoneFor === anchorId && performance.now() - popGone < 450;
  }
  function previewDate(day: string | null) {
    previewDay = day;
    updateSun();
  }

  function popFrame(dt: number) {
    const opaque: DrawItem[] = [];
    const blend: DrawItem[] = [];
    let busy = false;
    if (!pop) return { opaque, blend, busy };
    const w = 16;
    const z = pop.openT ? 0.68 : 1;
    pop.ov += (-2 * z * w * pop.ov - w * w * (pop.open - pop.openT)) * dt;
    pop.open += pop.ov * dt;
    if (Math.abs(pop.open - pop.openT) < 2e-3 && Math.abs(pop.ov) < 2e-3) {
      pop.open = pop.openT;
      pop.ov = 0;
    } else busy = true;
    const P = pop.piece;
    const c = pop.content;
    const card = c?.card;
    if (pop.openT === 0 && pop.open <= 0.02) {
      for (const p of pieces) if (p.kind === 'pop' || p.kind === 'row') unplace(p);
      pop = null;
      callbacks.onPopClosed(P.el.dataset.seq ?? '');
      return { opaque, blend, busy: true };
    }
    if (!c || !card || !pop.anchor || !P.w) return { opaque, blend, busy };
    const open = Math.max(0, pop.open);
    const ex = card.ex;
    const ey = card.ey;
    const n = card.nrm;
    const [ax, ay] = offsetWithin(pop.anchor, c.el);
    const aw = pop.anchor.offsetWidth;
    const ah = pop.anchor.offsetHeight;
    const pw = P.w;
    const ph = P.h;
    const lean = smooth((st.e - 0.3) / 0.55);
    const left = pw <= card.w ? clamp(ax + aw / 2 - pw / 2, 6, card.w - pw - 6) : (card.w - pw) / 2;
    const top = pop.up ? ay - ph - 10 : ay + ah + 10;
    const pivX = ax + aw / 2;
    const pivY = pop.up ? ay : ay + ah;
    const s = 0.82 + 0.18 * open;
    const lift = 3 + (24 + 40 * lean) * open;
    const W = (x: number, y: number, h: number) =>
      [0, 1, 2].map((i) => c.O[i] + ex[i] * (pivX + (x - pivX) * s) + ey[i] * (pivY + (y - pivY) * s) + n[i] * h) as Vec3;
    P.O = W(left, top, lift);
    P.ex = ex.map((v) => v * s) as Vec3;
    P.ey = ey.map((v) => v * s) as Vec3;
    P.nrm = n;
    if (open > 0.3 && pop.openT) place(P);
    else unplace(P);
    const fade = clamp(open * 1.7, 0, 1);
    opaque.push(quad(P, { alpha: fade, useNormal: true, nrm: n, glow: 0.35 }));
    const blur = 3 + lift * 0.42;
    const m = blur * 1.2;
    blend.push({
      O: [0, 1, 2].map((i) => c.O[i] + ex[i] * (left - m) + ey[i] * (top - m + lift * 0.18) + n[i] * 0.5) as Vec3,
      ex: ex.map((v) => v * (pw + 2 * m)) as Vec3,
      ey: ey.map((v) => v * (ph + 2 * m)) as Vec3,
      shade: { w: pw + 2 * m, h: ph + 2 * m, blur, strength: 0.34 * fade },
    });

    const toScreen = (q: Vec3) => {
      const v = mul([q[0], q[1], q[2], 1]);
      return [((v[0] / v[3]) * 0.5 + 0.5) * vw, ((-v[1] / v[3]) * 0.5 + 0.5) * vh];
    };
    const upv = ey.map((v) => -v) as Vec3;
    const ease = 1 - Math.exp(-dt * 16);
    const opening = pop.openT === 1;
    const focus = pop.focus;
    pop.drums.forEach((d, di) => {
      if (drumDrag?.drum !== d) {
        d.v += (d.vT - d.v) * ease;
        if (Math.abs(d.vT - d.v) > 1e-3) busy = true;
        else d.v = d.vT;
      }
      const [sx, sy, sw, sh] = d.slot;
      const rowH = d.rows[0]?.h || 24;
      const R = rowH / (2 * Math.sin(DRUM_STEP / 2));
      const t0 = Math.asin(Math.min(1, sh / 2 / R));
      // the axis sits under the card so that only the front of the drum stands out of its slot
      const depth = R * Math.cos(t0);
      const C = [0, 1, 2].map((i) => P.O[i] + (ex[i] * (sx + sw / 2) + ey[i] * (sy + sh / 2) - n[i] * depth) * s) as Vec3;
      const Rc = R * Math.cos(DRUM_STEP / 2);
      const facet = (th: number) => [0, 1, 2].map((i) => C[i] + (upv[i] * Math.sin(th) + n[i] * Math.cos(th)) * Rc * s) as Vec3;
      const a = toScreen(facet(0));
      const b = toScreen(facet(DRUM_STEP));
      d.rowPx = Math.max(6, Math.hypot(b[0] - a[0], b[1] - a[1]));
      d.sx = a[0];
      const base = Math.floor(d.v);
      for (let k = base - 3; k <= base + 3; k += 1) {
        const row = d.rows[mod(k, DRUM_ROWS)];
        if (!row) continue;
        const th = (d.v - k) * DRUM_STEP;
        const label = String(mod(k, d.n)).padStart(2, '0');
        if (row.el.textContent !== label) {
          row.el.textContent = label;
          row.stale = true;
        }
        row.order = k;
        const on = Math.abs(th) < DRUM_STEP / 2;
        if (on !== row.el.hasAttribute('data-on')) {
          row.el.toggleAttribute('data-on', on);
          row.stale = true;
        }
        const F = facet(th);
        const eyF = [0, 1, 2].map((i) => ey[i] * Math.cos(th) + n[i] * Math.sin(th)) as Vec3;
        row.ex = ex.map((v) => v * s) as Vec3;
        row.ey = eyF.map((v) => v * s) as Vec3;
        row.O = [0, 1, 2].map((i) => F[i] - row.ex[i] * (row.w / 2) - row.ey[i] * (rowH / 2)) as Vec3;
        if (Math.abs(th) < t0 + 0.08 && open > 0.3 && opening) place(row);
        else unplace(row);
        if (Math.abs(th) < t0 + DRUM_STEP / 2) {
          const nr = [0, 1, 2].map((i) => upv[i] * Math.sin(th) + n[i] * Math.cos(th)) as Vec3;
          opaque.push(quad(row, { alpha: fade, useNormal: true, nrm: nr, dim: 0.5 + 0.5 * Math.cos(th) ** 1.5, glow: 0.6 }));
        }
      }
      // the drum's ends: only the part standing out of the card, or a tilted view sees the rest past its edge
      const capCol: Vec3 = di === focus ? [0.8, 0.84, 0.96] : [0.84, 0.86, 0.9];
      const rw = d.rows[0]?.w || sw;
      const half = Math.sqrt(Math.max(1, R * R - depth * depth));
      const tall = R - depth;
      for (const side of [-1, 1]) {
        const E = [0, 1, 2].map((i) => C[i] + ex[i] * side * (rw / 2) * s) as Vec3;
        opaque.push({
          solid: capCol,
          disc: [0.5, -depth / tall, R / (2 * half), R / tall],
          useNormal: true,
          nrm: ex.map((v) => v * side) as Vec3,
          O: [0, 1, 2].map((i) => E[i] + (-upv[i] * half + n[i] * depth) * s) as Vec3,
          ex: upv.map((v) => v * 2 * half * s) as Vec3,
          ey: n.map((v) => v * tall * s) as Vec3,
          alpha: fade,
        });
      }
    });
    if (pop.kind === 'time' && pop.openT) {
      const live = popAbsoluteMinutes(pop, true);
      const settle = popAbsoluteMinutes(pop);
      if (previewMinutes === null || Math.abs(previewMinutes - live) > 0.05 || previewClock !== settle) {
        previewMinutes = live;
        previewClock = settle;
        updateSun();
      }
    }
    return { opaque, blend, busy };
  }

  let drumDrag: { drum: Drum; y0: number; v0: number; lastY: number; lastT: number; vel: number; moved: number; row: Piece | null } | null = null;
  let wheelAcc = 0;
  const drumAt = (t: Element | null) => {
    const el = t?.closest?.('[data-drum]') as HTMLElement | null;
    if (!el || !pop) return null;
    const drum = pop.drums.find((d) => d.name === el.dataset.drum) ?? null;
    return drum ? { drum, row: byEl.get(el) ?? null } : null;
  };
  // a click outside the picker confirms it (a time) or closes it (a date)
  const onPopPointerDown = (ev: PointerEvent) => {
    if (!pop || !pop.openT) return;
    const t = ev.target as Element;
    if (t.closest?.('[data-pop-part]')) return;
    closePop(pop.kind === 'time');
  };
  function popKey(ev: KeyboardEvent) {
    if (!pop || !pop.openT) return false;
    if (ev.key === 'Escape') {
      closePop(false);
      return true;
    }
    if (pop.kind !== 'time') return false;
    const d = pop.drums[pop.focus];
    if (ev.key === 'Enter') closePop(true);
    else if (ev.key === 'ArrowUp') d.vT = boundedDrumValue(pop, d, Math.round(d.vT) - 1);
    else if (ev.key === 'ArrowDown') d.vT = boundedDrumValue(pop, d, Math.round(d.vT) + 1);
    else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight' || ev.key === 'Tab') setFocus(pop.focus ? 0 : 1);
    else if (/^\d$/.test(ev.key)) {
      // Type a clock time as HHMM, or an elapsed duration as HHHMM.
      const duration = pop.target !== 'start';
      pop.typed = (pop.typed + ev.key).slice(-(duration ? 5 : 4));
      const [h, m] = pop.drums;
      const nearest = (dr: Drum, value: number) =>
        duration && dr.name === 'h'
          ? value
          : Math.round(dr.vT) + ((((value - Math.round(dr.vT)) % dr.n) + dr.n + dr.n / 2) % dr.n) - dr.n / 2;
      const complete = duration ? pop.typed.length === 5 : pop.typed.length === 4;
      if (complete) {
        const split = duration ? 3 : 2;
        h.vT = boundedDrumValue(pop, h, nearest(h, Math.min(h.n - 1, Number(pop.typed.slice(0, split)))));
        m.vT = nearest(m, Math.min(59, Number(pop.typed.slice(split))));
        pop.typed = '';
      }
    } else return false;
    need();
    return true;
  }
  function setFocus(i: number) {
    if (!pop) return;
    pop.focus = i;
    for (const [k, d] of pop.drums.entries()) {
      const slot = pop.piece.el.querySelector<HTMLElement>(`[data-drum-slot="${d.name}"]`);
      slot?.toggleAttribute('data-focus', k === i);
    }
    pop.piece.stale = true;
  }

  // ---------------------------------------------------------------- one frame
  let frames = 0;
  let uploads = 0;
  let measured = false;
  let touched = false;
  let qs = 1;
  let slow = 0;
  let wasBusy = false;
  let fullW = 1;
  let fullH = 1;
  let needN = 0;

  function frame(now: number, fixed?: number) {
    if (disposed) return;
    const dt = fixed ?? Math.min(0.05, last ? (now - last) / 1000 : 0.016);
    last = now;
    // springs
    const w = st.bouncy ? 6.2 : 13;
    const zeta = st.bouncy ? 0.66 : 1;
    st.ev += (-2 * zeta * w * st.ev - w * w * (st.e - st.eT)) * dt;
    st.e += st.ev * dt;
    const ease = 1 - Math.exp(-dt * 10);
    // whole turns may only be dropped once fully raised: on the way up the camera scales the turn, so it would jump
    if (st.e >= 0.5 && st.eT >= 0.5 && Math.abs(st.yawT) > Math.PI) {
      const turns = nearestTurn(st.yawT);
      st.yaw -= turns;
      st.yawT -= turns;
    }
    st.yaw += (st.yawT - st.yaw) * ease;
    st.tilt += (st.tiltT - st.tilt) * ease;
    st.zoom *= Math.exp((Math.log(st.zoomT) - Math.log(st.zoom)) * ease);
    let panMoving = false;
    for (let i = 0; i < 3; i += 1) {
      st.pan[i] += (st.panT[i] - st.pan[i]) * (drag === 'pan' ? 1 : ease);
      if (Math.abs(st.panT[i] - st.pan[i]) > 0.02) panMoving = true;
    }
    let moving =
      Math.abs(st.e - st.eT) > 2e-4 ||
      Math.abs(st.ev) > 2e-3 ||
      Math.abs(st.yaw - st.yawT) > 1e-4 ||
      Math.abs(st.tilt - st.tiltT) > 1e-4 ||
      Math.abs(st.zoom / st.zoomT - 1) > 1e-4 ||
      panMoving;
    if (!moving) {
      st.e = st.eT;
      st.ev = 0;
      st.zoom = st.zoomT;
      st.pan = [...st.panT];
    }
    if (st.sunT != null && sunEl) {
      // the clock is wound to a waypoint's target time
      const cur = Number(sunEl.value);
      const d = st.sunT - cur;
      const step = (st.sunSlow ? Math.max(30, Math.abs(d) * 1.5) : Math.max(40, Math.abs(d) * 3.2)) * dt;
      const nv = Math.abs(d) <= step ? st.sunT : cur + Math.sign(d) * step;
      sunEl.value = String(Math.round(nv));
      if (Math.abs(d) <= step || Number(sunEl.value) === cur) {
        sunEl.value = String(Math.round(st.sunT));
        st.sunT = null;
        st.sunSlow = false;
      }
      updateSun();
      moving = true;
    }
    if (Math.abs(st.km - st.kmT) > 1e-3) {
      const d = st.kmT - st.km;
      const total = model?.route[model.route.length - 1]?.km ?? 10;
      const step = Math.max(total * 0.08, Math.abs(d) * 2.4) * dt;
      st.km = Math.abs(d) <= step ? st.kmT : st.km + Math.sign(d) * step;
      walkTo(st.km);
      moving = true;
    }

    const flyPose = advanceFlight(dt);
    if (flight || flyPose) moving = true;
    const lift = liftOf(st.e);
    const lit = 0.78 * smooth(st.e / 0.4);
    cam = flyPose ? camera(flyPose.e, flyPose.yaw, flyPose.tilt, flyPose.zoom, flyPose.pan) : camera(st.e, st.yaw, st.tilt, st.zoom, st.pan);
    const camRight = cam.r;
    const fixedPanel = flight
      ? (() => {
          const gap = 10;
          const totalH = cards.reduce((sum, card) => sum + card.h, 0) + gap * Math.max(0, cards.length - 1);
          const fit = Math.min(1, Math.max(0.45, (vh - 36 - gap * Math.max(0, cards.length - 1)) / Math.max(1, totalH)));
          const depth = Math.max(1, cam.D * 0.58);
          const unit = (2 * depth * Math.tan(FOV / 2)) / vh;
          const plane = cam.eye.map((v, i) => v - cam.dir[i] * depth) as Vec3;
          return { gap, fit, unit, plane };
        })()
      : null;
    // pins grow on screen as the view zooms in, slower than the map so they do not cover it
    const shrink = 1 / Math.pow(st.zoom, 0.5);

    // where everything is
    const EPS = 0.03;
    let order = 1;
    for (const p of pieces) {
      order += 1;
      p.ex = [1, 0, 0];
      p.ey = [0, 1, 0];
      if (p.kind === 'card') {
        if (fixedPanel) {
          const top = 18 + cards.slice(0, p.order).reduce((sum, card) => sum + card.h * fixedPanel.fit, 0) + fixedPanel.gap * p.order;
          const left = vw - 18 - p.w * fixedPanel.fit;
          const center = fixedPanel.plane.map(
            (v, i) => v + cam.r[i] * (left + (p.w * fixedPanel.fit) / 2 - vw / 2) * fixedPanel.unit + cam.u[i] * (vh / 2 - top - (p.h * fixedPanel.fit) / 2) * fixedPanel.unit,
          ) as Vec3;
          p.ex = cam.r.map((v) => v * fixedPanel.unit * fixedPanel.fit) as Vec3;
          p.ey = cam.u.map((v) => -v * fixedPanel.unit * fixedPanel.fit) as Vec3;
          p.nrm = cam.dir;
          p.O = [0, 1, 2].map((i) => center[i] - (p.ex[i] * p.w) / 2 - (p.ey[i] * p.h) / 2) as Vec3;
          p.z = 0;
          p.topZ = 0;
          continue;
        }
        // cards lean back like lecterns, each row seated above the one in front; they turn with the map
        // until they lean CARD_LEAN_MAX on screen, then hold there, and step aside rather than cover each other
        const k = smooth((st.e - 0.3) / 0.55);
        const al = 0.44 * k;
        const sa = Math.sin(al);
        const ca = Math.cos(al);
        let seat = 0;
        for (const c of cards) if (c.order > p.order) seat += c.h * sa * 0.94;
        p.z = 12 * smooth((st.e / 0.4) * 1.4 - (0.4 * p.order) / 3) + seat + EPS * (20 + order);
        p.topZ = p.z + p.h * sa;
        const home: Vec3 = [p.x + p.w / 2, p.y + p.h, p.z];
        seatCard(p, home, cardSwivel(home) * k, sa, ca);
        if (p === cards[cards.length - 1]) {
          // where they step to is worked out from their seats alone; each then turns to face the view from there
          if (dodgeCards(dt, k, sa, ca)) moving = true;
          for (const c of cards) {
            const at = [c.x + c.w / 2, c.y + c.h, c.z].map((v, i) => v + cam.r[i] * c.dodge[0] + cam.u[i] * c.dodge[1]) as Vec3;
            seatCard(c, at, cardSwivel(at) * k, sa, ca);
          }
        }
        continue;
      }
      if (p.kind === 'content') {
        if (p.el.hasAttribute('data-map-control')) {
          const x0 = clamp(p.x - MAPX, 0, MW);
          const x1 = clamp(p.x + p.w - MAPX, 0, MW);
          const y0 = clamp(p.y - MAPY, 0, MH);
          const y1 = clamp(p.y + p.h - MAPY, 0, MH);
          const xs = [x0, (x0 + x1) / 2, x1];
          const ys = [y0, (y0 + y1) / 2, y1];
          const highest = Math.max(...xs.flatMap((x) => ys.map((y) => groundZ(x, y, lift))));
          const clearance = 1.2 + 8 * lift;
          const z = highest + clearance + EPS * (20 + order);
          p.ex = [1, 0, 0];
          p.ey = [0, 1, 0];
          p.z = z;
          p.O = [p.x, p.y, z];
          continue;
        }
        const c = p.card;
        if (!c) {
          p.O = [p.x, p.y, 0.2];
          continue;
        }
        const dx = p.x - c.x;
        const dy = p.y - c.y;
        const up = EPS;
        p.ex = c.ex;
        p.ey = c.ey;
        p.z = c.z;
        p.O = [0, 1, 2].map((i) => c.O[i] + c.ex[i] * dx + c.ey[i] * dy + c.nrm[i] * up) as Vec3;
        continue;
      }
      if (p.kind === 'pin') {
        const s = smooth((st.e - 0.16) / 0.26);
        const ax = MAPX + p.at.x;
        const ay = MAPY + p.at.y;
        const gz = groundZ(p.at.x, p.at.y, lift);
        const az = gz + p.stand * s * shrink + 0.12 + EPS * (40 + order);
        const ang = (s * Math.PI) / 2;
        let rx = lerp(1, camRight[0], s);
        let ry = lerp(0, camRight[1], s);
        const rl = Math.hypot(rx, ry);
        rx /= rl;
        ry /= rl;
        const up: Vec3 = [ry * Math.cos(ang), -rx * Math.cos(ang), Math.sin(ang)];
        const k = lerp(1, shrink, s);
        p.ex = [rx * k, ry * k, 0];
        p.ey = [-up[0] * k, -up[1] * k, -up[2] * k];
        p.O = [ax - (p.ex[0] * p.w) / 2 - p.ey[0] * p.h, ay - (p.ex[1] * p.w) / 2 - p.ey[1] * p.h, az - p.ey[2] * p.h];
        p.anchor = [ax, ay, gz, az];
        continue;
      }
      p.O = [p.x, p.y, 0];
    }
    for (const p of pieces) {
      if (p.kind === 'terrain' || p.kind === 'relief' || p.kind === 'detail' || p.kind === 'bar' || p.kind === 'key' || p.kind === 'pop' || p.kind === 'row' || p.hidden) continue;
      if (p.kind === 'pin' && pinCovered(p)) unplace(p);
      else place(p);
    }
    const H = hudFrame(dt, smooth(st.e / 0.5));
    if (H.busy) moving = true;
    const PF = popFrame(dt);
    if (PF.busy) moving = true;
    // Chrome 157 keeps old hit-test answers after a geometry change; touching an element outside the canvas clears them.
    if (GEOMETRY) document.documentElement.setAttribute('data-g', String(++geoN & 1023));

    // scene
    const q = quad;
    const opaque: DrawItem[] = [];
    for (const c of cards) {
      opaque.push(q(c));
      if (lit > 0.05) {
        // a card has thickness: its lower and side edges
        const T2 = 3.2 * lit;
        const edge: Vec3 = [0.9, 0.9, 0.89];
        const dn = c.nrm.map((v) => -v * T2) as Vec3;
        const at = (fx: number, fy: number) => [0, 1, 2].map((i) => c.O[i] + c.ex[i] * fx + c.ey[i] * fy) as Vec3;
        opaque.push({ solid: edge, nrm: [c.ey[0], c.ey[1], 0.3], useNormal: true, O: at(9, c.h), ex: c.ex.map((v) => v * (c.w - 18)) as Vec3, ey: dn });
        opaque.push({ solid: edge, nrm: [-c.ex[0], -c.ex[1], 0.2], useNormal: true, O: at(0, 9), ex: c.ey.map((v) => v * (c.h - 18)) as Vec3, ey: dn });
        opaque.push({ solid: edge, nrm: [c.ex[0], c.ex[1], 0.2], useNormal: true, O: at(c.w, 9), ex: c.ey.map((v) => v * (c.h - 18)) as Vec3, ey: dn });
      }
    }
    if (sheet) opaque.push(q(sheet, { recv: true }));
    const BIG = 40000;
    opaque.push({ table: true, recv: true, O: [PW / 2 - BIG, PH / 2 - BIG, -0.6], ex: [2 * BIG, 0, 0], ey: [0, 2 * BIG, 0] });
    const standing = [...pins, ...(hiker ? [hiker] : []), ...(probe && !probe.hidden ? [probe] : [])];
    for (const p of standing) {
      const hgt = p.anchor[3] - p.anchor[2];
      if (hgt > 1) {
        const sw = 1.1 * shrink;
        opaque.push({
          solid: [0.36, 0.39, 0.45],
          unlit: true,
          O: [p.anchor[0] - camRight[0] * sw * 0.5, p.anchor[1] - camRight[1] * sw * 0.5, p.anchor[2]],
          ex: [camRight[0] * sw, camRight[1] * sw, 0],
          ey: [0, 0, hgt],
        });
      }
    }
    const blend = contents.map((c) => q(c));
    const dist = (p: Piece) => (p.anchor[0] - cam.eye[0]) ** 2 + (p.anchor[1] - cam.eye[1]) ** 2;
    for (const p of [...standing].sort((a, b) => dist(b) - dist(a))) blend.push(q(p));
    opaque.push(...PF.opaque);
    blend.push(...PF.blend);

    const lamps = new Float32Array(16);
    pins.slice(0, 4).forEach((p, i) => lamps.set([p.anchor[0], p.anchor[1], p.anchor[3] - 4, 1], i * 4));

    const busy = moving || drag !== null;
    size(busy ? qs : 1);
    const hasLand = !!model?.terrain;
    R.draw({
      night: light.night,
      lamps,
      vp: cam.vp,
      eye: cam.eye,
      sun: light.dir,
      sunCol: light.col,
      amb: light.amb,
      expo: light.expo,
      light: lit,
      map: [MAPX, MAPY, MW, MH],
      page: [0, 0, PW, PH],
      rects: cards.map((c) => ({
        r: [c.x, c.y + c.h - c.h * Math.abs(c.ey[1]), c.x + c.w, c.y + c.h] as [number, number, number, number],
        z: (c.z + (c.topZ || c.z)) / 2,
      })),
      terrain: {
        tex: land?.tex ?? null,
        relief: relief?.tex.ready ? relief.tex : null,
        // the hillshade goes as the model rises, before its own contours come in
        flat: 1 - smooth((st.e - 0.05) / 0.4),
        detail: detail?.rect && detail.tex.ready ? { tex: detail.tex, rect: detail.rect } : null,
        lift,
        contour: hasLand ? smooth((st.e - 0.25) / 0.45) : 0,
        hover: hasLand && hover && lift > 0.5 ? hover.ele : null,
      },
      opaque,
      blend,
      hud: H.items,
      hudLight: lit,
      dpr: canvas.width / Math.max(1, vw),
    });
    frames += 1;
    // if frames run long while things move, draw fewer pixels until they stop, then one sharp frame
    if (busy && wasBusy && fixed == null) {
      slow = slow * 0.85 + (dt > 0.026 ? 0.15 : 0);
      if (slow > 0.6 && qs > 0.5) {
        qs = Math.max(0.5, qs * 0.8);
        slow = 0;
      }
    }
    if (busy || wasBusy) need();
    wasBusy = busy;
    // finer tiles belong to the model only; the flat page keeps the whole-map picture
    if (st.eT < 1) dropDetail();
    else if (!busy) {
      window.clearTimeout(detailTimer);
      detailTimer = window.setTimeout(checkDetail, 180);
    }
  }

  // ---------------------------------------------------------------- a sharper map where the view is close
  let detailReq: DetailRequest | null = null;
  let detailTimer = 0;
  function dropDetail() {
    window.clearTimeout(detailTimer);
    if (!detailReq) return;
    detailReq = null;
    callbacks.onDetail(null);
  }
  function checkDetail() {
    if (disposed || !model || drag || st.eT < 1 || st.e < 0.6) return;
    const lift = liftOf(st.e);
    const toScreen = (x: number, y: number, z: number) => {
      const c = mul([x, y, z, 1]);
      return [((c[0] / c[3]) * 0.5 + 0.5) * vw, ((-c[1] / c[3]) * 0.5 + 0.5) * vh];
    };
    // screen px per map px around a point on the ground
    const density = (P: Vec3) => {
      const a = toScreen(P[0], P[1], P[2]);
      const b = toScreen(P[0] + 1, P[1], P[2]);
      const c = toScreen(P[0], P[1] + 1, P[2]);
      return Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]), Math.hypot(c[0] - a[0], c[1] - a[1]));
    };
    const center = pick(cam, vw / 2, vh / 2, lift);
    if (!center) return;
    const rc = density(center);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const N = 8;
    for (let j = 0; j <= N; j += 1) {
      for (let i = 0; i <= N; i += 1) {
        const P = pick(cam, (vw * i) / N, (vh * j) / N, lift);
        // the far part of a tilted view is fine with the whole-map picture
        if (!P || density(P) < rc * 0.45) continue;
        x0 = Math.min(x0, P[0] - MAPX);
        y0 = Math.min(y0, P[1] - MAPY);
        x1 = Math.max(x1, P[0] - MAPX);
        y1 = Math.max(y1, P[1] - MAPY);
      }
    }
    if (!Number.isFinite(x0)) return;
    const pad = 0.06 * Math.max(x1 - x0, y1 - y0) + 4;
    x0 = clamp(Math.floor(x0 - pad), 0, MW);
    y0 = clamp(Math.floor(y0 - pad), 0, MH);
    x1 = clamp(Math.ceil(x1 + pad), 0, MW);
    y1 = clamp(Math.ceil(y1 + pad), 0, MH);
    const w = x1 - x0;
    const h = y1 - y0;
    if (w < 8 || h < 8) return dropDetail();
    // the whole-map picture holds TS px per map px
    const want = Math.min(rc * TS * 1.1, detailSide() / Math.max(w, h), 12);
    if (want < TS * DETAIL_GAIN) return dropDetail();
    const cur = detailReq;
    if (cur && cur.x <= x0 && cur.y <= y0 && cur.x + cur.w >= x1 && cur.y + cur.h >= y1 && cur.density >= want * 0.8) return;
    detailReq = { x: x0, y: y0, w, h, density: +want.toFixed(3), zoom: +st.zoomT.toFixed(3) };
    callbacks.onDetail(detailReq);
  }
  /** The app drew into the map canvases: upload them again. */
  function refreshMap() {
    for (const p of [land, relief]) if (p) p.stale = true;
    need();
  }
  /** The app moved or drew into the detail picture: measure it again and upload it once it has painted. */
  function refreshDetail() {
    if (!detail) return;
    const o = offsetIn(detail.el);
    detail.x = o[0];
    detail.y = o[1];
    detail.w = detail.el.offsetWidth;
    detail.h = detail.el.offsetHeight;
    detail.stale = true;
    if (!Number(detail.el.dataset.w)) detail.rect = null;
    need();
  }

  function size(k: number) {
    const w = Math.max(1, Math.round(fullW * k));
    const h = Math.max(1, Math.round(fullH * k));
    if (canvas.width === w && canvas.height === h) return false;
    canvas.width = w;
    canvas.height = h;
    return true;
  }

  // Ask for a paint event; some builds do not send one when no element changed, so fall back to a plain frame.
  function need() {
    if (pending || disposed) return;
    pending = true;
    canvas.requestPaint();
    const mine = ++needN;
    const late = () => {
      if (pending && mine === needN) {
        pending = false;
        frame(performance.now());
      }
    };
    requestAnimationFrame(() => requestAnimationFrame(late));
    window.setTimeout(late, 90);
  }

  const TS = clamp(window.devicePixelRatio || 1, 1, 2);
  const detailSide = () => Math.min(R.maxTexture, DETAIL_MAX_SIDE * TS);
  let retries = 0;
  const onPaint = (event: Event) => {
    if (disposed) return;
    const wanted = pending;
    const before = uploads;
    pending = false;
    for (const el of (event as PaintEvent).changedElements ?? []) {
      const p = byEl.get(el);
      if (p) p.stale = true;
      else if (el === stage) {
        // this build only says "something inside changed": refresh what the last input could have touched
        const a = document.activeElement;
        const host = a?.closest?.('[drawable]');
        if (host && byEl.has(host)) byEl.get(host)!.stale = true;
        if (touched) {
          touched = false;
          for (const piece of pieces) if (piece.kind !== 'terrain' && piece.kind !== 'relief' && piece.kind !== 'detail' && piece.kind !== 'sheet') piece.stale = true;
        }
      }
    }
    if (!measured) return;
    if (!probed) probeGeometry();
    let missing = false;
    for (const p of pieces) {
      if (!p.stale || !p.w) continue;
      try {
        let k = p.kind === 'content' || p.kind === 'pin' || p.kind === 'key' || p.kind === 'pop' || p.kind === 'row' ? TS * 2 : TS;
        if (p.kind === 'terrain' || p.kind === 'relief') k = Math.min(TS * 1.5, R.maxTexture / Math.max(p.w, p.h), 4096 / Math.max(p.w, p.h));
        if (p.kind === 'detail') k = Math.min(Number(p.el.dataset.density) || 1, detailSide() / Math.max(p.w, p.h));
        R.upload(p.tex, p.el, Math.max(1, Math.round(p.w * k)), Math.max(1, Math.round(p.h * k)));
        p.stale = false;
        if (p.kind === 'detail') {
          const d = p.el.dataset;
          const [x, y, w, h] = [Number(d.x), Number(d.y), Number(d.w), Number(d.h)];
          p.rect = w > 0 && h > 0 ? [x / MW, y / MH, (x + w) / MW, (y + h) / MH] : null;
        }
        uploads += 1;
      } catch {
        missing = true;
      }
    }
    // no snapshot yet: ask for another paint, a few times at most
    retries = missing ? retries + 1 : 0;
    if (missing && retries < 20) need();
    if (!wanted && uploads === before && frames > 0) return;
    frame(performance.now());
  };
  canvas.addEventListener('paint', onPaint);
  const markTouched = () => {
    touched = true;
  };
  const touchEvents = ['input', 'change', 'click', 'pointerover', 'pointerout', 'focusin', 'focusout', 'keydown'];
  for (const t of touchEvents) stage.addEventListener(t, markTouched, true);
  // keys rise under the pointer and sink while held
  const keyOf = (t: EventTarget | null) => ((t as Element | null)?.closest?.('[data-piece="key"]') as HTMLElement | null) ?? null;
  const onKeyOver = (ev: PointerEvent) => {
    const k = keyOf(ev.target);
    if (k) {
      keyHot = k.dataset.key ?? null;
      need();
    }
  };
  const onKeyOut = (ev: PointerEvent) => {
    if (keyOf(ev.target) && !keyOf(ev.relatedTarget)) {
      keyHot = null;
      need();
    }
  };
  const onKeyDown = (ev: PointerEvent) => {
    const k = keyOf(ev.target);
    if (k) {
      keyDown = k.dataset.key ?? null;
      need();
    }
  };
  const onKeyUp = () => {
    if (keyDown) {
      keyDown = null;
      need();
    }
  };
  stage.addEventListener('pointerover', onKeyOver);
  stage.addEventListener('pointerout', onKeyOut);
  stage.addEventListener('pointerdown', onKeyDown, true);
  stage.addEventListener('pointerdown', onPopPointerDown, true);
  window.addEventListener('pointerup', onKeyUp);
  window.addEventListener('pointercancel', onKeyUp);
  // a picture inside a piece finished loading
  const onLoad = (ev: Event) => {
    const host = (ev.target as Element).closest?.('[data-piece]');
    const p = host ? byEl.get(host) : undefined;
    if (p) {
      p.stale = true;
      need();
    }
  };
  page.addEventListener('load', onLoad, true);

  const resizeObserver = new ResizeObserver((entries) => {
    const box = entries[0].devicePixelContentBoxSize?.[0] ?? null;
    vw = canvas.clientWidth;
    vh = canvas.clientHeight;
    const s = Math.min(window.devicePixelRatio || 1, 2);
    const exact =
      box && s === window.devicePixelRatio && Math.abs(box.inlineSize - vw * s) < 2 && Math.abs(box.blockSize - vh * s) < 2;
    fullW = exact ? box.inlineSize : Math.round(vw * s);
    fullH = exact ? box.blockSize : Math.round(vh * s);
    size(1);
    need();
  });
  resizeObserver.observe(canvas, { box: 'device-pixel-content-box' });

  // ---------------------------------------------------------------- input
  function apart(v: number, bouncy = false) {
    st.eT = clamp(v, 0, 1);
    st.bouncy = bouncy;
    if (st.eT < 0.5) setHover(null);
    callbacks.onApartChange(st.eT > 0.5);
    need();
  }
  /** Back to the plain view: not turned, not zoomed, not moved. */
  function home() {
    st.yawT = 0;
    st.tiltT = 0;
    st.zoomT = 1;
    st.panT = [0, 0, 0];
  }
  function together() {
    home();
    apart(0, true);
  }
  function toggle() {
    if (st.eT > 0.5) together();
    else apart(1, true);
  }
  function clampPan() {
    const b = targetCam().base;
    st.panT[0] = clamp(st.panT[0], -b[0], PW - b[0]);
    st.panT[1] = clamp(st.panT[1], -b[1], PH - b[1]);
    st.panT[2] = clamp(st.panT[2], -b[2], topZ(1) - b[2]);
  }

  function setHover(next: { x: number; y: number; ele: number } | null) {
    hover = next;
    if (!probe) return;
    probe.hidden = !next;
    if (next) {
      probe.at = { x: next.x, y: next.y };
      const text = formatMeters(next.ele);
      if (text !== probeShown && probeText) {
        probeShown = text;
        probeText.textContent = text;
        probe.w = probe.el.offsetWidth;
        probe.h = probe.el.offsetHeight;
        probe.stale = true;
      }
    }
    need();
  }
  const onTerrain = (t: Element) => t === canvas || !!t.closest?.('[data-piece="sheet"]');
  /** The pointer on the elevation profile drawing (px), wherever its card stands. */
  function profileAt(ev: { clientX: number; clientY: number }): [number, number] | null {
    const host = profileEl?.closest<HTMLElement>('[data-piece]');
    const p = host ? byEl.get(host) : undefined;
    if (!profileEl || !host || !p || p.hidden) return null;
    const [sx, sy] = canvasPoint(ev);
    const at = onPiece(p, sx, sy);
    if (!at) return null;
    const [ox, oy] = offsetWithin(profileEl, host);
    return [at[0] - ox, at[1] - oy];
  }

  let px = 0;
  let py = 0;
  let moved = 0;
  let downOnMap = false;
  let panFrom: { cam: Cam; P: Vec3; pan: Vec3 } | null = null;
  const onPointerDown = (ev: PointerEvent) => {
    const t = ev.target as Element;
    if (flight && !t.closest?.('[data-key="fly"]')) returnFromFlight();
    // the right and middle buttons move the model from anywhere but a field being typed in
    const panning = ev.button === 2 || ev.button === 1;
    if (t !== canvas && t.closest && (panning ? t.closest(EDITABLE) : t.closest(INTERACTIVE) || t.closest(SELECTABLE))) return;
    ev.preventDefault();
    if (t !== canvas && t.closest?.('[data-hud]')) return;
    const hit = panning ? null : drumAt(t);
    if (hit) {
      // turn a time drum by dragging it
      drag = 'drum';
      const now = performance.now();
      drumDrag = { drum: hit.drum, y0: ev.clientY, v0: hit.drum.v, lastY: ev.clientY, lastT: now, vel: 0, moved: 0, row: hit.row };
      canvas.setPointerCapture(ev.pointerId);
      return;
    }
    if (!panning && cursorEl && (t === canvas || t.closest?.('[data-profile]'))) {
      // the runner's dot on the elevation profile is picked up and carried along the route
      const at = profileAt(ev);
      const cx = Number(cursorEl.getAttribute('cx'));
      const cy = Number(cursorEl.getAttribute('cy'));
      if (at && Math.hypot(at[0] - cx, at[1] - cy) <= RUNNER_REACH) {
        drag = 'runner';
        setHover(null);
        canvas.setPointerCapture(ev.pointerId);
        canvas.classList.add('turning');
        return;
      }
    }
    if (t !== canvas && t.closest?.('[data-pop-part]')) return;
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) document.activeElement.blur();
    getSelection()?.removeAllRanges();
    moved = 0;
    px = ev.clientX;
    py = ev.clientY;
    downOnMap = onTerrain(t);
    drag = panning || ev.shiftKey ? 'pan' : 'turn';
    panFrom = null;
    if (drag === 'pan') {
      const [sx, sy] = canvasPoint(ev);
      const P = pick(cam, sx, sy, liftOf(st.e));
      if (P) panFrom = { cam, P, pan: [...st.pan] };
      else drag = 'turn';
    }
    setHover(null);
    canvas.setPointerCapture(ev.pointerId);
    canvas.classList.add('turning');
  };
  const onPointerMove = (ev: PointerEvent) => {
    if (!drag) {
      // in 3D the ground under the pointer reads out its height, and that contour lights up
      const t = ev.target as Element;
      if (st.eT < 0.5 || st.e < 0.6 || !model?.terrain || !onTerrain(t)) {
        if (hover) setHover(null);
        return;
      }
      const [sx, sy] = canvasPoint(ev);
      const P = pick(cam, sx, sy, liftOf(st.e));
      const mx = P ? P[0] - MAPX : -1;
      const my = P ? P[1] - MAPY : -1;
      if (!P || mx < 0 || my < 0 || mx > MW || my > MH) {
        if (hover) setHover(null);
        return;
      }
      setHover({ x: mx, y: my, ele: model.terrain.elev(mx, my) });
      return;
    }
    if (drag === 'drum' && drumDrag) {
      const d = drumDrag.drum;
      const dy = ev.clientY - drumDrag.y0;
      drumDrag.moved = Math.max(drumDrag.moved, Math.abs(dy));
      d.v = drumDrag.v0 - dy / d.rowPx;
      d.vT = boundedDrumValue(pop!, d, d.v);
      const now = performance.now();
      const dts = (now - drumDrag.lastT) / 1000;
      if (dts > 0) drumDrag.vel = drumDrag.vel * 0.6 + (0.4 * -(ev.clientY - drumDrag.lastY)) / d.rowPx / dts;
      drumDrag.lastY = ev.clientY;
      drumDrag.lastT = now;
      need();
      return;
    }
    if (drag === 'runner') {
      const at = profileAt(ev);
      if (at && model) runTo(model.profileKm(at[0]));
      return;
    }
    const dx = ev.clientX - px;
    const dy = ev.clientY - py;
    px = ev.clientX;
    py = ev.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    if (drag === 'pan' && panFrom) {
      const [sx, sy] = canvasPoint(ev);
      const { o, d } = ray(panFrom.cam, sx, sy);
      if (d[2] < -1e-4) {
        const t = (panFrom.P[2] - o[2]) / d[2];
        const Q = [o[0] + d[0] * t, o[1] + d[1] * t];
        st.panT = [panFrom.pan[0] + panFrom.P[0] - Q[0], panFrom.pan[1] + panFrom.P[1] - Q[1], panFrom.pan[2]];
        clampPan();
      }
      need();
      return;
    }
    if (moved > 4 && st.eT < 0.5) apart(1);
    st.yawT -= dx * 0.0055;
    st.tiltT = clamp(st.tiltT - dy * 0.0045, -HERO.tilt + 0.12, 1.32 - HERO.tilt);
    need();
  };
  const onPointerUp = (ev: PointerEvent) => {
    if (!drag) return;
    const was = drag;
    drag = null;
    panFrom = null;
    if (was === 'drum' && drumDrag) {
      const d = drumDrag.drum;
      // a click picks the row; a flick keeps it turning a little
      if (drumDrag.moved < 4 && drumDrag.row) d.vT = boundedDrumValue(pop!, d, drumDrag.row.order);
      else d.vT = boundedDrumValue(pop!, d, Math.round(d.v + clamp(drumDrag.vel, -40, 40) * 0.12));
      if (pop) setFocus(pop.drums.indexOf(d));
      drumDrag = null;
      need();
      return;
    }
    canvas.classList.remove('turning');
    if (was === 'turn' && moved < 5 && placing && downOnMap && model) {
      // the route as it is drawn on screen, lying on the ground
      const [sx, sy] = canvasPoint(ev);
      const lift = liftOf(st.e);
      const line: { x: number; y: number; km: number }[] = [];
      for (const r of model.route) {
        const s = toScreen([MAPX + r.x, MAPY + r.y, groundZ(r.x, r.y, lift)]);
        if (s) line.push({ x: s[0], y: s[1], km: r.km });
      }
      const near = nearestAlong(line, sx, sy);
      callbacks.onRouteClick(near && near.dist <= ROUTE_REACH ? near.km : null);
    }
    need();
  };
  // the right button moves the model, so the browser's menu stays shut except over a field being typed in
  const onContextMenu = (ev: Event) => {
    const t = ev.target as Element;
    if (t !== canvas && t.closest?.(EDITABLE)) return;
    ev.preventDefault();
  };
  // The wheel raises the flat page into the model as far as it is turned, and a page left part way up
  // stays there; risen, it zooms toward the point under the pointer; zoomed all the way out, it lowers
  // the model back to the page.
  const WHEEL_GAP = 200;
  let wheelAt = 0;
  let wheelPhase: 'rise' | 'zoom' | null = null;
  const onWheel = (ev: WheelEvent) => {
    const t = ev.target as Element;
    if (flight) returnFromFlight();
    const hit = drumAt(t);
    if (hit || t.closest?.('[data-pop-part]')) {
      ev.preventDefault();
      if (!pop || !pop.drums.length) return;
      // the rows turn under the pointer, so off a row the nearest drum across the screen takes the wheel
      const drum = hit?.drum ?? pop.drums.reduce((a, b) => (Math.abs(b.sx - ev.clientX) < Math.abs(a.sx - ev.clientX) ? b : a));
      wheelAcc += ev.deltaMode === 1 ? ev.deltaY * 30 : ev.deltaY;
      const steps = Math.trunc(wheelAcc / 40);
      if (steps) {
        wheelAcc -= steps * 40;
        drum.vT = boundedDrumValue(pop, drum, Math.round(drum.vT) + steps);
        setFocus(pop.drums.indexOf(drum));
        need();
      }
      return;
    }
    if (t.closest?.('[data-scroll]')) {
      const list = t.closest('[data-scroll]') as HTMLElement;
      if (list.scrollHeight > list.clientHeight + 1) return;
    }
    ev.preventDefault();
    const dy = ev.deltaMode === 1 ? ev.deltaY * 30 : ev.deltaY;
    if (!dy) return;
    const now = performance.now();
    if (now - wheelAt > WHEEL_GAP) wheelPhase = null;
    wheelAt = now;
    const rate = ev.ctrlKey ? 0.012 : 0.0022;
    const atMin = st.zoomT <= ZOOM_MIN + 1e-6;
    const phase = dy < 0 ? (st.eT < 1 ? 'rise' : 'zoom') : !atMin ? 'zoom' : st.eT > 0 ? 'rise' : null;
    if (!phase) return;
    // one gesture does one thing, so a spin that raises the page does not run on into a zoom,
    // and a zoom out does not run on into lowering the model
    if (wheelPhase && wheelPhase !== phase) return;
    wheelPhase = phase;
    if (phase === 'rise') {
      apart(st.eT - dy * rate * 0.5);
      if (st.eT === 0) home();
      return;
    }
    const z0 = st.zoomT;
    const z1 = clamp(z0 * Math.exp(-dy * rate), ZOOM_MIN, ZOOM_MAX);
    if (Math.abs(z1 - z0) < 1e-6) return;
    const tc = targetCam();
    const [sx, sy] = canvasPoint(ev);
    const P = pick(tc, sx, sy, liftOf(st.eT));
    if (P) {
      const f = 1 - z0 / z1;
      const T = [tc.base[0] + st.panT[0], tc.base[1] + st.panT[1], tc.base[2] + st.panT[2]];
      st.panT = [0, 1, 2].map((i) => st.panT[i] + (P[i] - T[i]) * f) as Vec3;
    }
    st.zoomT = z1;
    if (P) {
      // the camera stands up as it closes in, which moves the point off the pointer: put it back
      for (let it = 0; it < 3; it += 1) {
        const { o, d } = ray(targetCam(), sx, sy);
        if (Math.abs(d[2]) < 1e-6) break;
        const t = (P[2] - o[2]) / d[2];
        st.panT[0] += P[0] - (o[0] + d[0] * t);
        st.panT[1] += P[1] - (o[1] + d[1] * t);
      }
    }
    if (z1 <= ZOOM_MIN + 1e-6) st.panT = [0, 0, 0];
    clampPan();
    setHover(null);
    need();
  };
  const onKey = (ev: KeyboardEvent) => {
    if (flight) returnFromFlight();
    if (popKey(ev)) {
      ev.preventDefault();
      return;
    }
    if (ev.key === 'Escape') {
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
      if (ev.target instanceof HTMLElement && ev.target.matches(EDITABLE)) return;
      together();
    }
  };
  canvas.addEventListener('pointerdown', onPointerDown, true);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  window.addEventListener('contextmenu', onContextMenu, true);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKey);

  // the browser's slider drives the light directly
  const onInput = (ev: Event) => {
    if ((ev.target as Element).matches?.('input[data-sun]')) {
      st.sunT = null;
      updateSun();
    }
  };
  page.addEventListener('input', onInput);

  // waypoint rows and map pins light each other up
  function hotWay(id: string | null) {
    for (const el of page.querySelectorAll<HTMLElement>('[data-way]')) {
      if (el.dataset.way === id) el.setAttribute('data-hot', '');
      else el.removeAttribute('data-hot');
    }
  }
  const onOver = (ev: PointerEvent) => {
    const way = (ev.target as Element).closest?.('[data-way]') as HTMLElement | null;
    if (way) hotWay(way.dataset.way ?? null);
    if (way || (ev.target as Element).closest?.('[data-piece="card"],[data-piece="content"]')) {
      if (hover) setHover(null);
    }
    need();
  };
  const onOut = (ev: PointerEvent) => {
    const to = ev.relatedTarget as Element | null;
    if (!to?.closest?.('[data-way]')) hotWay(activeWay);
    need();
  };
  page.addEventListener('pointerover', onOver);
  page.addEventListener('pointerout', onOut);
  const onLeave = () => {
    if (hover) setHover(null);
  };
  canvas.addEventListener('pointerleave', onLeave);

  function focusWay(id: string) {
    const way = model?.ways.find((w) => w.id === id);
    if (!way) return;
    activeWay = id;
    hotWay(id);
    if (st.eT >= 0.5) {
      st.sunSlow = false;
      st.sunT = way.minutes;
    }
    need();
  }

  function setPlacing(on: boolean) {
    placing = on;
    canvas.classList.toggle('placing', on);
  }

  // the picture without the bar
  function capture() {
    noHud = true;
    frame(performance.now(), 0);
    noHud = false;
    const done = new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    need();
    return done;
  }

  // for checks: jump to a pose and report what happened
  const debug = {
    st,
    pose(o: Partial<typeof st>) {
      Object.assign(st, o);
      if (o.e !== undefined) {
        st.eT = o.e;
        st.ev = 0;
      }
      if (o.yaw !== undefined) st.yawT = o.yaw;
      if (o.tilt !== undefined) st.tiltT = o.tilt;
      if (o.zoom !== undefined) st.zoomT = o.zoom;
      if (o.pan !== undefined) st.panT = [...o.pan];
      need();
    },
    mode: () => ({
      geometry: GEOMETRY,
      probed,
      pieces: pieces.length,
      frames,
      uploads,
      hover,
      lattice: model?.terrain ? [model.terrain.grid.nx, model.terrain.grid.ny] : null,
      detail: detailReq,
      detailRect: detail?.rect?.map((v) => +v.toFixed(3)) ?? null,
      maps: { flat: land ? [land.tex.w, land.tex.h] : null, relief: relief ? [relief.tex.w, relief.tex.h] : null },
      dodge: cards.map((c) => c.dodge.map((v) => +v.toFixed(1))),
      e: +st.e.toFixed(3),
      zoom: +st.zoom.toFixed(3),
      pan: st.pan.map((v) => +v.toFixed(1)),
      stale: pieces.filter((p) => p.stale).map((p) => p.kind),
      pop: pop && {
        kind: pop.kind,
        open: +pop.open.toFixed(3),
        openT: pop.openT,
        up: pop.up,
        focus: pop.focus,
        drums: pop.drums.map((d) => [+d.v.toFixed(3), d.vT]),
      },
      preview: { minutes: previewMinutes, day: previewDay, sunElevation: +light.elevation.toFixed(2) },
    }),
    /** where a map point (map px, on the ground) shows on the canvas */
    mapToScreen(mx: number, my: number) {
      const c = mul([MAPX + mx, MAPY + my, groundZ(mx, my, liftOf(st.e)), 1]);
      return [((c[0] / c[3]) * 0.5 + 0.5) * vw, ((-c[1] / c[3]) * 0.5 + 0.5) * vh];
    },
    screen(el: Element, fx: number, fy: number) {
      const host = el.closest('[data-piece]');
      const p = host ? byEl.get(host) : undefined;
      if (!p) return null;
      let x = (el as HTMLElement).offsetWidth * fx;
      let y = (el as HTMLElement).offsetHeight * fy;
      let n: HTMLElement | null = el as HTMLElement;
      while (n && n !== host) {
        x += n.offsetLeft;
        y += n.offsetTop;
        n = n.offsetParent as HTMLElement | null;
      }
      const W = [p.O[0] + p.ex[0] * x + p.ey[0] * y, p.O[1] + p.ex[1] * x + p.ey[1] * y, p.O[2] + p.ex[2] * x + p.ey[2] * y, 1];
      const c = mul(W);
      return [((c[0] / c[3]) * 0.5 + 0.5) * vw, ((-c[1] / c[3]) * 0.5 + 0.5) * vh];
    },
  };
  (window as unknown as { __gpxTopo?: typeof debug }).__gpxTopo = debug;

  function dispose() {
    disposed = true;
    window.clearTimeout(detailTimer);
    canvas.removeEventListener('paint', onPaint);
    for (const t of touchEvents) stage.removeEventListener(t, markTouched, true);
    stage.removeEventListener('pointerover', onKeyOver);
    stage.removeEventListener('pointerout', onKeyOut);
    stage.removeEventListener('pointerdown', onKeyDown, true);
    stage.removeEventListener('pointerdown', onPopPointerDown, true);
    window.removeEventListener('pointerup', onKeyUp);
    window.removeEventListener('pointercancel', onKeyUp);
    page.removeEventListener('load', onLoad, true);
    canvas.removeEventListener('pointerdown', onPointerDown, true);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
    window.removeEventListener('contextmenu', onContextMenu, true);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('pointerleave', onLeave);
    window.removeEventListener('keydown', onKey);
    page.removeEventListener('input', onInput);
    page.removeEventListener('pointerover', onOver);
    page.removeEventListener('pointerout', onOut);
    resizeObserver.disconnect();
    for (const p of pieces) {
      try {
        canvas.updateElementGeometry?.(p.el, { canvasTransform: new DOMMatrix() });
      } catch {
        // gone with the canvas
      }
      R.deleteLayer(p.tex);
    }
    byEl.clear();
    R.dispose();
  }

  return {
    setModel,
    refreshMap,
    refreshDetail,
    refreshPop,
    closePop,
    popBusy,
    previewDate,
    apart,
    together,
    toggle,
    flyover,
    focusWay,
    setPlacing,
    capture,
    dispose,
    need,
  };
}
