import type { HtmlInCanvasElement } from './htmlInCanvas';

/** Context methods that change pixels; a canvas piece is repainted after any of them. */
const DRAWING = new Set([
  'drawImage', 'clearRect', 'fillRect', 'strokeRect', 'fill', 'stroke', 'fillText', 'strokeText', 'putImageData',
]);

export type FallbackPaint = {
  /** Marks a piece (or, with no argument, every piece) as changed. */
  invalidate(el?: Element): void;
  dispose(): void;
};

/**
 * Stands in for the browser's own change detection, which only HTML-in-Canvas has.
 * It gives the canvas a `requestPaint` and answers with `paint` events listing the changed pieces,
 * so the engine's existing paint handling works unchanged.
 */
export function installFallbackPaint(canvas: HtmlInCanvasElement, page: HTMLElement): FallbackPaint {
  const stage = page.parentElement as HTMLElement;
  const dirty = new Set<Element>();
  let frame = 0;
  let disposed = false;

  const pieceOf = (node: Node | null) => {
    const el = node instanceof Element ? node : node?.parentElement ?? null;
    const piece = el?.closest('[data-piece]') ?? null;
    return piece && stage.contains(piece) ? piece : null;
  };
  const pieces = () => Array.from(stage.querySelectorAll('[data-piece]'));
  const withSvg = () => pieces().filter((el) => el.querySelector('svg'));

  const flush = () => {
    frame = 0;
    if (disposed) return;
    const changedElements = Array.from(dirty);
    dirty.clear();
    canvas.dispatchEvent(Object.assign(new Event('paint'), { changedElements }));
  };
  canvas.requestPaint = () => {
    if (!frame && !disposed) frame = requestAnimationFrame(flush);
  };

  const invalidate = (el?: Element) => {
    if (disposed) return;
    if (!el) for (const piece of pieces()) dirty.add(piece);
    else {
      const piece = pieceOf(el);
      if (piece) dirty.add(piece);
    }
  };

  // Pixels drawn into a canvas piece are invisible to the DOM, so watch the 2D contexts it hands out.
  const restore: (() => void)[] = [];
  const watched = new WeakSet<HTMLCanvasElement>();
  const watch = (target: HTMLCanvasElement) => {
    if (watched.has(target)) return;
    watched.add(target);
    const original = target.getContext;
    const wrapped = new WeakMap<object, CanvasRenderingContext2D>();
    target.getContext = function (this: HTMLCanvasElement, type: string, options?: unknown) {
      const context = (original as (t: string, o?: unknown) => RenderingContext | null).call(this, type, options);
      if (type !== '2d' || !context) return context;
      let proxy = wrapped.get(context);
      if (!proxy) {
        proxy = new Proxy(context as CanvasRenderingContext2D, {
          get(real, key) {
            const value = Reflect.get(real, key, real);
            if (typeof value !== 'function') return value;
            return (...args: unknown[]) => {
              const result = (value as (...a: unknown[]) => unknown).apply(real, args);
              if (typeof key === 'string' && DRAWING.has(key)) {
                invalidate(target);
                canvas.requestPaint();
              }
              return result;
            };
          },
          set(real, key, value) {
            return Reflect.set(real, key, value, real);
          },
        });
        wrapped.set(context, proxy);
      }
      return proxy;
    } as HTMLCanvasElement['getContext'];
    restore.push(() => {
      target.getContext = original;
    });
  };
  for (const target of stage.querySelectorAll('canvas')) watch(target);

  const observer = new MutationObserver((records) => {
    let touched = false;
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof HTMLCanvasElement) watch(node);
        else if (node instanceof Element) for (const inner of node.querySelectorAll('canvas')) watch(inner);
      }
      const piece = pieceOf(record.target);
      if (piece) {
        dirty.add(piece);
        touched = true;
      } else if (record.type === 'attributes' && record.target === page) {
        // a style variable on the page itself (the route's line width) changes every piece that draws a route
        for (const el of withSvg()) dirty.add(el);
        touched = true;
      }
    }
    if (touched) canvas.requestPaint();
  });
  observer.observe(stage, { subtree: true, childList: true, attributes: true, characterData: true });

  invalidate();

  return {
    invalidate(el) {
      invalidate(el);
      canvas.requestPaint();
    },
    dispose() {
      disposed = true;
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      for (const undo of restore) undo();
      delete (canvas as Partial<HtmlInCanvasElement>).requestPaint;
    },
  };
}
