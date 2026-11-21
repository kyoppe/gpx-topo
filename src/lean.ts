/** `x` itself up to 0.8 of `limit`, then easing toward the limit without reaching past it. */
export const softLimit = (x: number, limit: number) => {
  const knee = limit * 0.8;
  const m = Math.abs(x);
  return m <= knee ? x : Math.sign(x) * (limit - (limit - knee) * Math.exp(-(m - knee) / (limit - knee)));
};

/**
 * The lean (rad) a card holds on screen over a page that leans `lean` (rad, within half a turn) and has turned
 * `turn` (rad, 0 to half a turn) from the view: the page's own lean, eased to stop at `limit`; within `flip` of the
 * half turn it goes level, so the card swings over to the other side rather than jumping across.
 */
export function holdLean(lean: number, turn: number, limit: number, flip: number) {
  const x = Math.min(Math.max((Math.PI - turn) / flip, 0), 1);
  return softLimit(lean, limit) * x * x * (3 - 2 * x);
}
