import type { ElementTextureSource } from './renderer';

/**
 * Pieces the fallback can reproduce with plain 2D drawing: a fill (with inset rings), canvases, SVG paths, and (for
 * the pins and the probe) boxes with words in them.
 */
export const FALLBACK_PIECE_KINDS: ReadonlySet<string> = new Set(['sheet', 'terrain', 'relief', 'detail', 'hiker', 'pin', 'probe']);

/** The pieces that are words on plates: their child boxes and their text are drawn as well. */
const LABEL_KINDS: ReadonlySet<string> = new Set(['pin', 'probe']);

type Box = { left: number; top: number; width: number; height: number };

function isDrawn(el: Element) {
  const style = getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'collapse';
}

function relative(rect: DOMRect, root: DOMRect, sx: number, sy: number): Box {
  return {
    left: (rect.left - root.left) * sx,
    top: (rect.top - root.top) * sy,
    width: rect.width * sx,
    height: rect.height * sy,
  };
}

/** A number from a computed style, where 0 is a real value and only a missing or unparsable one falls back. */
function numeric(value: string, fallback: number) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Opacity is not inherited in CSS but it composites down the tree, so multiply it up to the piece. */
function effectiveOpacity(node: Element, root: Element) {
  let opacity = 1;
  for (let n: Element | null = node; n; n = n.parentElement) {
    opacity *= numeric(getComputedStyle(n).opacity, 1);
    if (n === root) break;
  }
  return opacity;
}

function paintSvg(ctx: CanvasRenderingContext2D, svg: SVGSVGElement, box: Box, root: Element) {
  const view = svg.viewBox?.baseVal;
  const vw = view && view.width > 0 ? view.width : box.width;
  const vh = view && view.height > 0 ? view.height : box.height;
  // preserveAspectRatio's default: centered, fitted
  const scale = Math.min(box.width / vw, box.height / vh);
  const ox = box.left + (box.width - vw * scale) / 2 - (view?.x ?? 0) * scale;
  const oy = box.top + (box.height - vh * scale) / 2 - (view?.y ?? 0) * scale;
  for (const path of svg.querySelectorAll<SVGPathElement>('path')) {
    const d = path.getAttribute('d');
    if (!d || !isDrawn(path)) continue;
    const opacity = effectiveOpacity(path, root);
    if (opacity <= 0) continue;
    const style = getComputedStyle(path);
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);
    const shape = new Path2D(d);
    if (style.fill && style.fill !== 'none') {
      ctx.globalAlpha = opacity * numeric(style.fillOpacity, 1);
      ctx.fillStyle = style.fill;
      ctx.fill(shape);
    }
    if (style.stroke && style.stroke !== 'none') {
      ctx.globalAlpha = opacity * numeric(style.strokeOpacity, 1);
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = parseFloat(style.strokeWidth) || 1;
      ctx.lineJoin = (style.strokeLinejoin as CanvasLineJoin) || 'miter';
      ctx.lineCap = (style.strokeLinecap as CanvasLineCap) || 'butt';
      ctx.stroke(shape);
    }
    ctx.restore();
  }
}

type Radius = { x: number; y: number };

/** `14px`, `4px 8px`, or `10%` (of the box side) from a computed corner radius, in CSS px. */
function cornerRadius(value: string, boxWidth: number, boxHeight: number) {
  const [x = '0', y = x] = value.trim().split(/\s+/);
  const length = (token: string, base: number) => (token.endsWith('%') ? (parseFloat(token) / 100) * base : parseFloat(token)) || 0;
  return { x: length(x, boxWidth), y: length(y, boxHeight) };
}

/** The four corner radii of an element in texture px (top left, top right, bottom right, bottom left). */
function radiiOf(style: CSSStyleDeclaration, root: DOMRect, sx: number, sy: number): Radius[] {
  return [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius].map((value) => {
    const r = cornerRadius(value ?? '', root.width, root.height);
    return { x: r.x * sx, y: r.y * sy };
  });
}

/** Starts a path along the element's rounded box, in texture px. False when no corner is rounded. */
function roundedBox(ctx: CanvasRenderingContext2D, style: CSSStyleDeclaration, root: DOMRect, sx: number, sy: number, width: number, height: number) {
  if (typeof ctx.roundRect !== 'function') return false;
  const radii = radiiOf(style, root, sx, sy);
  if (!radii.some((r) => r.x > 0 || r.y > 0)) return false;
  ctx.beginPath();
  ctx.roundRect(0, 0, width, height, radii);
  return true;
}

