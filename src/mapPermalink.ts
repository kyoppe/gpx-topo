import type { MapStyle } from './basemap';

export type MapPermalinkView = 'flat' | '3d' | 'fpv';
export type MapPermalinkSun = 'auto' | 'off' | 'time' | null;
export type MapPermalinkSunSpeed = 'slow' | 'normal' | 'fast';
export type MapPermalinkCoordinate = { lat: number; lon: number };
export type MapPermalinkPin = { lat: number; lon: number; label: string };
export type MapPermalinkPan = { x: number; y: number; z: number };

/** What a pin's name may hold: at most 2 lines and 40 characters, whether it was typed or came in a permalink. */
export function normalizeMapPinLabel(label: string) {
  return label.replace(/\r\n/g, '\n').split('\n').slice(0, 2).join('\n').slice(0, 40);
}
export type MapPermalinkFocus = MapPermalinkCoordinate;
/**
 * The display area the permalink was made in, in screen px at zoom 1: the map frame's size and its ground scale
 * (px per world unit). When it is there, `pan` is also in those units, taken from the map centre (see `permalinkView`).
 */
export type MapPermalinkArea = { width: number; height: number; scale: number };
export type MapPermalinkFpv = { lat: number; lon: number; bearing: number; pitch: number; zoom: number };

export type MapPermalink = {
  center: { lat: number; lon: number } | null;
  view: MapPermalinkView;
  bearing: number | null;
  pitch: number | null;
  zoom: number | null;
  pan: MapPermalinkPan | null;
  focus: MapPermalinkFocus | null;
  date: string | null;
  mapStyle: MapStyle | null;
  hillshade: boolean | null;
  pin: MapPermalinkPin | null;
  currentPin: MapPermalinkCoordinate | null;
  fpv: MapPermalinkFpv | null;
  area: MapPermalinkArea | null;
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
  focus?: MapPermalinkFocus | null;
  date: string | null;
  mapStyle: MapStyle;
  hillshade: boolean;
  pin: MapPermalinkPin | null;
  currentPin: MapPermalinkCoordinate | null;
  fpv?: MapPermalinkFpv | null;
  area?: MapPermalinkArea | null;
  sunlight: boolean;
  sunAuto: boolean;
  sunSpeed: MapPermalinkSunSpeed;
  timeMinutes: number;
};

const AREA_MIN_SIZE = 16;
const AREA_MAX_SIZE = 100_000;
const AREA_MIN_SCALE = 1e-3;
const AREA_MAX_SCALE = 2 ** 30;
/** The largest latitude that remains inside the Web Mercator range after six-decimal serialization. */
const SERIALIZED_MAP_LATITUDE_LIMIT = 85.051128;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^(\d{1,2}):(\d{2})$/;
/** Every query parameter a map permalink can carry (`lang` and unrelated parameters are not part of it). */
export const MAP_PERMALINK_PARAMETERS = [
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
  'focus_lat',
  'focus_lon',
  'date',
  'style',
  'hillshade',
  'pin_lat',
  'pin_lon',
  'pin_label',
  'current_pin_lat',
  'current_pin_lon',
  'fpv_lat',
  'fpv_lon',
  'fpv_bearing',
  'fpv_pitch',
  'fpv_zoom',
  'area_w',
  'area_h',
  'area_scale',
  'sun',
  'sun_speed',
  'time',
] as const;

const KNOWN_PARAMETERS = new Set<string>(MAP_PERMALINK_PARAMETERS);

/** Remove all map permalink parameters from `params`, keeping everything else (such as `lang`). */
export function stripMapPermalinkParameters(params: URLSearchParams) {
  for (const name of MAP_PERMALINK_PARAMETERS) params.delete(name);
}

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

function signedDegrees(value: number) {
  return fixed(((value + 180) % 360 + 360) % 360 - 180, 6);
}

function fixed(value: number, digits: number) {
  return Number(value.toFixed(digits));
}

