import { useEffect, useState } from 'react';

import { detectLanguage } from './i18n';
import { supportsHtmlInCanvas } from './htmlInCanvas';
import { siteCopy } from './siteCopy';

function SiteHeader({ copy }: { copy: ReturnType<typeof siteCopy> }) {
  return (
    <header className="site-header">
      <a className="site-brand" href="/" aria-label={copy.navMap}>
        {copy.footer}
      </a>
      <nav className="site-nav" aria-label="Navigation">
        <a href="/about">{copy.navAbout}</a>
        <a href="/tutorial">{copy.navTutorial}</a>
        <a className="site-nav-map" href="/">
          {copy.navMap}
        </a>
      </nav>
    </header>
  );
}

function usePrimaryTouch() {
  const [touch] = useState(
    () =>
      typeof window !== 'undefined' &&
      (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window),
  );
  return touch;
}

export default function AboutPage() {
  const language = detectLanguage();
  const copy = siteCopy(language);
  const touch = usePrimaryTouch();
  const native = supportsHtmlInCanvas();

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = `${copy.navAbout} - ${copy.footer}`;
  }, [copy.footer, copy.navAbout, language]);

  return (
    <main className={`site-page about-page${native ? ' about-native' : ' about-fallback'}`} data-primary-input={touch ? 'touch' : 'pointer'}>
      <SiteHeader copy={copy} />
      <section className="about-hero" aria-labelledby="about-hero-title">
        <div className="about-hero-scene" data-native-showcase={native ? 'true' : 'false'} aria-hidden="true">
          <div className="about-hero-map">
            <svg className="about-contours" viewBox="0 0 640 440" preserveAspectRatio="none">
              <path d="M-20 350C70 285 95 390 180 310S330 250 390 300s105 70 170-5 100-50 150-100" />
              <path d="M-30 390C80 315 105 425 200 340s130-35 205 20 100 47 160-30 105-35 145-90" />
              <path d="M-10 260c105-35 105 75 205-5s145-60 220 10 95 45 160-15 100-30 150-70" />
              <path d="M70 210c80-15 80 45 150-10s125-50 185 5 85 38 140-18 90-20 125-55" />
              <path d="M190 160c65 15 72 45 125-5s95-48 140-5 73 45 115 0" />
              <path d="M255 105c40 24 78 34 106 0s68-36 104-5 60 38 91 8" />
            </svg>
            <div className="about-hero-sign">
              <strong>{copy.heroTitle}</strong>
              <span>{copy.footer}</span>
            </div>
          </div>
        </div>
        <div className="about-hero-copy">
          <p className="site-eyebrow">{copy.footer}</p>
          <h1 id="about-hero-title">{copy.heroTitle}</h1>
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
      </section>

      <section className="site-section" aria-labelledby="about-can-title">
        <p className="site-eyebrow">{copy.footer}</p>
        <h2 id="about-can-title">{copy.aboutCan}</h2>
        <ul className="site-grid site-grid-five">
          {copy.canItems.map((item, index) => (
            <li key={item} className="site-card">
              <span className="site-card-index">{String(index + 1).padStart(2, '0')}</span>
              <p>{item}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="site-section site-section-muted" aria-labelledby="about-examples-title">
        <p className="site-eyebrow">{copy.footer}</p>
        <h2 id="about-examples-title">{copy.examples}</h2>
        <ul className="site-grid site-grid-four">
          {copy.exampleItems.map((item) => (
            <li key={item} className="site-card site-card-soft">
              <p>{item}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="site-section" aria-labelledby="about-operation-title">
        <p className="site-eyebrow">{copy.footer}</p>
        <h2 id="about-operation-title">{copy.operation}</h2>
        <div className="site-grid site-grid-two">
          <article className={`site-card site-device-card${touch ? ' is-inactive' : ''}`}>
            <h3>{copy.pointerTitle}</h3>
            <ul>
              {copy.pointerItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
          <article className={`site-card site-device-card${touch ? '' : ' is-inactive'}`}>
            <h3>{copy.touchTitle}</h3>
            <ul>
              {copy.touchItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        </div>
      </section>

      <section className="site-section site-faq" aria-labelledby="about-faq-title">
        <p className="site-eyebrow">{copy.footer}</p>
        <h2 id="about-faq-title">{copy.faq}</h2>
        <details open>
          <summary>{copy.faqQuestion}</summary>
          <p>
            {copy.faqAnswer}{' '}
            <a href="https://www.boxhouse120.com/gpx-wallpaper" target="_blank" rel="noreferrer">
              GPX Wallpaper Whatever
            </a>
          </p>
        </details>
      </section>

      <section className="site-cta">
        <h2>{copy.heroTitle}</h2>
        <div className="site-actions">
          <a className="site-button site-button-primary" href="/tutorial">
            {copy.heroTutorial}
          </a>
          <a className="site-button" href="/">
            {copy.navMap}
          </a>
        </div>
      </section>

      <footer className="site-footer">
        <span>{copy.footer}</span>
        <a href="/">{copy.navMap}</a>
      </footer>
    </main>
  );
}
