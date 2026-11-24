import type { ElementTextureSource } from './renderer';

/** Pieces the fallback can reproduce with plain 2D drawing: a fill, canvases, and SVG paths. */
export const FALLBACK_PIECE_KINDS: ReadonlySet<string> = new Set(['sheet', 'terrain', 'relief', 'detail']);

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

function paintSvg(ctx: CanvasRenderingContext2D, svg: SVGSVGElement, box: Box) {
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
    const style = getComputedStyle(path);
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);
    ctx.globalAlpha = Number(style.opacity) || 1;
    const shape = new Path2D(d);
    if (style.fill && style.fill !== 'none') {
      ctx.fillStyle = style.fill;
      ctx.fill(shape);
    }
    if (style.stroke && style.stroke !== 'none') {
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = parseFloat(style.strokeWidth) || 1;
      ctx.lineJoin = (style.strokeLinejoin as CanvasLineJoin) || 'miter';
      ctx.lineCap = (style.strokeLinecap as CanvasLineCap) || 'butt';
      ctx.stroke(shape);
    }
    ctx.restore();
  }
}

/** Draws an element's own fill, its child canvases and its SVG paths into a width x height 2D canvas. */
export function rasterizeElement(ctx: CanvasRenderingContext2D, el: Element, width: number, height: number) {
  ctx.clearRect(0, 0, width, height);
  const root = el.getBoundingClientRect();
  if (root.width <= 0 || root.height <= 0) return;
  const sx = width / root.width;
  const sy = height / root.height;
  const background = getComputedStyle(el).backgroundColor;
  if (background && background !== 'transparent' && background !== 'rgba(0, 0, 0, 0)') {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
  }
  for (const child of el.querySelectorAll('canvas, svg')) {
    if (!isDrawn(child)) continue;
    const box = relative(child.getBoundingClientRect(), root, sx, sy);
    if (box.width <= 0 || box.height <= 0) continue;
    if (child instanceof HTMLCanvasElement) {
      if (child.width > 0 && child.height > 0) ctx.drawImage(child, box.left, box.top, box.width, box.height);
    } else paintSvg(ctx, child as SVGSVGElement, box);
  }
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
