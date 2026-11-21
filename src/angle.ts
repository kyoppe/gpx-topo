const TURN = 2 * Math.PI;

/** The whole turns (rad) nearest to `a`: what is left of `a` after taking them off lies within half a turn. */
export const nearestTurn = (a: number) => Math.round(a / TURN) * TURN;
