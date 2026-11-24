import { describe, expect, it } from 'vitest';

import {
  buildMapPermalink,
  fitPermalinkArea,
  MAP_PERMALINK_PARAMETERS,
  parseMapPermalink,
  scalePermalinkPan,
  stripMapPermalinkParameters,
} from './mapPermalink';

describe('stripMapPermalinkParameters', () => {
  it('removes every permalink parameter, including the display area, and keeps the rest', () => {
    const params = new URLSearchParams('lang=en&foo=bar');
    for (const name of MAP_PERMALINK_PARAMETERS) params.set(name, '1');
    stripMapPermalinkParameters(params);
    expect([...params.keys()].sort()).toEqual(['foo', 'lang']);
  });

  it('covers the display area and sun speed parameters', () => {
    for (const name of ['area_w', 'area_h', 'area_scale', 'sun_speed']) {
      expect(MAP_PERMALINK_PARAMETERS).toContain(name);
    }
  });

  it('leaves no used parameter behind after stripping a generated permalink', () => {
    const url = buildMapPermalink(
      {
        center: { lat: 35.36, lon: 138.72 },
        view: '3d',
        bearing: 20,
        pitch: 45,
        zoom: 1.4,
        pan: { x: 30, y: -40, z: 0 },
        date: '2026-11-24',
        mapStyle: 'pale',
        hillshade: true,
        pin: { lat: 35.36, lon: 138.72, label: 'Summit' },
        fpv: { lat: 35.36, lon: 138.72, bearing: 10, pitch: 5, zoom: 1.5 },
        area: { width: 292, height: 456, scale: 2691.35 },
        sunlight: true,
        sunAuto: true,
        sunSpeed: 'fast',
        timeMinutes: 630,
      },
      'https://example.test/?lang=ja',
    );
    const params = new URL(url).searchParams;
    expect(params.has('area_w')).toBe(true);
    expect(params.has('sun_speed')).toBe(true);
    stripMapPermalinkParameters(params);
    expect([...params.keys()]).toEqual([]);
  });
});