/** The inset, unblurred, unshifted `box-shadow`s of an element: `inset 0 0 0 3px #fff` is a ring along its edge. */
export function insetRings(shadow: string): { color: string; spread: number }[] {
  if (!shadow || shadow === 'none') return [];
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < shadow.length; i += 1) {
    if (shadow[i] === '(') depth += 1;
    else if (shadow[i] === ')') depth -= 1;
    else if (shadow[i] === ',' && depth === 0) {
      parts.push(shadow.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(shadow.slice(start));
  const rings: { color: string; spread: number }[] = [];
  for (const part of parts) {
    if (!/\binset\b/.test(part)) continue;
    const color = part.match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}\b/i)?.[0];
    if (!color) continue;
    const [x = 0, y = 0, blur = 0, spread = 0] = (part.replace(color, '').match(/-?\d*\.?\d+/g) ?? []).map(Number);
    if (x !== 0 || y !== 0 || blur !== 0 || spread <= 0) continue;
    rings.push({ color, spread });
  }
  return rings;
}

/** Paints the rings of an element's inset shadows over its fill. The first shadow listed lies on top. */
function paintInsetRings(ctx: CanvasRenderingContext2D, style: CSSStyleDeclaration, root: DOMRect, sx: number, sy: number, width: number, height: number) {
  const rings = insetRings(style.boxShadow);
  if (!rings.length) return;
  const radii = radiiOf(style, root, sx, sy);
  const box = (x: number, y: number, w: number, h: number, r: Radius[]) => {
    if (typeof ctx.roundRect === 'function' && r.some((c) => c.x > 0 || c.y > 0)) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  };
  for (const ring of [...rings].reverse()) {
    const ix = ring.spread * sx;
    const iy = ring.spread * sy;
    if (width - 2 * ix <= 0 || height - 2 * iy <= 0) continue;
    ctx.beginPath();
    box(0, 0, width, height, radii);
    box(ix, iy, width - 2 * ix, height - 2 * iy, radii.map((c) => ({ x: Math.max(0, c.x - ix), y: Math.max(0, c.y - iy) })));
    ctx.fillStyle = ring.color;
    ctx.fill('evenodd');
  }
}

type TextLine = { text: string; left: number; top: number; height: number };

/** The most characters of one text node a label draws (a pin's name holds 40, and a waypoint's is cut off by the plate anyway). */
export const MAX_LABEL_LETTERS = 120;

/** A length from a pseudo-element's computed style: `11px`, or a share of the box (`50%`). */
function pseudoLength(value: string, base: number) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return 0;
  return value.trim().endsWith('%') ? (parsed / 100) * base : parsed;
}

/**
 * The stem under a laid-flat pin is the `::after` of its box (the engine draws its own once the page is raised, and the
 * CSS hides this one then). A pseudo-element is not in the DOM, so its box is read from its computed style.
 */
function paintStem(ctx: CanvasRenderingContext2D, el: Element, root: DOMRect, sx: number, sy: number) {
  const style = getComputedStyle(el, '::after');
  if (!style || style.display === 'none' || style.content === 'none' || style.content === 'normal') return;
  const color = style.backgroundColor;
  if (!color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)') return;
  const opacity = effectiveOpacity(el, el);
  const width = pseudoLength(style.width, root.width);
  const height = pseudoLength(style.height, root.height);
  if (opacity <= 0 || width <= 0 || height <= 0) return;
  const left = pseudoLength(style.left, root.width) + pseudoLength(style.marginLeft, root.width);
  const top = root.height - pseudoLength(style.bottom, root.height) - height;
  ctx.globalAlpha = opacity;
  ctx.fillStyle = color;
  ctx.fillRect(left * sx, top * sy, width * sx, height * sy);
}

/** The lines a text node is laid out in (CSS px, viewport), found letter by letter so wrapping is the browser's own. */
export function textLines(node: Text): TextLine[] {
  const range = document.createRange();
  const lines: TextLine[] = [];
  let current: TextLine | null = null;
  let offset = 0;
  for (const letter of node.data) {
    // a name can come from a link or a file, and each letter costs a layout measurement
    if (offset >= MAX_LABEL_LETTERS) break;
    range.setStart(node, offset);
    range.setEnd(node, offset + letter.length);
    offset += letter.length;
    const r = range.getBoundingClientRect();
    // collapsed white space and line breaks take no room
    if (r.width <= 0) continue;
    if (current && Math.abs(r.top - current.top) < current.height / 2) current.text += letter;
    else {
      current = { text: letter, left: r.left, top: r.top, height: r.height };
      lines.push(current);
    }
  }
  return lines;
}

function paintText(ctx: CanvasRenderingContext2D, node: Text, owner: Element, piece: Element, root: DOMRect, sx: number, sy: number) {
  if (!node.data.trim()) return;
  const style = getComputedStyle(owner);
  const opacity = effectiveOpacity(owner, piece);
  // not `visibility`: the stage the pieces live in is hidden that way, and it is inherited
  if (opacity <= 0) return;
  ctx.font = `${style.fontStyle} ${style.fontWeight} ${numeric(style.fontSize, 12) * sy}px ${style.fontFamily}`;
  ctx.fillStyle = style.color;
  ctx.globalAlpha = opacity;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  for (const line of textLines(node)) {
    const x = (line.left - root.left) * sx;
    const middle = (line.top + line.height / 2 - root.top) * sy;
    const metrics = ctx.measureText(line.text);
    const ascent = metrics.fontBoundingBoxAscent;
    const descent = metrics.fontBoundingBoxDescent;
    if (typeof ascent === 'number' && typeof descent === 'number') ctx.fillText(line.text, x, middle + (ascent - descent) / 2);
    else {
      ctx.textBaseline = 'middle';
      ctx.fillText(line.text, x, middle);
      ctx.textBaseline = 'alphabetic';
    }
  }
}

