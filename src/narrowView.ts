/** Width/height ratio at and above which the camera distance is not stretched. */
const REFERENCE_ASPECT = 1.2;
/** The most a camera distance is stretched for a narrow view. */
const MAX_STRETCH = 1.6;

/**
 * How much farther to put a camera so a narrow (portrait) view shows a similar width of the scene.
 * The engine's field of view is vertical, so a narrow view sees less sideways at the same distance.
 * The stretch is softened (square root) and capped so very tall views do not end up far away.
 */
export function narrowViewDistanceScale(aspect: number): number {
  if (!Number.isFinite(aspect) || aspect <= 0 || aspect >= REFERENCE_ASPECT) return 1;
  return Math.min(MAX_STRETCH, Math.sqrt(REFERENCE_ASPECT / aspect));
}
