import { useEffect, useState, type RefObject } from 'react';

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

export function FlagContent({ brushes, twin = false }: { brushes: Brush[]; twin?: boolean }) {
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
        <h2>gpx-topo</h2>
        <p className="flag-lead">GPX のルートを、国土地理院の地図と標高から作った立体模型の上で見るアプリです。</p>
        <div className="flag-cols">
          <section>
            <h3>ルートを読み込む</h3>
            <ul>
              <li>「GPX を開く」で手元の GPX ファイルを読み込む（最初はサンプルのコース）</li>
              <li>カメラのボタンで、今の画面を PNG で保存</li>
            </ul>
            <h3>地図を見る</h3>
            <ul>
              <li>「起こす」で立体に、「寝かす」で平面に。Esc でも平面に戻る</li>
              <li>ドラッグで回転、右ドラッグか Shift + ドラッグで移動</li>
              <li>ホイールで立ち上げてズーム。地図の右下で航空写真に切り替え</li>
              <li>▶ でコースを後ろから追いかける Flyover</li>
            </ul>
          </section>
          <section>
            <h3>ウェイポイントと時刻</h3>
            <ul>
              <li>「ウェイポイント追加」を押してルートをクリック、またはパネルに km を入れて「追加」</li>
              <li>パネルで名前と km を書き換え、× で削除</li>
              <li>スタート時刻、日付、各地点の目標時刻を押して変更</li>
              <li>「日照」のスライダーで時刻を動かし、日の当たり方を見る</li>
              <li>番号を押すと、その地点の時刻の日照になる</li>
              <li>標高グラフの赤い点を動かすと、その位置と時刻に</li>
            </ul>
          </section>
        </div>
        <div className="flag-foot">
          <p className="flag-author">
            作った人：キョウヘイ
            <a className="flag-icon" href="https://x.com/kyouhei" target="_blank" rel="noreferrer" aria-label="X" title="X">
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
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.6 14.4a.6.6 0 0 1-.9.2c-2.4-1.5-5.4-1.8-9-1a.6.6 0 1 1-.3-1.2c3.9-.9 7.2-.5 9.9 1.1.3.2.4.6.3.9Zm1.2-2.7a.8.8 0 0 1-1.1.3c-2.7-1.7-6.9-2.2-10.1-1.2a.8.8 0 1 1-.5-1.5c3.7-1.1 8.3-.6 11.4 1.3.4.2.5.7.3 1.1Zm.1-2.8C14.7 9 9.4 8.8 6.3 9.7a.9.9 0 1 1-.5-1.8c3.5-1.1 9.4-.9 13.1 1.3a.9.9 0 1 1-.9 1.6Z" />
              </svg>
            </a>
          </p>
          <div>
            <h3>その他のアプリ</h3>
            <ul className="flag-links">
              <li>
                <a href="https://www.boxhouse120.com/gpx-wallpaper" target="_blank" rel="noreferrer">
                  GPX壁紙なんちゃら
                </a>
              </li>
              <li>
                <a href="https://zessoku.pages.dev/help/" target="_blank" rel="noreferrer">
                  レース中に開くなんちゃら
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
