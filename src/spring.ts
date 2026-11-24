// The engine moves things with a damped spring (the pop and the page standing up use ~0.68 damping and a quick
// natural frequency), so they settle with a little overshoot. CSS cannot run a spring, but it can follow one: this
// samples the spring's step response into a `linear()` timing function, which the fallback's panel and bar use.

/** Step response of a damped spring from 0 to 1: `zeta` is the damping ratio (<1 overshoots), `omega` rad per unit time. */
export function springStep(t: number, zeta: number, omega: number): number {
  if (t <= 0) return 0;
  if (zeta >= 1) return 1 - Math.exp(-omega * t) * (1 + omega * t);
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t));
}

/** The time the spring takes to stay within `tolerance` of 1 for good, scanning to `limit`. */
export function springSettleTime(zeta: number, omega: number, tolerance = 0.002, limit = 4): number {
  let settled = limit;
  for (let t = limit; t > 0; t -= 0.005) {
    if (Math.abs(springStep(t, zeta, omega) - 1) > tolerance) break;
    settled = t;
  }
  return settled;
}

/**
 * A CSS `linear()` easing that follows the spring over its whole settling time, and the duration (ms) to run it for.
 * `points` samples are enough for a smooth curve; the last is exactly 1.
 */
export function springEasing(zeta = 0.68, omega = 16, points = 32): { easing: string; duration: number } {
  const total = springSettleTime(zeta, omega);
  const stops: string[] = [];
  for (let i = 0; i <= points; i += 1) {
    const value = i === points ? 1 : springStep((i / points) * total, zeta, omega);
    stops.push(String(Math.round(value * 1000) / 1000));
  }
  return { easing: `linear(${stops.join(', ')})`, duration: Math.round(total * 1000) };
}