function mapLatitude(value: number) {
  return Math.max(-SERIALIZED_MAP_LATITUDE_LIMIT, Math.min(SERIALIZED_MAP_LATITUDE_LIMIT, value)).toFixed(6);
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

  const fpvLatValue = numberParameter(params, 'fpv_lat', -85.05112878, 85.05112878);
  const fpvLonValue = numberParameter(params, 'fpv_lon', -180, 180);
  const fpvBearingValue = numberParameter(params, 'fpv_bearing', -1_000_000, 1_000_000);
  const fpvPitchValue = numberParameter(params, 'fpv_pitch', -360, 360);
  const fpvPitch = fpvPitchValue === null || fpvPitchValue === undefined ? fpvPitchValue : signedDegrees(fpvPitchValue);
  const fpvZoomValue = numberParameter(params, 'fpv_zoom', 0.01, 64);
  const fpv =
    fpvLatValue !== null &&
    fpvLatValue !== undefined &&
    fpvLonValue !== null &&
    fpvLonValue !== undefined &&
    fpvBearingValue !== null &&
    fpvBearingValue !== undefined &&
    fpvPitch !== null &&
    fpvPitch !== undefined &&
    fpvPitch >= -89.9 &&
    fpvPitch <= 89.9 &&
    fpvZoomValue !== null &&
    fpvZoomValue !== undefined
      ? {
          lat: fpvLatValue,
          lon: fpvLonValue,
          bearing: fixed(degrees(fpvBearingValue), 6),
          pitch: fpvPitch,
          zoom: fpvZoomValue,
        }
      : null;
  const fpvParameters = ['fpv_lat', 'fpv_lon', 'fpv_bearing', 'fpv_pitch', 'fpv_zoom'];
  if (fpv) usedParameters.push(...fpvParameters);
  else for (const name of fpvParameters) if (params.has(name)) ignoredParameters.push(name);

  const viewValue = params.get('view');
  const view: MapPermalinkView = fpv ? 'fpv' : viewValue === '3d' ? '3d' : 'flat';
  if (viewValue === 'flat' || viewValue === '3d') usedParameters.push('view');
  else if (viewValue !== null) ignoredParameters.push('view');

  const bearingValue = numberParameter(params, 'bearing', -1_000_000, 1_000_000);
  const pitchValue = numberParameter(params, 'pitch', 0, 89.9);
  const zoomValue = numberParameter(params, 'zoom', 0.01, 64);
  const bearing = bearingValue === null || bearingValue === undefined ? null : degrees(bearingValue);
  const pitch = pitchValue === null || pitchValue === undefined ? null : pitchValue;
  const zoom = zoomValue === null || zoomValue === undefined ? null : zoomValue;
  if (view === '3d' || view === 'fpv') {
    if (bearing !== null) usedParameters.push('bearing');
    if (pitch !== null) usedParameters.push('pitch');
    if (zoom !== null) usedParameters.push('zoom');
  } else {
    if (params.has('bearing')) ignoredParameters.push('bearing');
    if (params.has('pitch')) ignoredParameters.push('pitch');
    if (params.has('zoom')) ignoredParameters.push('zoom');
  }
  if (view === '3d' || view === 'fpv') {
    if (params.has('bearing') && bearingValue === undefined) ignoredParameters.push('bearing');
    if (params.has('pitch') && pitchValue === undefined) ignoredParameters.push('pitch');
    if (params.has('zoom') && zoomValue === undefined) ignoredParameters.push('zoom');
  }
  const panXValue = numberParameter(params, 'pan_x', -100_000, 100_000);
  const panYValue = numberParameter(params, 'pan_y', -100_000, 100_000);
  const panZValue = numberParameter(params, 'pan_z', -100_000, 100_000);
  const pan =
    (view === '3d' || view === 'fpv') &&
    panXValue !== null &&
    panXValue !== undefined &&
    panYValue !== null &&
    panYValue !== undefined &&
    panZValue !== null &&
    panZValue !== undefined
      ? { x: panXValue, y: panYValue, z: panZValue }
      : null;
  if (pan) usedParameters.push('pan_x', 'pan_y', 'pan_z');
  else if (view === '3d' || view === 'fpv') {
    if (params.has('pan_x')) ignoredParameters.push('pan_x');
    if (params.has('pan_y')) ignoredParameters.push('pan_y');
    if (params.has('pan_z')) ignoredParameters.push('pan_z');
  } else {
    if (params.has('pan_x')) ignoredParameters.push('pan_x');
    if (params.has('pan_y')) ignoredParameters.push('pan_y');
    if (params.has('pan_z')) ignoredParameters.push('pan_z');
  }

  const focusLatValue = numberParameter(params, 'focus_lat', -85.05112878, 85.05112878);
  const focusLonValue = numberParameter(params, 'focus_lon', -180, 180);
  const focus =
    view === '3d' &&
    center &&
    focusLatValue !== null &&
    focusLatValue !== undefined &&
    focusLonValue !== null &&
    focusLonValue !== undefined
      ? { lat: focusLatValue, lon: focusLonValue }
      : null;
  const focusParameters = ['focus_lat', 'focus_lon'];
  if (focus) usedParameters.push(...focusParameters);
  else for (const name of focusParameters) if (params.has(name)) ignoredParameters.push(name);

  const dateValue = params.get('date');
  const date = validDate(dateValue) ? dateValue : null;
  if (date) usedParameters.push('date');
  else if (dateValue !== null) ignoredParameters.push('date');

  const styleValue = params.get('style');
  const mapStyle: MapStyle | null =
    styleValue === 'std' || styleValue === 'pale' || styleValue === 'blank' || styleValue === 'photo' || styleValue === 'photoNames'
      ? styleValue
      : null;
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
      ? { lat: pinLat, lon: pinLon, label: normalizeMapPinLabel(params.get('pin_label') ?? '') }
      : null;
  if (pin) {
    usedParameters.push('pin_lat', 'pin_lon');
    if (params.has('pin_label')) usedParameters.push('pin_label');
  } else {
    if (params.has('pin_lat')) ignoredParameters.push('pin_lat');
    if (params.has('pin_lon')) ignoredParameters.push('pin_lon');
    if (params.has('pin_label')) ignoredParameters.push('pin_label');
  }

  const currentPinLat = numberParameter(params, 'current_pin_lat', -85.05112878, 85.05112878);
  const currentPinLon = numberParameter(params, 'current_pin_lon', -180, 180);
  const currentPin =
    currentPinLat !== null &&
    currentPinLat !== undefined &&
    currentPinLon !== null &&
    currentPinLon !== undefined
      ? { lat: currentPinLat, lon: currentPinLon }
      : null;
  const currentPinParameters = ['current_pin_lat', 'current_pin_lon'];
  if (currentPin) usedParameters.push(...currentPinParameters);
  else for (const name of currentPinParameters) if (params.has(name)) ignoredParameters.push(name);

  const areaWidth = numberParameter(params, 'area_w', AREA_MIN_SIZE, AREA_MAX_SIZE);
  const areaHeight = numberParameter(params, 'area_h', AREA_MIN_SIZE, AREA_MAX_SIZE);
  const areaScale = numberParameter(params, 'area_scale', AREA_MIN_SCALE, AREA_MAX_SCALE);
  const area: MapPermalinkArea | null =
    center && areaWidth != null && areaHeight != null && areaScale != null ? { width: areaWidth, height: areaHeight, scale: areaScale } : null;
  const areaParameters = ['area_w', 'area_h', 'area_scale'];
  if (area) usedParameters.push(...areaParameters);
  else for (const name of areaParameters) if (params.has(name)) ignoredParameters.push(name);

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
    focus,
    date,
    mapStyle,
    hillshade,
    pin,
    currentPin,
    fpv,
    area,
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
    lat: mapLatitude(state.center.lat),
    lon: state.center.lon.toFixed(6),
    style: state.mapStyle,
    hillshade: state.hillshade ? 'on' : 'off',
  });
  if (state.date) params.set('date', state.date);
  if (state.view !== 'fpv') params.set('view', state.view);
  if (state.pin) {
    params.set('pin_lat', mapLatitude(state.pin.lat));
    params.set('pin_lon', state.pin.lon.toFixed(6));
    if (state.pin.label.trim()) params.set('pin_label', state.pin.label.trim());
  }
  if (state.currentPin) {
    params.set('current_pin_lat', mapLatitude(state.currentPin.lat));
    params.set('current_pin_lon', state.currentPin.lon.toFixed(6));
  }
  if (state.view === '3d' || state.view === 'fpv') {
    params.set('bearing', fixed(degrees(state.bearing), 2).toFixed(2));
    params.set('pitch', fixed(Math.max(0, Math.min(89.9, state.pitch)), 2).toFixed(2));
    params.set('zoom', fixed(Math.max(0.01, state.zoom), 3).toFixed(3));
    if (state.pan) {
      params.set('pan_x', fixed(state.pan.x, 3).toFixed(3));
      params.set('pan_y', fixed(state.pan.y, 3).toFixed(3));
      params.set('pan_z', fixed(state.pan.z, 3).toFixed(3));
    }
    if (state.view === '3d' && state.focus) {
      params.set('focus_lat', mapLatitude(state.focus.lat));
      params.set('focus_lon', state.focus.lon.toFixed(6));
    }
  }
  if (state.view === 'fpv' && state.fpv) {
    params.set('fpv_lat', mapLatitude(state.fpv.lat));
    params.set('fpv_lon', state.fpv.lon.toFixed(6));
    params.set('fpv_bearing', fixed(degrees(state.fpv.bearing), 2).toFixed(2));
    params.set('fpv_pitch', fixed(state.fpv.pitch, 2).toFixed(2));
    params.set('fpv_zoom', fixed(Math.max(0.01, state.fpv.zoom), 3).toFixed(3));
  }
  if (state.area) {
    params.set('area_w', String(Math.round(state.area.width)));
    params.set('area_h', String(Math.round(state.area.height)));
    params.set('area_scale', String(Number(state.area.scale.toPrecision(8))));
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

/**
 * Fits the display area a permalink was made with to a frame of `width` x `height` (all in the same units as the
 * area, screen px at zoom 1): the ground scale at which the whole saved area is still in the frame (the other way
 * it shows more map around it). `ratio` is the new scale over the saved one, which is also what the saved pan is
 * multiplied by.
 */
export function fitPermalinkArea(area: MapPermalinkArea, width: number, height: number) {
  const ratio = Math.min(width / area.width, height / area.height);
  const scale = Math.min(AREA_MAX_SCALE, Math.max(AREA_MIN_SCALE, area.scale * ratio));
  return { scale, ratio: scale / area.scale };
}
