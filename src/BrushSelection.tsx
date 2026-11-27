import { useEffect, useRef, useState } from 'react';

type Stroke = { key: string; d: string; opacity: number };

/** A small deterministic noise, so a stroke does not change shape each time it is redrawn. */
function noise(seed: number) {
  let state = (seed * 2654435761) >>> 0;
  return () => {
    state = (Math.imul(state ^ (state >>> 15), 2246822519) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * One line of selected text as a rough sweep of a dry brush: a ragged band a little taller than the
 * characters, overrunning each end and tapering at both.
 */
function strokesFor(rect: { x: number; y: number; w: number; h: number }, index: number): Stroke[] {
  const rand = noise(Math.round(rect.x * 7 + rect.y * 13 + rect.w * 3));
  const height = rect.h * 0.92;
  const top = rect.y + (rect.h - height) / 2;
  const overrun = rect.h * (0.1 + rand() * 0.25);
  const left = rect.x - overrun;
  const right = rect.x + rect.w + overrun * (0.6 + rand());
  const steps = Math.max(6, Math.round((right - left) / 9));
  const wobble = rect.h * 0.1;
  const upper: string[] = [];
  const lower: string[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const x = left + ((right - left) * i) / steps;
    // the ends taper like the start and lift-off of a stroke
    const edge = Math.min(i, steps - i) / Math.min(4, steps / 2);
    const taper = Math.min(1, 0.35 + edge * 0.65);
    const inset = (1 - taper) * height * 0.5;
    upper.push(`${x.toFixed(1)},${(top + inset + (rand() - 0.5) * wobble * 2).toFixed(1)}`);
    lower.push(`${x.toFixed(1)},${(top + height - inset + (rand() - 0.5) * wobble * 2.4).toFixed(1)}`);
  }
  // one path in one flat tone: the roughness is all in the edge
  return [{ key: String(index), d: `M${upper.join(' L')} L${lower.reverse().join(' L')} Z`, opacity: 1 }];
}

/**
 * Selected text is shown as vermilion brush strokes drawn over the page (in the page's own coordinates, so it
 * scrolls with it and is part of what HTML-in-Canvas paints onto the terrain), not as the browser's block.
 */
export default function BrushSelection() {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);

  useEffect(() => {
    const svg = svgRef.current;
    const page = svg?.closest<HTMLElement>('.site-page');
    if (!svg || !page) return;
    /** The nearest enclosing box that has a size of its own, to measure a run of text against. */
    const boxOf = (node: Node) => {
      let el = node.parentElement;
      while (el && el !== page && (el.offsetWidth === 0 || getComputedStyle(el).display === 'inline')) el = el.parentElement;
      return el && el !== page ? el : null;
    };
    const pathTo = (from: Node, to: Node) => {
      const path: number[] = [];
      for (let node: Node | null = to; node && node !== from; node = node.parentNode) {
        path.unshift(Array.prototype.indexOf.call(node.parentNode!.childNodes, node));
      }
      return path;
    };
    /** The block of the page that holds `node`: the page's own child, such as a section. */
    const blockOf = (node: Node) => {
      let el = node.parentElement;
      while (el && el.parentElement !== page) el = el.parentElement;
      return el;
    };
    /**
     * On the terrain model the browser reports text positions as drawn (the box that holds the tilted run), which
     * is no use for placing a stroke in the page's own layout. So the run is measured in an untilted copy of the
     * whole block it belongs to, at the same width, off to the side; the block is copied whole so that its grids
     * and rows lay out just as they do on the page.
     */
    let scratch: HTMLElement | null = null;
    const measureInCopy = (block: HTMLElement, text: Text, startOffset: number, endOffset: number) => {
      if (!scratch) {
        scratch = document.createElement('div');
        scratch.setAttribute('aria-hidden', 'true');
        scratch.style.cssText = 'position:fixed;left:-20000px;top:0;visibility:hidden;pointer-events:none;overflow:visible;';
        document.body.appendChild(scratch);
      }
      scratch.replaceChildren();
      const root = document.createElement('div');
      root.className = page.className;
      for (const { name, value } of Array.from(page.attributes)) if (name.startsWith('data-')) root.setAttribute(name, value);
      root.style.cssText = `position:relative;width:${page.offsetWidth}px;height:auto;overflow:visible;background:none;`;
      scratch.appendChild(root);
      const copy = block.cloneNode(true) as HTMLElement;
      copy.style.position = 'relative';
      copy.style.top = 'auto';
      copy.style.bottom = 'auto';
      root.appendChild(copy);
      let target: Node = copy;
      for (const index of pathTo(block, text)) target = target.childNodes[index];
      const part = document.createRange();
      part.setStart(target, startOffset);
      part.setEnd(target, endOffset);
      const origin = copy.getBoundingClientRect();
      return Array.from(part.getClientRects()).map((rect) => ({ x: rect.left - origin.left, y: rect.top - origin.top, w: rect.width, h: rect.height }));
    };
    const layoutOrigin = (el: HTMLElement) => {
      let left = 0;
      let top = 0;
      for (let node: HTMLElement | null = el; node && node !== page; node = node.offsetParent as HTMLElement | null) {
        left += node.offsetLeft;
        top += node.offsetTop;
      }
      return { left, top };
    };
    const update = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        setStrokes([]);
        return;
      }
      const range = selection.getRangeAt(0);
      if (!page.contains(range.commonAncestorContainer)) {
        setStrokes([]);
        return;
      }
      const drawnPage = page.getBoundingClientRect();
      const tilted = Math.abs(drawnPage.width - page.offsetWidth) > 1 || Math.abs(drawnPage.height - page.offsetHeight) > 1;
      const lines: { x: number; y: number; w: number; h: number }[] = [];
      const root = range.commonAncestorContainer.nodeType === Node.TEXT_NODE ? range.commonAncestorContainer.parentNode! : range.commonAncestorContainer;
      const texts: Text[] = [];
      if (range.commonAncestorContainer.nodeType === Node.TEXT_NODE) texts.push(range.commonAncestorContainer as Text);
      else {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) if (range.intersectsNode(node)) texts.push(node as Text);
      }
      for (const text of texts) {
        const box = boxOf(text);
        if (!box || !text.data.trim()) continue;
        const start = text === range.startContainer ? range.startOffset : 0;
        const end = text === range.endContainer ? range.endOffset : text.data.length;
        let runs: { x: number; y: number; w: number; h: number }[];
        const block = blockOf(text);
        if (tilted && block) {
          const origin = layoutOrigin(block);
          runs = measureInCopy(block, text, start, end).map((run) => ({ ...run, x: run.x + origin.left, y: run.y + origin.top }));
        } else {
          const part = document.createRange();
          part.setStart(text, start);
          part.setEnd(text, end);
          runs = Array.from(part.getClientRects()).map((rect) => ({
            x: rect.left - drawnPage.left + page.scrollLeft,
            y: rect.top - drawnPage.top + page.scrollTop,
            w: rect.width,
            h: rect.height,
          }));
        }
        for (const line of runs) {
          if (line.w < 2 || line.h < 4) continue;
          // the pieces of one line are joined into a single sweep
          const same = lines.find((other) => Math.abs(other.y - line.y) < line.h * 0.4 && Math.abs(other.h - line.h) < line.h * 0.6 && line.x <= other.x + other.w + line.h && other.x <= line.x + line.w + line.h);
          if (same) {
            const right = Math.max(same.x + same.w, line.x + line.w);
            same.x = Math.min(same.x, line.x);
            same.w = right - same.x;
          } else {
            lines.push(line);
          }
        }
      }
      setStrokes(lines.flatMap((line, index) => strokesFor(line, index)));
    };
    document.addEventListener('selectionchange', update);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(page);
    return () => {
      scratch?.remove();
      document.removeEventListener('selectionchange', update);
      observer?.disconnect();
    };
  }, []);

  return (
    <svg ref={svgRef} className="brush-layer" aria-hidden="true" width="1" height="1">
      {strokes.map((stroke) => (
        <path key={stroke.key} d={stroke.d} fill="#efc2b5" fillOpacity={stroke.opacity} />
      ))}
    </svg>
  );
}