describe('parseMapPermalink', () => {
  it('parses a flat map permalink and keeps the date optional', () => {
    expect(parseMapPermalink('?mode=map&lat=35.681236&lon=139.767125&view=flat&time=18%3A30')).toMatchObject({
      center: { lat: 35.681236, lon: 139.767125 },
      view: 'flat',
      date: null,
      sun: 'time',
      timeMinutes: 1110,
    });
  });

  it('parses 3D camera parameters and normalizes bearing', () => {
    expect(
      parseMapPermalink(
        '?mode=map&view=3d&bearing=-30&pitch=42&zoom=1.8&pan_x=12.345&pan_y=-6.7&pan_z=0.25&date=2026-11-24&style=photoNames&hillshade=off&pin_lat=35.68&pin_lon=139.76&pin_label=Summit&sun=auto&sun_speed=fast',
      ),
    ).toMatchObject({
      view: '3d',
      bearing: 330,
      pitch: 42,
      zoom: 1.8,
      pan: { x: 12.345, y: -6.7, z: 0.25 },
      date: '2026-11-24',
      mapStyle: 'photoNames',
      hillshade: false,
      pin: { lat: 35.68, lon: 139.76, label: 'Summit' },
      sun: 'auto',
      sunSpeed: 'fast',
      timeMinutes: null,
    });
  });

  it('ignores 3D parameters in a flat view and lets auto sunlight win over time', () => {
    const result = parseMapPermalink('?mode=map&view=flat&bearing=12&zoom=2&sun=auto&time=18%3A30');

    expect(result).toMatchObject({ view: 'flat', sun: 'auto', timeMinutes: null });
    expect(result?.ignoredParameters).toEqual(expect.arrayContaining(['bearing', 'zoom', 'time']));
  });

  it('detects FPV from the fpv parameters without requiring a view parameter', () => {
    expect(
      parseMapPermalink(
        '?mode=map&lat=35.68&lon=139.76&fpv_lat=35.681236&fpv_lon=139.767125&fpv_bearing=-30&fpv_pitch=12&fpv_zoom=1.8',
      ),
    ).toMatchObject({
      view: 'fpv',
      fpv: { lat: 35.681236, lon: 139.767125, bearing: 330, pitch: 12, zoom: 1.8 },
    });
  });

  it('keeps the underlying 3D camera parameters when FPV is active', () => {
    expect(
      parseMapPermalink(
        '?mode=map&bearing=42&pitch=31&zoom=2.2&pan_x=1&pan_y=-2&pan_z=3&fpv_lat=35.681236&fpv_lon=139.767125&fpv_bearing=90&fpv_pitch=-5&fpv_zoom=1.4',
      ),
    ).toMatchObject({
      view: 'fpv',
      bearing: 42,
      pitch: 31,
      zoom: 2.2,
      pan: { x: 1, y: -2, z: 3 },
    });
  });

  it('accepts the legacy wrapped negative FPV pitch from an existing permalink', () => {
    expect(
      parseMapPermalink(
        '?mode=map&lat=35.68&lon=139.76&fpv_lat=35.681236&fpv_lon=139.767125&fpv_bearing=152.69&fpv_pitch=335.42&fpv_zoom=1',
      ),
    ).toMatchObject({
      view: 'fpv',
      fpv: { bearing: 152.69, pitch: -24.58, zoom: 1 },
    });
  });

  it('builds a reproducible 3D permalink without language parameters', () => {
    const url = buildMapPermalink(
      {
        center: { lat: 35.6812364, lon: 139.7671254 },
        view: '3d',
        bearing: 35.1234,
        pitch: 42.5678,
        zoom: 1.8,
        pan: { x: 12.3456, y: -6.7, z: 0.25 },
        date: '2026-11-24',
        mapStyle: 'pale',
        hillshade: true,
        pin: { lat: 35.68, lon: 139.76, label: 'Summit' },
        sunlight: true,
        sunAuto: false,
        sunSpeed: 'normal',
        timeMinutes: 1110,
      },
      'https://example.test/?lang=ja',
    );

    expect(url).toBe(
      'https://example.test/?mode=map&lat=35.681236&lon=139.767125&style=pale&hillshade=on&date=2026-11-24&view=3d&pin_lat=35.680000&pin_lon=139.760000&pin_label=Summit&bearing=35.12&pitch=42.57&zoom=1.800&pan_x=12.346&pan_y=-6.700&pan_z=0.250&time=18%3A30',
    );
  });

  it('omits the date when it was not explicitly selected', () => {
    const url = buildMapPermalink(
      {
        center: { lat: 35.681236, lon: 139.767125 },
        view: 'flat',
        bearing: 0,
        pitch: 0,
        zoom: 1,
        date: null,
        mapStyle: 'pale',
        hillshade: true,
        pin: null,
        sunlight: true,
        sunAuto: false,
        sunSpeed: 'normal',
        timeMinutes: 630,
      },
      'https://example.test/',
    );

    expect(url).toBe('https://example.test/?mode=map&lat=35.681236&lon=139.767125&style=pale&hillshade=on&view=flat&time=10%3A30');
  });

  it('builds an FPV permalink without a view parameter', () => {
    const url = buildMapPermalink(
      {
        center: { lat: 35.681236, lon: 139.767125 },
        view: 'fpv',
        bearing: 0,
        pitch: 0,
        zoom: 1,
        date: null,
        mapStyle: 'pale',
        hillshade: true,
        pin: null,
        fpv: { lat: 35.68, lon: 139.76, bearing: 330.1234, pitch: 12.5678, zoom: 1.8 },
        sunlight: true,
        sunAuto: false,
        sunSpeed: 'normal',
        timeMinutes: 630,
      },
      'https://example.test/?view=flat',
    );

    expect(url).toBe(
      'https://example.test/?mode=map&lat=35.681236&lon=139.767125&style=pale&hillshade=on&bearing=0.00&pitch=0.00&zoom=1.000&fpv_lat=35.680000&fpv_lon=139.760000&fpv_bearing=330.12&fpv_pitch=12.57&fpv_zoom=1.800&time=10%3A30',
    );
    expect(url).not.toContain('view=');
  });

  it('accepts normal auto sunlight speed and ignores it outside auto mode', () => {
    expect(parseMapPermalink('?mode=map&sun=auto&sun_speed=normal')).toMatchObject({
      sun: 'auto',
      sunSpeed: 'normal',
    });
    expect(parseMapPermalink('?mode=map&sun=off&sun_speed=fast')).toMatchObject({
      sun: 'off',
      sunSpeed: 'normal',
    });
    expect(parseMapPermalink('?mode=map&sun=off&sun_speed=fast')?.ignoredParameters).toContain('sun_speed');
  });

  it('emits non-default auto sunlight speed and omits normal speed', () => {
    const fast = buildMapPermalink(
      {
        center: { lat: 35.681236, lon: 139.767125 },
        view: '3d',
        bearing: 0,
        pitch: 45,
        zoom: 2,
        date: null,
        mapStyle: 'pale',
        hillshade: true,
        pin: null,
        sunlight: true,
        sunAuto: true,
        sunSpeed: 'fast',
        timeMinutes: 630,
      },
      'https://example.test/',
    );
    expect(fast).toContain('&sun=auto&sun_speed=fast');

    const normal = buildMapPermalink(
      {
        center: { lat: 35.681236, lon: 139.767125 },
        view: '3d',
        bearing: 0,
        pitch: 45,
        zoom: 2,
        date: null,
        mapStyle: 'pale',
        hillshade: true,
        pin: null,
        sunlight: true,
        sunAuto: true,
        sunSpeed: 'normal',
        timeMinutes: 630,
      },
      'https://example.test/',
    );
    expect(normal).toContain('&sun=auto');
    expect(normal).not.toContain('sun_speed=');
  });
});

