import { datadogRum } from '@datadog/browser-rum';

const UPDATE_INTERVAL_MS = 1000;
const INTERACTION_EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'keydown', 'wheel', 'click'] as const;

/** Records the span between the first and last interaction in the current RUM view. */
export function startViewEngagement(): () => void {
  let viewId: string | undefined;
  let first: number | undefined;
  let last: number | undefined;
  let updatedAt: number | undefined;
  let timer: number | undefined;

  function cancelPendingUpdate() {
    window.clearTimeout(timer);
    timer = undefined;
  }

  function syncView(): boolean {
    const id = datadogRum.getInternalContext()?.view?.id;
    if (id !== viewId) {
      cancelPendingUpdate();
      viewId = id;
      first = last = updatedAt = undefined;
    }
    return id !== undefined;
  }

  function update() {
    cancelPendingUpdate();
    // A trailing update must never carry the previous view's time into a new view.
    if (!syncView() || first === undefined || last === undefined) return;
    datadogRum.setViewContextProperty('engaged_ms', last - first);
    updatedAt = performance.now();
  }

  function onInteraction(event: Event) {
    // Hover alone is not engagement; pressed pointers include touch drags and pinches.
    if (event.type === 'pointermove' && (event as PointerEvent).buttons === 0) return;
    if (!syncView()) return;
    const now = performance.now();
    first ??= now;
    last = now;
    if (updatedAt === undefined || now - updatedAt >= UPDATE_INTERVAL_MS) {
      update();
    } else if (timer === undefined) {
      // Keep the final interaction even when the user stops within the throttle window.
      timer = window.setTimeout(update, UPDATE_INTERVAL_MS - (now - updatedAt));
    }
  }

  function flushPendingUpdate() {
    if (timer !== undefined) update();
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') flushPendingUpdate();
  }

  // Capture also sees interactions whose propagation is stopped by UI controls.
  const options = { capture: true, passive: true };
  for (const type of INTERACTION_EVENTS) window.addEventListener(type, onInteraction, options);
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', flushPendingUpdate);

  return () => {
    cancelPendingUpdate();
    for (const type of INTERACTION_EVENTS) window.removeEventListener(type, onInteraction, options);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pagehide', flushPendingUpdate);
  };
}