/** A child box of a label: its fill, its clip, and what is inside it. */
function paintLabelBox(ctx: CanvasRenderingContext2D, el: Element, piece: Element, root: DOMRect, sx: number, sy: number) {
  if (el instanceof SVGElement || !isDrawn(el)) return;
  const opacity = effectiveOpacity(el, piece);
  if (opacity <= 0) return;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const style = getComputedStyle(el);
  const box = relative(rect, root, sx, sy);
  const radii = [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius].map((value) => {
    const r = cornerRadius(value ?? '', rect.width, rect.height);
    return { x: r.x * sx, y: r.y * sy };
  });
  const rounded = typeof ctx.roundRect === 'function' && radii.some((r) => r.x > 0 || r.y > 0);
  const outline = () => {
    ctx.beginPath();
    if (rounded) ctx.roundRect(box.left, box.top, box.width, box.height, radii);
    else ctx.rect(box.left, box.top, box.width, box.height);
  };
  const background = style.backgroundColor;
  if (background && background !== 'transparent' && background !== 'rgba(0, 0, 0, 0)') {
    ctx.globalAlpha = opacity;
    ctx.fillStyle = background;
    if (rounded) {
      outline();
      ctx.fill();
    } else ctx.fillRect(box.left, box.top, box.width, box.height);
  }
  const clips = style.overflow.split(' ').some((value) => value !== '' && value !== 'visible');
  if (clips) {
    ctx.save();
    outline();
    ctx.clip();
  }
  paintLabelContents(ctx, el, piece, root, sx, sy);
  if (clips) ctx.restore();
}

function paintLabelContents(ctx: CanvasRenderingContext2D, parent: Element, piece: Element, root: DOMRect, sx: number, sy: number) {
  for (const node of parent.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) paintText(ctx, node as Text, parent, piece, root, sx, sy);
    else if (node instanceof Element) paintLabelBox(ctx, node, piece, root, sx, sy);
  }
}

/** Draws an element's own fill, its child canvases and its SVG paths into a width x height 2D canvas. */
export function rasterizeElement(ctx: CanvasRenderingContext2D, el: Element, width: number, height: number) {
  ctx.clearRect(0, 0, width, height);
  const root = el.getBoundingClientRect();
  if (root.width <= 0 || root.height <= 0) return;
  const sx = width / root.width;
  const sy = height / root.height;
  const own = getComputedStyle(el);
  const background = own.backgroundColor;
  if (background && background !== 'transparent' && background !== 'rgba(0, 0, 0, 0)') {
    ctx.fillStyle = background;
    // a rounded sheet keeps its corners transparent, as it does when the browser draws it
    if (roundedBox(ctx, own, root, sx, sy, width, height)) ctx.fill();
    else ctx.fillRect(0, 0, width, height);
  }
  paintInsetRings(ctx, own, root, sx, sy, width, height);
  const clipsChildren = own.overflow.split(' ').some((value) => value !== '' && value !== 'visible');
  const clipped = clipsChildren && roundedBox(ctx, own, root, sx, sy, width, height);
  if (clipped) {
    ctx.save();
    ctx.clip();
  }
  for (const child of el.querySelectorAll('canvas, svg')) {
    if (!isDrawn(child)) continue;
    const box = relative(child.getBoundingClientRect(), root, sx, sy);
    if (box.width <= 0 || box.height <= 0) continue;
    if (child instanceof HTMLCanvasElement) {
      if (child.width > 0 && child.height > 0) ctx.drawImage(child, box.left, box.top, box.width, box.height);
    } else paintSvg(ctx, child as SVGSVGElement, box, el);
  }
  const piece = (el as HTMLElement).dataset?.piece ?? '';
  if (piece === 'pin') paintStem(ctx, el, root, sx, sy);
  if (LABEL_KINDS.has(piece)) paintLabelContents(ctx, el, el, root, sx, sy);
  if (clipped) ctx.restore();
}

/** Uploads rasterized elements as ordinary textures. One scratch canvas is reused for every piece. */
export function createRasterTextureSource(): ElementTextureSource {
  const scratch = document.createElement('canvas');
  return {
    failure: 'Fallback texture upload failed.',
    upload(gl, el, width, height) {
      scratch.width = width;
      scratch.height = height;
      const ctx = scratch.getContext('2d');
      if (!ctx) throw new Error('2D canvas is unavailable.');
      rasterizeElement(ctx, el, width, height);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, scratch);
    },
  };
}
