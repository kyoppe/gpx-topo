import { useCallback, useEffect, useRef, useState } from 'react';

import BrushSelection from './BrushSelection';
import CreatorSection from './CreatorSection';
import { detectLanguage, getCopy } from './i18n';
import { supportsHtmlInCanvas } from './htmlInCanvas';
import { addAction } from './observability';
import SceneMap from './SceneMap';
import { SiteFooter, SiteHeader, usePrimaryTouch } from './SiteChrome';
import TerrainStage from './TerrainStage';
import { SHOWCASE_SCENE } from './siteScene';
import { siteCopy } from './siteCopy';

const FAQ_URL = 'https://www.boxhouse120.com/gpx-wallpaper';
const HTML_IN_CANVAS_URL = 'https://github.com/WICG/html-in-canvas';

/** The page's opening: the same words whether the page lies on the GSI map or on the terrain model. */
function Hero({ copy, credit }: { copy: ReturnType<typeof siteCopy>; credit: string }) {
  return (
    <section className="about-plain" aria-labelledby="about-title">
      <div className="about-plain-copy">
        <span className="site-rule" />
        <h1 id="about-title">{copy.heroTitle}</h1>
        <p className="site-lead">{copy.heroLead}</p>
        <div className="site-actions">
          <a className="site-button site-button-primary" href="/">
            {copy.heroButton}
          </a>
          <a className="site-button" href="/tutorial">
            {copy.heroTutorial}
          </a>
        </div>
      </div>
      <p className="about-plain-credit">
        {SHOWCASE_SCENE.name}・{credit}
      </p>
    </section>
  );
}

export default function AboutPage() {
  const language = detectLanguage();
  const copy = siteCopy(language);
  const touch = usePrimaryTouch();
  const [nativeFailed, setNativeFailed] = useState(false);
  const native = !nativeFailed && supportsHtmlInCanvas();
  const onUnavailable = useCallback((reason: string) => {
    // the page carries on as an ordinary one; record why the terrain could not be drawn
    addAction('about_terrain_unavailable', { reason });
    setNativeFailed(true);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = `${copy.navAbout} - ${copy.footer}`;
  }, [copy.footer, copy.navAbout, language]);

  const controlsTitle = touch ? copy.touchTitle : copy.pointerTitle;
  const controls = touch ? copy.touchItems : copy.pointerItems;

  // One page, two places to lie: on the GSI blank map, or (HTML-in-Canvas) on the terrain model made from it.
  const content = (
    <>
      <BrushSelection />

      <div className="site-bar">
        <SiteHeader copy={copy} current="about" />
      </div>

      <Hero copy={copy} credit={native ? copy.mapCredit : copy.mapCreditPale} />

      <section className="site-section" id="about-can" aria-labelledby="about-can-title">
        <h2 id="about-can-title">{copy.aboutCan}</h2>
        <ol className="site-ledger">
          {copy.canItems.map((item, index) => (
            <li key={item}>
              <span className="site-index">{String(index + 1).padStart(2, '0')}</span>
              <p>{item}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="site-section" id="about-examples" aria-labelledby="about-examples-title">
        <h2 id="about-examples-title">{copy.examples}</h2>
        <ul className="site-notes">
          {copy.exampleItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="site-section" id="about-controls" aria-labelledby="about-controls-title">
        <h2 id="about-controls-title">{copy.operation}</h2>
        <div className="site-controls" data-input={touch ? 'touch' : 'pointer'}>
          <h3>{controlsTitle}</h3>
          <ul>
            {controls.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="site-section site-faq" id="faq" aria-labelledby="about-faq-title">
        <h2 id="about-faq-title">{copy.faq}</h2>
        <div className="site-faq-list">
          <div className="site-faq-item">
            <h3>{copy.faqQuestion}</h3>
            <p>{copy.faqAnswer}</p>
            <p>
              <a href={FAQ_URL} target="_blank" rel="noreferrer">
                {copy.faqLinkLabel}
              </a>
            </p>
          </div>
          <div className="site-faq-item">
            <h3>{copy.faqViewQuestion}</h3>
            <p>{copy.faqViewAnswer}</p>
            <p>
              <a href={HTML_IN_CANVAS_URL} target="_blank" rel="noreferrer">
                {copy.faqViewLinkLabel}
              </a>
            </p>
          </div>
        </div>
      </section>

      <CreatorSection title={copy.creatorTitle} name={copy.creatorName} copy={getCopy(language)} />

      <SiteFooter copy={copy} />

      <div className="about-dock">
        <a className="site-button site-button-primary" href="/">
          {copy.heroButton}
        </a>
        <a className="site-button" href="/tutorial">
          {copy.heroTutorial}
        </a>
      </div>
    </>
  );

  const attributes = { 'data-hero': native ? 'native' : 'plain', 'data-primary-input': touch ? 'touch' : 'pointer' };

  if (native) {
    return (
      <TerrainStage scene={SHOWCASE_SCENE} pageAttributes={attributes} onUnavailable={onUnavailable}>
        {content}
      </TerrainStage>
    );
  }
  return <PlainPage attributes={attributes}>{content}</PlainPage>;
}

/** Without HTML-in-Canvas the page lies on the GSI pale map, and the map scrolls away with it. */
function PlainPage({ attributes, children }: { attributes: Record<string, string>; children: React.ReactNode }) {
  const pageRef = useRef<HTMLElement | null>(null);
  const [height, setHeight] = useState(1600);
  const [mapHeight, setMapHeight] = useState(1600);
  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    // The map is exactly as tall as the page's own content, so it never makes the page scroll past the bottom bar.
    // (The page's scroll height can't be used: it includes the map itself.) The map's picture is rounded up,
    // so it is not rebuilt on every small change.
    const measure = () => {
      const footer = page.querySelector<HTMLElement>('.site-footer');
      const dock = page.querySelector<HTMLElement>('.about-dock');
      const content = footer ? footer.offsetTop + footer.offsetHeight + (dock?.offsetHeight ?? 0) : page.scrollHeight;
      setHeight(content);
      setMapHeight(Math.min(6144, Math.ceil(content / 256) * 256));
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(page);
    for (const child of Array.from(page.children)) observer?.observe(child);
    return () => observer?.disconnect();
  }, []);
  return (
    <main ref={pageRef} className="site-page about-page" {...attributes}>
      <div className="about-bg" aria-hidden="true" style={{ height }}>
        <SceneMap scene={SHOWCASE_SCENE} width={2304} height={mapHeight} layer="pale" focusY={420} />
      </div>
      {children}
    </main>
  );
}
