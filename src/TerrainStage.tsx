import { useEffect, useRef, useState, type ReactNode } from 'react';

import { loadSceneElevation, type ElevationGrid } from './dem';
import type { HtmlInCanvasContext, HtmlInCanvasElement } from './htmlInCanvas';
import SceneMap from './SceneMap';
import { buildTerrainMesh, RIM, TERRAIN_STRIDE, type TerrainMesh } from './sceneTerrain';
import type { SiteScene } from './siteScene';

/** The map under the page is cut from this many tile pixels top to bottom, whatever the window's shape. */
const MAP_HEIGHT = 800;
/** Lattice rows of the elevations; columns follow the window's aspect. About 80 m between points at this scale. */
const GRID_ROWS = 160;
const GRID_COLUMNS_MAX = 420;
const MIN_ASPECT = 0.3;
const MAX_ASPECT = 3.5;
/** How far the model is tipped back from flat, in radians. It stands up when the page is scrolled, and lies down at the top. */
const RAISED_ANGLE = 0.8;
/** A quick flip, like a page turning over. */
const RAISE_DURATION_MS = 520;
/** The raised model is also turned a little about its vertical axis, which sits better than square-on. */
const RAISED_YAW = 0.14;
/** How much smaller the tipped-back model is drawn: only a little, so it runs a touch past the window's edges and looks as large as it can. */
const RAISED_SHRINK = 0.08;
const RAISED_SHIFT = 0.0;
const DIST = 4.2;

const VERTEX_SHADER = `#version 300 es
in vec3 aPosition;
in vec2 aSlope;
in vec2 aUv;
in float aKind;
uniform float uAngle;
uniform float uYaw;
uniform float uMeshHalf;
uniform float uRelief;
uniform float uFit;
uniform float uShift;
uniform float uUnitsPerMeter;
uniform float uBaseElevation;
out vec2 vUv;
out vec3 vNormal;
out float vElevation;
out float vKind;
out float vFar;

void main() {
  const float DIST = ${DIST.toFixed(1)};
  // the base plane lies flat; height grows with the relief, the base wall below it does not
  float h = aPosition.z < 0.0 ? aPosition.z : aPosition.z * uRelief;
  float cy = cos(uYaw);
  float sy = sin(uYaw);
  vec2 p = vec2(aPosition.x * cy - aPosition.y * sy, aPosition.x * sy + aPosition.y * cy);
  float ca = cos(uAngle);
  float sa = sin(uAngle);
  float screenY = p.y * ca + h * sa;
  float depth = p.y * sa - h * ca;
  float w = DIST + depth;
  // clip space: the GPU divides by w, which keeps the page perspective-correct. Flat, this exactly fills the window.
  gl_Position = vec4(p.x * DIST / uMeshHalf * uFit, screenY * DIST * uFit + uShift * w, clamp(depth / 4.0, -1.0, 1.0) * w, w);
  vec3 n = aKind > 0.5 ? normalize(vec3(aSlope, 0.0)) : normalize(vec3(-aSlope * uRelief, 1.0));
  vNormal = vec3(n.x * cy - n.y * sy, n.x * sy + n.y * cy, n.z);
  vUv = aUv;
  vElevation = aPosition.z / uUnitsPerMeter + uBaseElevation;
  vKind = aKind;
  vFar = clamp((p.y + 1.0) * 0.5, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D uTexture;
uniform sampler2D uPage;
uniform float uAngle;
uniform float uRelief;
in vec2 vUv;
in vec3 vNormal;
in float vElevation;
in float vKind;
in float vFar;
out vec4 color;

float contour(float elevation, float every, float width) {
  float c = elevation / every;
  float fw = max(fwidth(c), 1e-4);
  return 1.0 - smoothstep(0.0, fw * width, abs(fract(c - 0.5) - 0.5));
}

void main() {
  const vec3 PAPER = vec3(0.925, 0.91, 0.863);
  const vec3 INK = vec3(0.114, 0.106, 0.09);
  vec3 n = normalize(vNormal);
  vec3 light = normalize(vec3(-0.5, 0.55, 0.62));
  // shade relative to flat ground, with the darkest slopes held back so they do not swallow the page
  float shade = max(clamp(dot(n, light), 0.0, 1.0) - light.z, -0.3);
  vec3 rgb;
  if (vKind > 0.5) {
    // the cut face of the model: bands every 200 m
    float band = step(0.5, fract(vElevation / 200.0));
    rgb = mix(vec3(0.80, 0.76, 0.67), vec3(0.67, 0.62, 0.53), band) * (0.78 + 0.3 * clamp(dot(n, light) + 0.4, 0.0, 1.0));
  } else {
    vec3 map = texture(uTexture, vUv).rgb;
    rgb = map * (1.0 + shade * 0.5);
    float fine = contour(vElevation, 100.0, 1.1);
    float index = contour(vElevation, 500.0, 1.5);
    rgb = mix(rgb, INK * 1.6, (fine * 0.08 + index * 0.16) * uRelief);
    // the page is printed on the surface: it takes the light too, a little less so it stays crisp
    vec4 page = texture(uPage, vUv);
    rgb = rgb * (1.0 - page.a) + page.rgb * (1.0 + shade * 0.3);
  }
  float fog = vFar * sin(uAngle) * 0.4;
  color = vec4(mix(rgb, PAPER, fog), 1.0);
}`;

