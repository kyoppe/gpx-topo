// What a permalink saves of the view, and how it is put back in a window and layout of another shape.
//
// The camera looks at the page centre plus `pan` (page px). The page is not laid out the same everywhere: the
// native page has a side panel, so its map sits to the left of the page centre, while the fallback page is
// just the map. So the saved pan is taken from the map centre (the point `lat` and `lon` name), and in screen
// px at zoom 1 (the page is fitted to the window, so page px mean different screen px in different windows).

import { fitPermalinkArea, type MapPermalinkArea, type MapPermalinkPan } from './mapPermalink';

export type PermalinkFrame = {
  pageWidth: number;
  pageHeight: number;
  mapX: number;
  mapY: number;
  mapWidth: number;
  mapHeight: number;
  /** screen px per page px at zoom 1 (`pageFit`) */
  fit: number;
};

/** Where the map centre lies from the page centre, in page px. */
export function mapCenterOffset(frame: PermalinkFrame) {
  return {
    x: frame.mapX + frame.mapWidth / 2 - frame.pageWidth / 2,
    y: frame.mapY + frame.mapHeight / 2 - frame.pageHeight / 2,
  };
}

/** The display area and the pan to save: the map frame and ground scale in screen px at zoom 1, the pan from the map centre. */
export function toPermalinkView(frame: PermalinkFrame, mapScale: number, pan: MapPermalinkPan) {
  const offset = mapCenterOffset(frame);
  const area: MapPermalinkArea = { width: frame.mapWidth * frame.fit, height: frame.mapHeight * frame.fit, scale: mapScale * frame.fit };
  return {
    area,
    pan: { x: (pan.x - offset.x) * frame.fit, y: (pan.y - offset.y) * frame.fit, z: pan.z * frame.fit },
  };
}

/**
 * The map scale and the engine pan that show a saved area in this frame: the whole saved map frame still in view,
 * and the point it looked at kept at the same place in it. (The few px the camera looks off the page centre are not
 * carried over: they are the same in every window and are left unscaled.)
 */
export function fromPermalinkView(frame: PermalinkFrame, area: MapPermalinkArea, pan: MapPermalinkPan | null) {
  const fitted = fitPermalinkArea(area, frame.mapWidth * frame.fit, frame.mapHeight * frame.fit);
  const toPage = fitted.ratio / frame.fit;
  const offset = mapCenterOffset(frame);
  return {
    scale: fitted.scale / frame.fit,
    pan: pan ? { x: pan.x * toPage + offset.x, y: pan.y * toPage + offset.y, z: pan.z * toPage } : null,
  };
}
