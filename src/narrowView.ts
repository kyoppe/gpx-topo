/** Width/height ratio used as the reference for the camera's horizontal view. */
const REFERENCE_ASPECT = 1.2;
/** Effective map width at which the reference camera distance needs no size stretch. */
const REFERENCE_DISPLAY_WIDTH = 660;
/** The most a camera distance is stretched for a small or narrow display area. */
const MAX_STRETCH = 2.6;

/**
 * How much farther to put a camera so a display area shows the intended width of the scene.
 * The engine's field of view is vertical, so a narrow view sees less sideways at the same distance.
 * `displayWidth` is the map width after the page has been fitted to the display.
 */
export function displayDistanceScale(aspect: number, displayWidth: number): number {
  if (!Number.isFinite(aspect) || aspect <= 0 || !Number.isFinite(displayWidth) || displayWidth <= 0) return 1;
  const aspectScale = Math.max(1, REFERENCE_ASPECT / aspect);
  const sizeScale = Math.max(1, REFERENCE_DISPLAY_WIDTH / displayWidth);
  return Math.min(MAX_STRETCH, aspectScale * sizeScale);
}
