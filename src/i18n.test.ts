import { afterEach, describe, expect, it } from 'vitest';

import { detectLanguage, getCopy } from './i18n';

const originalLanguages = navigator.languages;

afterEach(() => {
  window.history.replaceState(null, '', '/');
  Object.defineProperty(navigator, 'languages', {
    configurable: true,
    value: originalLanguages,
  });
});

describe('browser language copy', () => {
  it('uses Japanese when Japanese is one of the preferred languages', () => {
    Object.defineProperty(navigator, 'languages', { configurable: true, value: ['en-US', 'ja-JP'] });

    expect(detectLanguage()).toBe('ja');
    expect(getCopy('ja').ui.raise).toBe('起こす');
    expect(getCopy('ja').ui.standardMap).toBe('標準');
    expect(getCopy('ja').ui.paleMap).toBe('淡色');
    expect(getCopy('ja').ui.blankMap).toBe('白地図');
    expect(getCopy('ja').ui.photoNames).toBe('写真+地名');
    expect(getCopy('ja').ui.mapLoading).toBe('地図を読み込み中');
  });

  it('uses English for non-Japanese browser languages', () => {
    Object.defineProperty(navigator, 'languages', { configurable: true, value: ['en-US'] });

    expect(detectLanguage()).toBe('en');
    expect(getCopy('en').ui.addWaypoint).toBe('Add waypoint');
    expect(getCopy('en').ui.standardMap).toBe('Standard');
    expect(getCopy('en').ui.paleMap).toBe('Pale');
    expect(getCopy('en').ui.blankMap).toBe('Blank');
    expect(getCopy('en').ui.photoNames).toBe('Aerial + names');
    expect(getCopy('en').ui.mapLoading).toBe('Loading map');
    expect(getCopy('en').dateLabel('2026-11-22')).toBe('November 22, 2026 (Sun)');
  });

  it('lets lang query parameters override the browser language', () => {
    Object.defineProperty(navigator, 'languages', { configurable: true, value: ['ja-JP'] });
    window.history.replaceState(null, '', '/?lang=en');
    expect(detectLanguage()).toBe('en');

    window.history.replaceState(null, '', '/?lang=ja');
    expect(detectLanguage()).toBe('ja');
  });
});
