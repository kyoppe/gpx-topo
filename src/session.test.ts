import { beforeEach, describe, expect, it } from 'vitest';
import { loadStart, saveStart, startNow } from './session';

describe('session', () => {
  beforeEach(() => localStorage.clear());

  it('keeps the start for the next visit', () => {
    saveStart({ date: '2026-11-22', time: '06:30' });
    expect(loadStart()).toEqual({ date: '2026-11-22', time: '06:30' });
  });

  it('ignores a start it cannot read', () => {
    localStorage.setItem('gpx-topo:start', '{"date":"tomorrow","time":"6"}');
    expect(loadStart()).toBeNull();
    localStorage.setItem('gpx-topo:start', 'not json');
    expect(loadStart()).toBeNull();
  });

  it('starts a new GPX now, to the minute', () => {
    expect(startNow(new Date(2026, 10, 2, 7, 5, 42))).toEqual({ date: '2026-11-02', time: '07:05' });
  });
});