describe('the display area of a permalink', () => {
  const base = '?mode=map&lat=35.68&lon=139.76&view=3d&zoom=1.5&pan_x=10&pan_y=-20&pan_z=2';

  it('reads the frame size and the ground scale together with the centre', () => {
    const result = parseMapPermalink(`${base}&area_w=1000&area_h=640&area_scale=52428.8`);
    expect(result?.area).toEqual({ width: 1000, height: 640, scale: 52428.8 });
    expect(result?.usedParameters).toEqual(expect.arrayContaining(['area_w', 'area_h', 'area_scale']));
  });

  it('needs all three, and a centre, or ignores them', () => {
    const partial = parseMapPermalink(`${base}&area_w=1000&area_h=640`);
    expect(partial?.area).toBeNull();
    expect(partial?.ignoredParameters).toEqual(expect.arrayContaining(['area_w', 'area_h']));
    const noCentre = parseMapPermalink('?mode=map&area_w=1000&area_h=640&area_scale=500');
    expect(noCentre?.area).toBeNull();
    expect(noCentre?.ignoredParameters).toEqual(expect.arrayContaining(['area_w', 'area_h', 'area_scale']));
    expect(parseMapPermalink(`${base}&area_w=0&area_h=640&area_scale=500`)?.area).toBeNull();
  });

  it('leaves an old permalink (no area) as it was', () => {
    expect(parseMapPermalink(base)?.area).toBeNull();
  });

  it('writes the area in a built permalink, rounded, and round-trips it', () => {
    const url = buildMapPermalink(
      {
        center: { lat: 35.68, lon: 139.76 },
        view: 'flat',
        bearing: 0,
        pitch: 0,
        zoom: 1,
        date: null,
        mapStyle: 'pale',
        hillshade: true,
        pin: null,
        area: { width: 1000.4, height: 639.6, scale: 52428.80000001 },
        sunlight: true,
        sunAuto: false,
        sunSpeed: 'normal',
        timeMinutes: 630,
      },
      'https://example.test/',
    );
    const params = new URL(url).searchParams;
    expect(params.get('area_w')).toBe('1000');
    expect(params.get('area_h')).toBe('640');
    expect(params.get('area_scale')).toBe('52428.8');
    expect(parseMapPermalink(new URL(url).search)?.area).toEqual({ width: 1000, height: 640, scale: 52428.8 });
  });

  it('omits the area when there is none', () => {
    const url = buildMapPermalink(
      {
        center: { lat: 35.68, lon: 139.76 },
        view: 'flat',
        bearing: 0,
        pitch: 0,
        zoom: 1,
        date: null,
        mapStyle: 'pale',
        hillshade: true,
        pin: null,
        sunlight: true,
        sunAuto: false,
        sunSpeed: 'normal',
        timeMinutes: 630,
      },
      'https://example.test/',
    );
    expect(new URL(url).searchParams.has('area_w')).toBe(false);
  });
});

describe('fitPermalinkArea', () => {
  const area = { width: 1000, height: 600, scale: 1000 };

  it('keeps the saved area whole in a taller, narrower frame: the width decides', () => {
    // a phone frame 400 x 800: the width is 0.4 of the saved one, the height would allow 1.33
    const fit = fitPermalinkArea(area, 400, 800);
    expect(fit.ratio).toBeCloseTo(0.4);
    expect(fit.scale).toBeCloseTo(400);
  });

  it('keeps it whole in a wider, shorter frame: the height decides', () => {
    const fit = fitPermalinkArea(area, 2000, 300);
    expect(fit.ratio).toBeCloseTo(0.5);
    expect(fit.scale).toBeCloseTo(500);
  });

  it('is the same scale for the same frame', () => {
    expect(fitPermalinkArea(area, 1000, 600)).toEqual({ scale: 1000, ratio: 1 });
  });

  it('keeps the scale in range', () => {
    expect(fitPermalinkArea({ width: 1000, height: 600, scale: 1 }, 1, 1).scale).toBeGreaterThanOrEqual(1e-3);
  });
});

describe('scalePermalinkPan', () => {
  it('multiplies the pan on every axis', () => {
    expect(scalePermalinkPan({ x: 10, y: -20, z: 2 }, 0.4)).toEqual({ x: 4, y: -8, z: 0.8 });
  });
});
