import { useEffect, useState, type RefObject } from 'react';

import { addAction } from './observability';
import type { Copy } from './i18n';

// What is on the (i) flag. The engine draws the flag's element as silk and keeps it the real, clickable element, so
// the text is selected right on it. The selection is shown as strokes of a dry brush behind the text (the brush of the
// guide in timeseries-alternative, in gold), measured on a hidden twin of the text laid out flat, since the flag itself is
// turned and bent on the screen.

export type Brush = { x: number; y: number; w: number; h: number };

function pathFrom(root: Node, node: Node): number[] {
  const path: number[] = [];
  for (let at: Node | null = node; at && at !== root; at = at.parentNode) {
    const parent: Node | null = at.parentNode;
    if (!parent) return [];
    path.unshift(Array.prototype.indexOf.call(parent.childNodes, at));
  }
  return path;
}

function nodeAt(root: Node, path: number[]): Node | null {
  let node: Node | null = root;
  for (const index of path) node = node?.childNodes[index] ?? null;
  return node;
}

export function FlagContent({ brushes, copy, twin = false }: { brushes: Brush[]; copy: Copy; twin?: boolean }) {
  return (
    <>
      <img className="flag-art" src="/flag-skull.jpg" alt="" aria-hidden="true" />
      <div className="flag-text" data-selectable={twin ? undefined : ''}>
        {/* the twin keeps a stand-in here, so that a text node is found at the same path in both */}
        {twin ? (
          <span hidden />
        ) : (
          <svg className="flag-brush-filter" width="0" height="0" aria-hidden="true">
            <filter id="flag-brush" x="-6%" y="-40%" width="112%" height="180%">
              <feTurbulence type="fractalNoise" baseFrequency="0.012 0.9" numOctaves="2" seed="4" result="noise" />
              <feDisplacementMap in="SourceGraphic" in2="noise" scale="16" xChannelSelector="R" yChannelSelector="G" />
            </filter>
          </svg>
        )}
        <div className="flag-brushes" aria-hidden="true">
          {brushes.map((b, i) => (
            <span key={i} className="flag-brush" style={{ left: b.x - 6, top: b.y - 1, width: b.w + 12, height: b.h + 2 }} />
          ))}
        </div>
        <h2>{copy.appName}</h2>
        <p className="flag-lead">{copy.flag.lead}</p>
        <div className="flag-cols">
          <section>
            <h3>{copy.flag.modes}</h3>
            <ul>
              <li>
                <strong>{copy.ui.gpxMode}</strong> - {copy.flag.gpxModeDescription}
              </li>
              <li>
                <strong>{copy.ui.mapMode}</strong> - {copy.flag.mapModeDescription}
              </li>
            </ul>
            <h3>{copy.flag.loadRoute}</h3>
            <ul>
              {copy.flag.loadRouteItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <h3>{copy.flag.viewMap}</h3>
            <ul>
              {copy.flag.viewMapItems.slice(0, 2).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
          <section>
            <ul className="flag-continuation">
              {copy.flag.viewMapItems.slice(2).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <h3>{copy.flag.waypointsAndTimes}</h3>
            <ul>
              {copy.flag.waypointsAndTimesItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        </div>
        <div className="flag-foot">
          <p className="flag-author">
            {copy.flag.madeBy}
            <a
              className="flag-icon"
              href="https://x.com/kyouhei"
              target="_blank"
              rel="noreferrer"
              aria-label="X"
              title="X"
              onClick={() => {
                if (!twin) addAction('info_link_clicked', { destination: 'x' });
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M17.8 3h3.1l-6.8 7.7 8 10.3h-6.2l-4.9-6.3L5.4 21H2.3l7.3-8.3L2 3h6.4l4.4 5.8L17.8 3Zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5Z" />
              </svg>
            </a>
            <a
              className="flag-icon"
              href="https://open.spotify.com/show/6rRIlgRDC7EasQW0qDI4DE?si=fe5bb5298dde4e27"
              target="_blank"
              rel="noreferrer"
              aria-label="Podcast (Spotify)"
              title="Podcast (Spotify)"
              onClick={() => {
                if (!twin) addAction('info_link_clicked', { destination: 'spotify' });
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.6 14.4a.6.6 0 0 1-.9.2c-2.4-1.5-5.4-1.8-9-1a.6.6 0 1 1-.3-1.2c3.9-.9 7.2-.5 9.9 1.1.3.2.4.6.3.9Zm1.2-2.7a.8.8 0 0 1-1.1.3c-2.7-1.7-6.9-2.2-10.1-1.2a.8.8 0 1 1-.5-1.5c3.7-1.1 8.3-.6 11.4 1.3.4.2.5.7.3 1.1Zm.1-2.8C14.7 9 9.4 8.8 6.3 9.7a.9.9 0 1 1-.5-1.8c3.5-1.1 9.4-.9 13.1 1.3a.9.9 0 1 1-.9 1.6Z" />
              </svg>
            </a>
            <a
              className="flag-icon"
              href="https://www.amazon.co.jp/hz/wishlist/ls/1DP92J2BSDP0O"
              target="_blank"
              rel="noreferrer"
              aria-label={copy.flag.wishlist}
              title={copy.flag.wishlist}
              onClick={() => {
                if (!twin) addAction('info_link_clicked', { destination: 'amazon_wishlist' });
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 2.8h9.5L19 7.3v10.1a3.8 3.8 0 0 1-3.8 3.8H5a3.8 3.8 0 0 1-3.8-3.8V6.6A3.8 3.8 0 0 1 5 2.8Z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.45" />
                <path d="M14.5 3v4.3h4.1M4.8 10h6.8M4.8 13.2h5.7M4.8 16.4h4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.45" />
                <path d="M15.5 12c1.2-1.5 4-.8 4 1.3 0 2.5-4 5.6-4 5.6s-4-3.1-4-5.6c0-2.1 2.8-2.8 4-1.3Z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.65" />
              </svg>
            </a>
          </p>
          <div>
            <h3>{copy.flag.otherApps}</h3>
            <ul className="flag-links">
              <li>
                <a
                  href="https://www.boxhouse120.com/gpx-wallpaper"
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => {
                    if (!twin) addAction('info_link_clicked', { destination: 'gpx_wallpaper' });
                  }}
                >
                  {copy.flag.gpxWallpaper}
                </a>
              </li>
              <li>
                <a
                  href="https://zessoku.pages.dev/help/"
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => {
                    if (!twin) addAction('info_link_clicked', { destination: 'zessoku_help' });
                  }}
                >
                  {copy.flag.raceTime}
                </a>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}

/** The boxes of the text selected on the flag, in its text's own coordinates (so they scroll with it). */
export function useFlagBrushes(flagRef: RefObject<HTMLElement | null>, twinRef: RefObject<HTMLElement | null>) {
  const [brushes, setBrushes] = useState<Brush[]>([]);
  useEffect(() => {
    const clear = () => setBrushes((now) => (now.length ? [] : now));
    const update = () => {
      const body = flagRef.current?.querySelector('.flag-text');
      const twin = twinRef.current;
      const twinBody = twin?.querySelector<HTMLElement>('.flag-text');
      const selection = document.getSelection();
      if (!body || !twin || !twinBody || !selection || selection.rangeCount === 0 || selection.isCollapsed) return clear();
      const range = selection.getRangeAt(0);
      if (!body.contains(range.commonAncestorContainer)) return clear();
      // the twin is scrolled as far as the flag
      twinBody.scrollTop = body.scrollTop;
      const origin = twinBody.getBoundingClientRect();
      const boxes: Brush[] = [];
      const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT);
      for (let node: Node | null = walker.currentNode; node; node = walker.nextNode()) {
        if (node.nodeType !== Node.TEXT_NODE || !range.intersectsNode(node)) continue;
        const text = node.textContent ?? '';
        if (!text.trim()) continue;
        const mine = nodeAt(twinBody, pathFrom(body, node));
        if (!mine) continue;
        const part = document.createRange();
        try {
          part.setStart(mine, node === range.startContainer ? range.startOffset : 0);
          part.setEnd(mine, node === range.endContainer ? range.endOffset : text.length);
        } catch {
          continue;
        }
        for (const r of Array.from(part.getClientRects())) {
          if (r.width > 1 && r.height > 1) boxes.push({ x: r.left - origin.left, y: r.top - origin.top + twinBody.scrollTop, w: r.width, h: r.height });
        }
      }
      setBrushes(boxes);
    };
    document.addEventListener('selectionchange', update);
    return () => document.removeEventListener('selectionchange', update);
  }, [flagRef, twinRef]);
  return brushes;
}
