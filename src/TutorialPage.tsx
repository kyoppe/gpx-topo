import { useEffect, useMemo, useState } from 'react';

import { detectLanguage } from './i18n';
import { siteCopy } from './siteCopy';

export default function TutorialPage() {
  const language = detectLanguage();
  const copy = siteCopy(language);
  const [touch] = useState(
    () =>
      typeof window !== 'undefined' &&
      (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window),
  );
  const [stepIndex, setStepIndex] = useState(0);
  const steps = useMemo(
    () =>
      [...copy.mapSteps, ...copy.gpxSteps].map((step) => ({
        ...step,
        mode: step.appMode === 'map' ? copy.mapMode : copy.gpxMode,
      })),
    [copy],
  );
  const step = steps[stepIndex];

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = `${copy.tutorialTitle} - ${copy.footer}`;
  }, [copy.footer, copy.tutorialTitle, language]);

  const restart = () => setStepIndex(0);
  const previous = () => setStepIndex((current) => Math.max(0, current - 1));
  const next = () => setStepIndex((current) => Math.min(steps.length - 1, current + 1));

  return (
    <main className="site-page tutorial-page">
      <header className="site-header">
        <a className="site-brand" href="/" aria-label={copy.navMap}>
          {copy.footer}
        </a>
        <nav className="site-nav" aria-label="Navigation">
          <a href="/about">{copy.navAbout}</a>
          <a href="/tutorial" aria-current="page">
            {copy.navTutorial}
          </a>
          <a className="site-nav-map" href="/">
            {copy.navMap}
          </a>
        </nav>
      </header>

      <section className="tutorial-intro" aria-labelledby="tutorial-title">
        <p className="site-eyebrow">{copy.footer}</p>
        <h1 id="tutorial-title">{copy.tutorialTitle}</h1>
        <p className="site-lead">{copy.tutorialLead}</p>
      </section>

      <section className="tutorial-stage" aria-label={step.title}>
        <div className="tutorial-app-frame">
          <iframe
            key={`${step.appMode}-${step.target}`}
            title={`${copy.footer} ${step.mode}`}
            src={`/?tutorial=${step.appMode}&step=${stepIndex}&target=${step.target}&lang=${language}`}
          />
        </div>
        <aside className="tutorial-caption">
          <div className="tutorial-caption-meta">
            <span>{step.mode}</span>
            <span>{copy.step(stepIndex + 1, steps.length)}</span>
          </div>
          <h2>{step.title}</h2>
          <p>{step.description}</p>
          <p className="tutorial-gesture">{touch ? step.touch : step.pointer}</p>
          <div className="tutorial-controls">
            <button type="button" onClick={previous} disabled={stepIndex === 0}>
              {copy.previous}
            </button>
            <button type="button" onClick={next} disabled={stepIndex === steps.length - 1}>
              {copy.next}
            </button>
            <button type="button" className="tutorial-restart" onClick={restart}>
              {copy.restart}
            </button>
          </div>
        </aside>
      </section>

      <div className="tutorial-dots" aria-label={copy.tutorialTitle}>
        {steps.map((item, index) => (
          <button
            key={`${item.mode}-${item.title}`}
            type="button"
            className={index === stepIndex ? 'is-current' : undefined}
            aria-label={`${copy.step(index + 1, steps.length)}: ${item.title}`}
            aria-current={index === stepIndex ? 'step' : undefined}
            onClick={() => setStepIndex(index)}
          />
        ))}
      </div>

      <section className="site-cta tutorial-cta">
        <h2>{copy.openMap}</h2>
        <a className="site-button site-button-primary" href="/">
          {copy.navMap}
        </a>
      </section>

      <footer className="site-footer">
        <span>{copy.footer}</span>
        <a href="/about">{copy.navAbout}</a>
      </footer>
    </main>
  );
}