function compileShader(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Could not create the terrain shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? 'Could not compile the terrain shader.');
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext) {
  const program = gl.createProgram();
  if (!program) throw new Error('Could not create the terrain program.');
  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? 'Could not link the terrain program.');
  }
  return program;
}

/** Before the elevations arrive the model is a flat sheet. */
function flatGrid(): ElevationGrid {
  return { nx: 1, ny: 1, values: new Float32Array(4), source: 'gsi-dem' };
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** Distance from the top of `root`'s scrolled content to `el`. */
function offsetWithin(el: HTMLElement, root: HTMLElement) {
  let top = 0;
  let node: HTMLElement | null = el;
  while (node && node !== root) {
    top += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return top;
}

export type TerrainStageProps = {
  scene: SiteScene;
  /** attributes for the page element (it is the window's whole page, drawn onto the terrain) */
  pageAttributes?: Record<string, string>;
  /** called when the terrain cannot start, so the caller can show an ordinary page instead */
  onUnavailable: () => void;
  children: ReactNode;
};

/**
 * The window's whole page, drawn onto a terrain model. Opened, it looks like an ordinary page lying flat on
 * the GSI blank map. Once scrolled, the model rises and tips back, and the page scrolls inside it (back at the top, it
 * lies flat again): links, text selection and the keyboard all still work, because the browser is told where the
 * page now is.
 */
export default function TerrainStage({ scene, pageAttributes, onUnavailable, children }: TerrainStageProps) {
  const canvasRef = useRef<HtmlInCanvasElement | null>(null);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef<HTMLElement | null>(null);
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const aspect = clamp(size.w / Math.max(1, size.h), MIN_ASPECT, MAX_ASPECT);
  const mapWidth = Math.round(MAP_HEIGHT * aspect);

  useEffect(() => {
    const canvas = canvasRef.current;
    const map = mapRef.current;
    const page = pageRef.current;
    if (!canvas || !map || !page) return;
    canvas.setAttribute('content', 'drawable');
    canvas.setAttribute('layoutsubtree', '');
    let frame = 0;
    let cleanup = () => {};
    try {
      const gl = canvas.getContext('webgl2', { antialias: true, depth: true }) as HtmlInCanvasContext | null;
      if (!gl || typeof gl.texElementSubImage2D !== 'function') throw new Error('HTML-in-Canvas is unavailable.');
      const program = createProgram(gl);
      const attribute = (name: string) => gl.getAttribLocation(program, name);
      const uniform = (name: string) => gl.getUniformLocation(program, name);
      const locations = {
        position: attribute('aPosition'),
        slope: attribute('aSlope'),
        uv: attribute('aUv'),
        kind: attribute('aKind'),
        angle: uniform('uAngle'),
        yaw: uniform('uYaw'),
        meshHalf: uniform('uMeshHalf'),
        relief: uniform('uRelief'),
        fit: uniform('uFit'),
        shift: uniform('uShift'),
        unitsPerMeter: uniform('uUnitsPerMeter'),
        base: uniform('uBaseElevation'),
        mapSampler: uniform('uTexture'),
        pageSampler: uniform('uPage'),
      };
      const mapTexture = gl.createTexture();
      const pageTexture = gl.createTexture();
      const vao = gl.createVertexArray();
      const vertexBuffer = gl.createBuffer();
      const indexBuffer = gl.createBuffer();
      if (!mapTexture || !pageTexture || !vao || !vertexBuffer || !indexBuffer || Object.values(locations).some((value) => value === null || value === -1)) {
        throw new Error('Terrain WebGL resources are unavailable.');
      }

      const stride = TERRAIN_STRIDE * 4;
      const layout: [number, number, number][] = [
        [locations.position, 3, 0],
        [locations.slope, 2, 3],
        [locations.uv, 2, 5],
        [locations.kind, 1, 7],
      ];
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      for (const [location, count, offset] of layout) {
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, count, gl.FLOAT, false, stride, offset * 4);
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bindVertexArray(null);

      let mesh: TerrainMesh | null = null;
      // half the model's width in scene units: the page always spans the model edge to edge
      let meshHalf = 1.6;
      let heightField: ElevationGrid | null = null;
      let indexCount = 0;
      const upload = (next: TerrainMesh, half: number, grid: ElevationGrid) => {
        mesh = next;
        meshHalf = half;
        heightField = grid;
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, next.vertices, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, next.indices, gl.STATIC_DRAW);
        gl.bindVertexArray(null);
        indexCount = next.indices.length;
      };

      const anisotropy = gl.getExtension('EXT_texture_filter_anisotropic');
      const prepare = (texture: WebGLTexture) => {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        if (anisotropy) {
          const max = gl.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number;
          gl.texParameterf(gl.TEXTURE_2D, anisotropy.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, max));
        }
      };
      prepare(mapTexture);
      prepare(pageTexture);
      const allocated = new Map<WebGLTexture, string>();
      const allocate = (texture: WebGLTexture, width: number, height: number) => {
        const key = `${width}x${height}`;
        if (allocated.get(texture) === key) return;
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        allocated.set(texture, key);
      };

      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      // The model lies flat until the visitor first tries to scroll; it then rises once the elevations are in.
      // flat -> rising -> raised -> lowering -> flat. The page only scrolls while raised, and a change
      // of state finishes before anything else happens, so the model is never scrolled while it moves.
      let mode: 'flat' | 'rising' | 'raised' | 'lowering' = 'flat';
      let progress = 0;
      let terrainReadyAt: number | null = null;
      let eased = 0;
      let renderedEased = -1;
      let inertia = 0;
      let scrollTarget: number | null = null;
      let dirty = true;
      let last = performance.now();
      let disposed = false;
      let pending = false;
      let failures = 0;
      let uploaded = false;
      // The pictures of the map and of the page are only taken again when what they show has changed, not on
      // every frame of the model standing up or lying down (an upload and its mipmaps are the costly part).
      let mapStale = true;
      let pageStale = true;
      const markStale = () => {
        mapStale = true;
        pageStale = true;
      };
      let lastGeometry = '';
      // how high above the base the page is taken to lie, for the browser's hit-testing (follows the pointer)
      let planeHeight: number | null = null;
      let loadedKey = '';
      let loadTimer = 0;
      let controller: AbortController | null = null;

      const planeHalfWidth = () => canvas.clientWidth / Math.max(1, canvas.clientHeight);
      const angle = () => RAISED_ANGLE * eased;
      const yaw = () => RAISED_YAW * eased;
      const fit = () => 1 - RAISED_SHRINK * eased;
      const shift = () => RAISED_SHIFT * eased;

      // The terrain (elevations and mesh) is made for the window's shape, and again if the shape changes.
      const ensureTerrain = () => {
        const half = clamp(planeHalfWidth(), MIN_ASPECT, MAX_ASPECT);
        const key = String(Math.round(half * 20));
        if (key === loadedKey) return;
        loadedKey = key;
        controller?.abort();
        const current = new AbortController();
        controller = current;
        const columns = Math.min(GRID_COLUMNS_MAX, Math.max(24, Math.round(GRID_ROWS * half)));
        const width = Math.round(MAP_HEIGHT * half);
        if (!mesh) {
          const flat = flatGrid();
          upload(buildTerrainMesh(flat, scene, width, half), half, flat);
        }
        loadSceneElevation(scene, width, MAP_HEIGHT, columns, GRID_ROWS, current.signal)
          .then((grid) => {
            if (disposed || current.signal.aborted) return;
            upload(buildTerrainMesh(grid, scene, width, half), half, grid);
            terrainReadyAt ??= performance.now();
            dirty = true;
          })
          .catch(() => {
            if (!disposed && !current.signal.aborted && terrainReadyAt === null) onUnavailable();
          });
      };

      const resize = () => {
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const width = Math.max(1, Math.round(rect.width * dpr));
        const height = Math.max(1, Math.round(rect.height * dpr));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        gl.viewport(0, 0, canvas.width, canvas.height);
      };

      // Tell the browser where the page now is, so it can hit-test links and select text. The page is flat and
      // the ground under it is not, so it is placed on a plane through the middle of the relief.
      const placePage = () => {
        if (typeof canvas.updateElementGeometry !== 'function') return;
        const vw = Math.max(1, canvas.clientWidth);
        const vh = Math.max(1, canvas.clientHeight);
        const pw = Math.max(1, page.offsetWidth);
        const ph = Math.max(1, page.offsetHeight);
        const half = meshHalf;
        const h = planeHeight ?? (mesh?.reliefHeight ?? 0) * 0.15 * eased;
        const sa = Math.sin(angle());
        const ca = Math.cos(angle());
        const cyaw = Math.cos(yaw());
        const syaw = Math.sin(yaw());
        const clip = (x: number, y: number) => {
          const mx = (x / pw) * 2 * half - half;
          const my = 1 - (y / ph) * 2;
          const px = mx * cyaw - my * syaw;
          const py = mx * syaw + my * cyaw;
          const w = DIST + py * sa - h * ca;
          return [((px * DIST) / half) * fit(), (py * ca + h * sa) * DIST * fit() + shift() * w, w] as const;
        };
        const origin = clip(0, 0);
        const east = clip(pw, 0);
        const south = clip(0, ph);
        const columns: (readonly number[] | null)[] = [
          east.map((value, k) => (value - origin[k]) / pw),
          south.map((value, k) => (value - origin[k]) / ph),
          null,
          origin,
        ];
        const m = new Float64Array(16);
        for (const c of [0, 1, 3]) {
          const [x, y, w] = columns[c]!;
          m[c * 4] = (x * 0.5 + w * 0.5) * vw;
          m[c * 4 + 1] = (-y * 0.5 + w * 0.5) * vh;
          m[c * 4 + 3] = w;
        }
        m[10] = 1;
        const key = Array.from(m, (value) => value.toFixed(4)).join(',');
        if (key === lastGeometry) return;
        lastGeometry = key;
        canvas.updateElementGeometry(page, { canvasTransform: new DOMMatrix(Array.from(m)) });
      };

      // The ground is not flat, so a pointer is matched to the page at the height of the ground under it:
      // find where the pointer's line of sight meets the plane at a guessed height, read the ground there, repeat.
      const groundHeight = (u: number, v: number) => {
        if (!heightField || !mesh || u < 0 || u > 1 || v < 0 || v > 1) return 0;
        const { nx, ny, values } = heightField;
        const x = u * nx;
        const y = v * ny;
        const i = Math.min(nx - 1, Math.floor(x));
        const j = Math.min(ny - 1, Math.floor(y));
        const fx = x - i;
        const fy = y - j;
        const at = (a: number, b: number) => values[b * (nx + 1) + a];
        const elevation = at(i, j) * (1 - fx) * (1 - fy) + at(i + 1, j) * fx * (1 - fy) + at(i, j + 1) * (1 - fx) * fy + at(i + 1, j + 1) * fx * fy;
        const edge = Math.min(v, 1 - v) / RIM;
        const rim = Math.min(1, edge);
        return (elevation - mesh.minElevation) * mesh.unitsPerMeter * eased * rim * rim * (3 - 2 * rim);
      };
      const aimPage = (clientX: number, clientY: number) => {
        if (eased === 0 || !mesh) return;
        const rect = canvas.getBoundingClientRect();
        const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
        const ndcY = 1 - ((clientY - rect.top) / rect.height) * 2;
        const sa = Math.sin(angle());
        const ca = Math.cos(angle());
        const f = DIST * fit();
        // where the line of sight meets the plane at height h, as a point of the map (0..1 each way)
        const landing = (h: number) => {
          const py = (h * sa * f - ndcY * (DIST - h * ca)) / (ndcY * sa - ca * f);
          const w = DIST + py * sa - h * ca;
          const px = (ndcX * w * meshHalf) / f;
          // back from the turned frame to the map's own
          const cyaw = Math.cos(yaw());
          const syaw = Math.sin(yaw());
          const mx = px * cyaw + py * syaw;
          const my = -px * syaw + py * cyaw;
          return [(mx + meshHalf) / (2 * meshHalf), (1 - my) / 2] as const;
        };
        // walk down the line of sight from above the highest ridge until it goes under the ground, then narrow in
        const top = mesh.reliefHeight * eased + 0.02;
        const steps = 40;
        let high = top;
        let found: number | null = null;
        for (let k = 0; k <= steps; k += 1) {
          const h = top * (1 - k / steps);
          const [u, v] = landing(h);
          if (groundHeight(u, v) >= h) {
            let low = h;
            for (let n = 0; n < 12; n += 1) {
              const mid = (low + high) / 2;
              const [mu, mv] = landing(mid);
              if (groundHeight(mu, mv) >= mid) low = mid;
              else high = mid;
            }
            found = low;
            break;
          }
          high = h;
        }
        const h = found ?? 0;
        if (planeHeight === null || Math.abs(h - planeHeight) > 0.003) {
          planeHeight = h;
          placePage();
        }
      };
      const onPointerMove = (event: PointerEvent) => {
        if (event.pointerType === 'mouse') aimPage(event.clientX, event.clientY);
      };

      // The pictures of the elements only exist after the browser has painted them, so they are read in the paint event.
      const render = () => {
        pending = false;
        if (disposed) return;
        try {
          resize();
          const scale = Math.min(2, window.devicePixelRatio || 1);
          const mw = Math.max(1, map.offsetWidth);
          const mh = Math.max(1, map.offsetHeight);
          const pw = Math.max(1, Math.round(page.offsetWidth * scale));
          const ph = Math.max(1, Math.round(page.offsetHeight * scale));
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          if (mapStale || allocated.get(mapTexture) !== `${mw}x${mh}`) {
            allocate(mapTexture, mw, mh);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, mapTexture);
            gl.texElementSubImage2D(gl.TEXTURE_2D, 0, 0, 0, map, { width: mw, height: mh });
            gl.generateMipmap(gl.TEXTURE_2D);
            mapStale = false;
          }
          if (pageStale || allocated.get(pageTexture) !== `${pw}x${ph}`) {
            allocate(pageTexture, pw, ph);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, pageTexture);
            gl.texElementSubImage2D(gl.TEXTURE_2D, 0, 0, 0, page, { width: pw, height: ph });
            gl.generateMipmap(gl.TEXTURE_2D);
            pageStale = false;
          }
          gl.activeTexture(gl.TEXTURE0);
          uploaded = true;
          failures = 0;
        } catch {
          failures += 1;
          // no picture yet: ask again a few times, then hand over to the ordinary page
          if (!uploaded && failures > 20) onUnavailable();
          else if (!uploaded) need();
          return;
        }
        if (!mesh) return;
        gl.enable(gl.DEPTH_TEST);
        gl.clearColor(0.925, 0.91, 0.863, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.useProgram(program);
        gl.bindVertexArray(vao);
        gl.uniform1f(locations.angle, angle());
        gl.uniform1f(locations.yaw, yaw());
        gl.uniform1f(locations.meshHalf, meshHalf);
        gl.uniform1f(locations.relief, eased);
        gl.uniform1f(locations.fit, fit());
        gl.uniform1f(locations.shift, shift());
        gl.uniform1f(locations.unitsPerMeter, mesh.unitsPerMeter);
        gl.uniform1f(locations.base, mesh.minElevation);
        gl.uniform1i(locations.mapSampler, 0);
        gl.uniform1i(locations.pageSampler, 1);
        gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_INT, 0);
        gl.bindVertexArray(null);
      };

      // Ask for a paint; some builds send none when nothing changed, so draw anyway shortly after.
      const need = () => {
        if (disposed || pending) return;
        pending = true;
        canvas.requestPaint?.();
        window.setTimeout(() => {
          if (pending) render();
        }, 90);
      };

      const tick = (now: number) => {
        const elapsed = now - last;
        last = now;
        const wanted = mode === 'rising' || mode === 'raised' ? 1 : 0;
        if ((mode === 'rising' && terrainReadyAt !== null) || mode === 'lowering') {
          progress = reducedMotion ? wanted : clamp(progress + Math.sign(wanted - progress) * (elapsed / RAISE_DURATION_MS), 0, 1);
          if (Math.abs(progress - wanted) < 1e-6) {
            progress = wanted;
            mode = wanted === 1 ? 'raised' : 'flat';
            markStale();
          }
          // the same curve both ways, slow at each end, so standing up and lying down take the same time
          eased = progress * progress * (3 - 2 * progress);
          if (eased === 0) planeHeight = null;
        }
        if (inertia !== 0) {
          page.scrollTop += inertia * elapsed;
          inertia *= 0.94 ** (elapsed / 16);
          if (Math.abs(inertia) < 0.02) inertia = 0;
        }
        if (scrollTarget !== null && mode === 'raised') {
          const gap = scrollTarget - page.scrollTop;
          if (Math.abs(gap) < 1) {
            page.scrollTop = scrollTarget;
            scrollTarget = null;
          } else {
            page.scrollTop += gap * Math.min(1, 0.012 * elapsed + 0.04);
          }
          dirty = true;
        }
        if (eased !== renderedEased || dirty || inertia !== 0) {
          renderedEased = eased;
          dirty = false;
          placePage();
          need();
        }
        frame = requestAnimationFrame(tick);
      };

      // ---- the page scrolls inside the model
      const scrollBy = (delta: number) => {
        scrollTarget = null;
        if (mode === 'flat') {
          // the first push down stands the model up; the page itself waits
          if (delta > 0) mode = 'rising';
          inertia = 0;
          dirty = true;
          return;
        }
        if (mode !== 'raised') {
          inertia = 0;
          return;
        }
        page.scrollTop += delta;
        // back at the very top, the model lies down
        if (page.scrollTop <= 0 && delta < 0) {
          mode = 'lowering';
          inertia = 0;
        }
        dirty = true;
      };
      const onWheel = (event: WheelEvent) => {
        if (event.ctrlKey) return;
        event.preventDefault();
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? page.clientHeight : 1;
        inertia = 0;
        scrollBy(event.deltaY * unit);
      };
      let touchY: number | null = null;
      let touchTime = 0;
      const onTouchStart = (event: TouchEvent) => {
        touchY = event.touches[0]?.clientY ?? null;
        touchTime = event.timeStamp;
        inertia = 0;
      };
      const onTouchMove = (event: TouchEvent) => {
        const y = event.touches[0]?.clientY;
        if (touchY === null || y === undefined) return;
        const delta = touchY - y;
        if (Math.abs(delta) < 1) return;
        event.preventDefault();
        const dt = Math.max(1, event.timeStamp - touchTime);
        inertia = clamp(delta / dt, -3, 3);
        touchY = y;
        touchTime = event.timeStamp;
        scrollBy(delta);
      };
      const onTouchEnd = () => {
        touchY = null;
      };
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
        const target = event.target as HTMLElement | null;
        if (target?.closest('input, textarea, select')) return;
        const onControl = Boolean(target?.closest('a, button, summary'));
        const screenful = page.clientHeight * 0.9;
        let delta: number | null = null;
        if (event.key === 'ArrowDown') delta = 48;
        else if (event.key === 'ArrowUp') delta = -48;
        else if (event.key === 'PageDown') delta = screenful;
        else if (event.key === 'PageUp') delta = -screenful;
        else if (event.key === ' ' && !onControl) delta = event.shiftKey ? -screenful : screenful;
        else if (event.key === 'Home') delta = -page.scrollTop;
        else if (event.key === 'End') delta = page.scrollHeight;
        if (delta === null) return;
        event.preventDefault();
        scrollBy(delta);
      };
      // links to a place in this page scroll to it inside the model, instead of leaving it
      const onClick = (event: MouseEvent) => {
        const link = (event.target as HTMLElement | null)?.closest('a');
        if (!link) return;
        const url = new URL(link.href, window.location.href);
        if (!url.hash || url.origin !== window.location.origin || url.pathname !== window.location.pathname) return;
        const target = page.querySelector<HTMLElement>(`[id="${decodeURIComponent(url.hash.slice(1))}"]`);
        if (!target) return;
        event.preventDefault();
        const bar = page.querySelector<HTMLElement>('.site-bar');
        scrollTarget = Math.max(0, offsetWithin(target, page) - (bar?.offsetHeight ?? 0) - 16);
        if (mode === 'flat') mode = 'rising';
        else if (reducedMotion && mode === 'raised') page.scrollTop = scrollTarget;
      };
      const onScroll = () => {
        pageStale = true;
        dirty = true;
      };
      // anything that changes what the elements look like: tiles arriving, text, selection, hover, focus
      const mutationObserver = new MutationObserver(markStale);
      const observeOptions = { childList: true, attributes: true, characterData: true, subtree: true };
      mutationObserver.observe(map, observeOptions);
      mutationObserver.observe(page, observeOptions);
      const onMapLoad = () => {
        mapStale = true;
      };
      map.addEventListener('load', onMapLoad, true);
      const onPageLook = () => {
        pageStale = true;
      };
      for (const name of ['mouseover', 'mouseout', 'focusin', 'focusout']) page.addEventListener(name, onPageLook, true);

      canvas.addEventListener('paint', render);
      canvas.addEventListener('wheel', onWheel, { passive: false });
      canvas.addEventListener('touchstart', onTouchStart, { passive: true });
      canvas.addEventListener('touchmove', onTouchMove, { passive: false });
      canvas.addEventListener('touchend', onTouchEnd, { passive: true });
      canvas.addEventListener('touchcancel', onTouchEnd, { passive: true });
      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('keydown', onKeyDown);
      canvas.addEventListener('click', onClick);
      page.addEventListener('scroll', onScroll, { passive: true });
      const resizeObserver = new ResizeObserver(() => {
        setSize({ w: canvas.clientWidth, h: canvas.clientHeight });
        markStale();
        dirty = true;
        window.clearTimeout(loadTimer);
        loadTimer = window.setTimeout(ensureTerrain, 250);
      });
      resizeObserver.observe(canvas);

      ensureTerrain();
      frame = requestAnimationFrame(tick);
      cleanup = () => {
        disposed = true;
        controller?.abort();
        window.clearTimeout(loadTimer);
        cancelAnimationFrame(frame);
        canvas.removeEventListener('paint', render);
        canvas.removeEventListener('wheel', onWheel);
        canvas.removeEventListener('touchstart', onTouchStart);
        canvas.removeEventListener('touchmove', onTouchMove);
        canvas.removeEventListener('touchend', onTouchEnd);
        canvas.removeEventListener('touchcancel', onTouchEnd);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('keydown', onKeyDown);
        canvas.removeEventListener('click', onClick);
        page.removeEventListener('scroll', onScroll);
        resizeObserver.disconnect();
        mutationObserver.disconnect();
        map.removeEventListener('load', onMapLoad, true);
        for (const name of ['mouseover', 'mouseout', 'focusin', 'focusout']) page.removeEventListener(name, onPageLook, true);
        gl.deleteTexture(mapTexture);
        gl.deleteTexture(pageTexture);
        gl.deleteBuffer(vertexBuffer);
        gl.deleteBuffer(indexBuffer);
        gl.deleteVertexArray(vao);
        gl.deleteProgram(program);
      };
    } catch {
      onUnavailable();
    }
    return cleanup;
  }, [onUnavailable, scene]);

  return (
    <div className="about-stage" data-scene={scene.name}>
      <canvas ref={canvasRef} className="about-canvas">
        <div ref={mapRef} className="about-map-sheet" drawable="" style={{ width: mapWidth, height: MAP_HEIGHT }}>
          <SceneMap scene={scene} width={mapWidth} height={MAP_HEIGHT} />
        </div>
        <main
          ref={pageRef}
          className="site-page about-page about-doc"
          drawable=""
          tabIndex={0}
          style={{ width: size.w, height: size.h }}
          {...pageAttributes}
        >
          {children}
        </main>
      </canvas>
    </div>
  );
}
