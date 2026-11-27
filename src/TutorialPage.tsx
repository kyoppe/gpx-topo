import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import BrushSelection from './BrushSelection';
import { supportsHtmlInCanvas } from './htmlInCanvas';
import { detectLanguage } from './i18n';
import { SiteFooter, SiteHeader, usePrimaryTouch } from './SiteChrome';
import { siteCopy } from './siteCopy';

/** steps whose controls live in the settings panel, which is a bottom sheet on a narrow screen */
const PANEL_TARGETS = new Set(['search', 'sun', 'progress', 'waypoints']);

export default function TutorialPage() {
  const language = detectLanguage();
  const copy = siteCopy(language);
  const touch = usePrimaryTouch();
  const [stepIndex, setStepIndex] = useState(0);
  // the frame draws itself the way this browser can (the same check the app makes), so the steps follow it
  const native = useMemo(() => supportsHtmlInCanvas(), []);
  const steps = useMemo(
    () =>
      [
        ...copy.mapSteps.map((step) => ({ ...step, flow: copy.tutorialMap })),
        ...copy.gpxSteps.map((step) => ({ ...step, flow: copy.tutorialGpx })),
      ]
        .filter((step) => native || !step.nativeOnly)
        .map((step) => ({ ...step, ...(!native && step.fallback ? step.fallback : {}) })),
    [copy, native],
  );
  const step = steps[stepIndex];
  // whether the frame is showing its settings panel as a bottom sheet with a handle (it tells us)
  const [sheetShown, setSheetShown] = useState(false);
  // a step that works the settings panel starts by opening it when the panel is tucked into a bottom sheet
  const textFor = (item: (typeof steps)[number]) => {
    const openFirst = (text: string) =>
      sheetShown && PANEL_TARGETS.has(item.target) ? copy.tutorialSheetFirst(copy.tutorialTabs[item.target]) + text.replace(/^[A-Z]/, (letter) => letter.toLowerCase()) : text;
    return {
      description:
        item.target === 'pin' ? `${item.description}${language === 'ja' ? '' : ' '}${copy.tutorialPinName(native ? 'native' : sheetShown ? 'sheet' : 'panel')}` : openFirst(item.description),
      gesture: touch ? item.touch : item.pointer,
    };
  };
  const last = stepIndex === steps.length - 1;
  // The frame is loaded once, on the first step. Later steps are sent to it, so the real screen
  // carries on from where it was instead of starting over.
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [frameSrc] = useState(() => {
    const first = steps[0];
    return `/?tutorial=${first.appMode}&step=0&target=${first.target}&lang=${language}`;
  });
  const sendStep = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage(
      { type: 'gpx-topo-tutorial', step: stepIndex, target: step.target, mode: step.appMode },
      window.location.origin,
    );
  }, [step.appMode, step.target, stepIndex]);
  useEffect(() => {
    sendStep();
  }, [sendStep]);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frameRef.current?.contentWindow) return;
      if (event.data?.type === 'gpx-topo-tutorial-ready') sendStep();
      if (event.data?.type === 'gpx-topo-tutorial-sheet') setSheetShown(Boolean(event.data.sheet));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [sendStep]);

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = `${copy.tutorialTitle} - ${copy.footer}`;
  }, [copy.footer, copy.tutorialTitle, language]);

  const restart = () => setStepIndex(0);
  const previous = () => setStepIndex((current) => Math.max(0, current - 1));
  const next = () => setStepIndex((current) => Math.min(steps.length - 1, current + 1));

  return (
    <main className="site-page tutorial-page">
      <BrushSelection />
      <SiteHeader copy={copy} current="tutorial" />

      <section className="tutorial-intro" aria-labelledby="tutorial-title">
        <span className="site-rule" />
        <h1 id="tutorial-title">{copy.tutorialTitle}</h1>
        <p className="site-lead">{copy.tutorialLead}</p>
      </section>

      <section className="tutorial-stage" aria-label={step.title}>
        <div className="tutorial-app-frame">
          <iframe ref={frameRef} title={`${step.flow}: ${step.title}`} src={frameSrc} onLoad={sendStep} />
        </div>
        <aside className="tutorial-caption" aria-live="polite">
          <div className="tutorial-caption-meta">
            <span>{step.flow}</span>
            <span>{copy.step(stepIndex + 1, steps.length)}</span>
          </div>
          {/* Every step's text is laid in the same cell, so the block is as tall as the longest one and the
              buttons below it stay where they are from step to step. */}
          <div className="tutorial-copy">
            {steps.map((item, index) => {
              const text = textFor(item);
              const current = index === stepIndex;
              const Title = current ? 'h2' : 'div';
              return (
                <div key={`${item.flow}-${item.title}`} className="tutorial-copy-item" data-current={current ? '' : undefined} aria-hidden={current ? undefined : true}>
                  <Title className="tutorial-copy-title">{item.title}</Title>
                  <p>{text.description}</p>
                  {text.gesture && <p className="tutorial-gesture">{text.gesture}</p>}
                </div>
              );
            })}
          </div>
          <div className="tutorial-controls">
            <button type="button" onClick={previous} disabled={stepIndex === 0}>
              {copy.previous}
            </button>
            <button type="button" onClick={next} disabled={last}>
              {copy.next}
            </button>
            <button type="button" className="tutorial-restart" onClick={restart}>
              {copy.restart}
            </button>
          </div>
          {last && (
            <a className="site-button site-button-primary tutorial-open" href="/">
              {copy.openMap}
            </a>
          )}
        </aside>
      </section>

      <nav className="tutorial-index" aria-label={copy.tutorialTitle}>
        {[copy.tutorialMap, copy.tutorialGpx].map((flow) => (
          <div key={flow} className="tutorial-index-group">
            <h2>{flow}</h2>
            <ol>
              {steps.map((item, index) =>
                item.flow === flow ? (
                  <li key={`${flow}-${item.title}`}>
                    <button
                      type="button"
                      className={index === stepIndex ? 'is-current' : undefined}
                      aria-current={index === stepIndex ? 'step' : undefined}
                      onClick={() => setStepIndex(index)}
                    >
                      <span className="site-index">{String(index + 1).padStart(2, '0')}</span>
                      {item.title}
                    </button>
                  </li>
                ) : null,
              )}
            </ol>
          </div>
        ))}
      </nav>

      <section className="site-closing" aria-label={copy.openMap}>
        <a className="site-button" href="/about">
          {copy.navAbout}
        </a>
        <a className="site-button site-button-primary" href="/">
          {copy.openMap}
        </a>
      </section>

      <SiteFooter copy={copy} />
    </main>
  );
}
