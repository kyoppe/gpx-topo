import type { MapStyle } from './basemap';

export type MapPermalinkView = 'flat' | '3d';
export type MapPermalinkSun = 'auto' | 'off' | 'time' | null;
export type MapPermalinkSunSpeed = 'slow' | 'normal' | 'fast';
export type MapPermalinkPin = { lat: number; lon: number; label: string };
export type MapPermalinkPan = { x: number; y: number; z: number };

export type MapPermalink = {
  center: { lat: number; lon: number } | null;
  view: MapPermalinkView;
  bearing: number | null;
  pitch: number | null;
  zoom: number | null;
  pan: MapPermalinkPan | null;
  date: string | null;
  mapStyle: MapStyle | null;
  hillshade: boolean | null;
  pin: MapPermalinkPin | null;
  sun: MapPermalinkSun;
  sunSpeed: MapPermalinkSunSpeed;
  timeMinutes: number | null;
  usedParameters: string[];
  ignoredParameters: string[];
};

export type MapPermalinkBuildState = {
  center: { lat: number; lon: number };
  view: MapPermalinkView;
  bearing: number;
  pitch: number;
  zoom: number;
  pan?: MapPermalinkPan | null;
  date: string | null;
  mapStyle: MapStyle;
  hillshade: boolean;
  pin: MapPermalinkPin | null;
  sunlight: boolean;
  sunAuto: boolean;
  sunSpeed: MapPermalinkSunSpeed;
  timeMinutes: number;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^(\d{1,2}):(\d{2})$/;
const KNOWN_PARAMETERS = new Set([
  'mode',
  'lat',
  'lon',
  'view',
  'bearing',
  'pitch',
  'zoom',
  'pan_x',
  'pan_y',
  'pan_z',
  'date',
  'style',
  'hillshade',
  'pin_lat',
  'pin_lon',
  'pin_label',
  'sun',
  'sun_speed',
  'time',
]);

function numberParameter(params: URLSearchParams, name: string, min: number, max: number) {
  const raw = params.get(name);
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= min && value <= max ? value : undefined;
}

function validDate(value: string | null) {
  if (!value || !DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function timeMinutes(value: string | null) {
  if (!value) return null;
  const match = CLOCK.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 ? hours * 60 + minutes : null;
}

function degrees(value: number) {
  return ((value % 360) + 360) % 360;
}

function fixed(value: number, digits: number) {
  return Number(value.toFixed(digits));
}

function clock(value: number) {
  const minutes = Math.max(0, Math.min(1439, Math.round(value)));
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function parseMapPermalink(search: string): MapPermalink | null {
  const params = new URLSearchParams(search);
  if (params.get('mode') !== 'map') return null;

  const usedParameters = ['mode'];
  const ignoredParameters: string[] = [];
  const lat = numberParameter(params, 'lat', -85.05112878, 85.05112878);
  const lon = numberParameter(params, 'lon', -180, 180);
  const center =
    lat !== null &&
    lon !== null &&
    lat !== undefined &&
    lon !== undefined
      ? { lat, lon }
      : null;
  if (params.has('lat') && lat === undefined) ignoredParameters.push('lat');
  if (params.has('lon') && lon === undefined) ignoredParameters.push('lon');
  if (center) usedParameters.push('lat', 'lon');

  const viewValue = params.get('view');
  const view: MapPermalinkView = viewValue === '3d' ? '3d' : 'flat';
  if (viewValue === 'flat' || viewValue === '3d') usedParameters.push('view');
  else if (viewValue !== null) ignoredParameters.push('view');

  const bearingValue = numberParameter(params, 'bearing', -1_000_000, 1_000_000);
  const pitchValue = numberParameter(params, 'pitch', 0, 89.9);
  const zoomValue = numberParameter(params, 'zoom', 0.01, 64);
  const bearing = bearingValue === null || bearingValue === undefined ? null : degrees(bearingValue);
  const pitch = pitchValue === null || pitchValue === undefined ? null : pitchValue;
  const zoom = zoomValue === null || zoomValue === undefined ? null : zoomValue;
  if (view === '3d') {
    if (bearing !== null) usedParameters.push('bearing');
    if (pitch !== null) usedParameters.push('pitch');
    if (zoom !== null) usedParameters.push('zoom');
  } else {
    if (params.has('bearing')) ignoredParameters.push('bearing');
    if (params.has('pitch')) ignoredParameters.push('pitch');
    if (params.has('zoom')) ignoredParameters.push('zoom');
  }
  if (view === '3d') {
    if (params.has('bearing') && bearingValue === undefined) ignoredParameters.push('bearing');
    if (params.has('pitch') && pitchValue === undefined) ignoredParameters.push('pitch');
    if (params.has('zoom') && zoomValue === undefined) ignoredParameters.push('zoom');
  }
  const panXValue = numberParameter(params, 'pan_x', -100_000, 100_000);
  const panYValue = numberParameter(params, 'pan_y', -100_000, 100_000);
  const panZValue = numberParameter(params, 'pan_z', -100_000, 100_000);
  const pan =
    view === '3d' &&
    panXValue !== null &&
    panXValue !== undefined &&
    panYValue !== null &&
    panYValue !== undefined &&
    panZValue !== null &&
    panZValue !== undefined
      ? { x: panXValue, y: panYValue, z: panZValue }
      : null;
  if (pan) usedParameters.push('pan_x', 'pan_y', 'pan_z');
  else if (view === '3d') {
    if (params.has('pan_x')) ignoredParameters.push('pan_x');
    if (params.has('pan_y')) ignoredParameters.push('pan_y');
    if (params.has('pan_z')) ignoredParameters.push('pan_z');
  } else {
    if (params.has('pan_x')) ignoredParameters.push('pan_x');
    if (params.has('pan_y')) ignoredParameters.push('pan_y');
    if (params.has('pan_z')) ignoredParameters.push('pan_z');
  }

  const dateValue = params.get('date');
  const date = validDate(dateValue) ? dateValue : null;
  if (date) usedParameters.push('date');
  else if (dateValue !== null) ignoredParameters.push('date');

  const styleValue = params.get('style');
  const mapStyle: MapStyle | null =
    styleValue === 'std' || styleValue === 'pale' || styleValue === 'photo' || styleValue === 'photoNames' ? styleValue : null;
  if (mapStyle) usedParameters.push('style');
  else if (styleValue !== null) ignoredParameters.push('style');

  const hillshadeValue = params.get('hillshade');
  const hillshade = hillshadeValue === 'on' ? true : hillshadeValue === 'off' ? false : null;
  if (hillshade !== null) usedParameters.push('hillshade');
  else if (hillshadeValue !== null) ignoredParameters.push('hillshade');

  const pinLat = numberParameter(params, 'pin_lat', -85.05112878, 85.05112878);
  const pinLon = numberParameter(params, 'pin_lon', -180, 180);
  const pin =
    pinLat !== null &&
    pinLat !== undefined &&
    pinLon !== null &&
    pinLon !== undefined
      ? { lat: pinLat, lon: pinLon, label: params.get('pin_label') ?? '' }
      : null;
  if (pin) {
    usedParameters.push('pin_lat', 'pin_lon');
    if (params.has('pin_label')) usedParameters.push('pin_label');
  } else {
    if (params.has('pin_lat')) ignoredParameters.push('pin_lat');
    if (params.has('pin_lon')) ignoredParameters.push('pin_lon');
    if (params.has('pin_label')) ignoredParameters.push('pin_label');
  }

  const sunValue = params.get('sun');
  let sun: MapPermalinkSun = null;
  let time = timeMinutes(params.get('time'));
  if (sunValue === 'auto') {
    sun = 'auto';
    usedParameters.push('sun');
    if (params.has('time')) ignoredParameters.push('time');
    time = null;
  } else if (sunValue === 'off') {
    sun = 'off';
    usedParameters.push('sun');
    if (params.has('time')) ignoredParameters.push('time');
    time = null;
  } else if (sunValue !== null) {
    ignoredParameters.push('sun');
  } else if (time !== null) {
    sun = 'time';
    usedParameters.push('time');
  } else if (params.has('time')) {
    ignoredParameters.push('time');
  }

  const sunSpeedValue = params.get('sun_speed');
  const sunSpeed: MapPermalinkSunSpeed =
    sun === 'auto' && (sunSpeedValue === 'slow' || sunSpeedValue === 'normal' || sunSpeedValue === 'fast') ? sunSpeedValue : 'normal';
  if (sunSpeedValue !== null) {
    if (sun === 'auto' && (sunSpeedValue === 'slow' || sunSpeedValue === 'normal' || sunSpeedValue === 'fast')) {
      usedParameters.push('sun_speed');
    } else {
      ignoredParameters.push('sun_speed');
    }
  }

  for (const key of params.keys()) {
    if (!KNOWN_PARAMETERS.has(key) && key !== 'lang') ignoredParameters.push(key);
  }

  return {
    center,
    view,
    bearing,
    pitch,
    zoom,
    pan,
    date,
    mapStyle,
    hillshade,
    pin,
    sun,
    sunSpeed,
    timeMinutes: time,
    usedParameters: [...new Set(usedParameters)],
    ignoredParameters: [...new Set(ignoredParameters)],
  };
}

export function buildMapPermalink(state: MapPermalinkBuildState, baseUrl: string) {
  const url = new URL(baseUrl);
  url.search = '';
  url.hash = '';
  const params = new URLSearchParams({
    mode: 'map',
    lat: state.center.lat.toFixed(6),
    lon: state.center.lon.toFixed(6),
    style: state.mapStyle,
    hillshade: state.hillshade ? 'on' : 'off',
  });
  if (state.date) params.set('date', state.date);
  params.set('view', state.view);
  if (state.pin) {
    params.set('pin_lat', state.pin.lat.toFixed(6));
    params.set('pin_lon', state.pin.lon.toFixed(6));
    if (state.pin.label.trim()) params.set('pin_label', state.pin.label.trim());
  }
  if (state.view === '3d') {
    params.set('bearing', fixed(degrees(state.bearing), 2).toFixed(2));
    params.set('pitch', fixed(Math.max(0, Math.min(89.9, state.pitch)), 2).toFixed(2));
    params.set('zoom', fixed(Math.max(0.01, state.zoom), 3).toFixed(3));
    if (state.pan) {
      params.set('pan_x', fixed(state.pan.x, 3).toFixed(3));
      params.set('pan_y', fixed(state.pan.y, 3).toFixed(3));
      params.set('pan_z', fixed(state.pan.z, 3).toFixed(3));
    }
  }
  if (!state.sunlight) params.set('sun', 'off');
  else if (state.sunAuto) {
    params.set('sun', 'auto');
    if (state.sunSpeed !== 'normal') params.set('sun_speed', state.sunSpeed);
  }
  else params.set('time', clock(state.timeMinutes));
  url.search = params.toString();
  return url.toString();
}
