/**
 * Which of the stage's two element pictures (the map and the page) have to be taken again.
 *
 * Taking one is an upload and a mipmap build, the costly part of a frame, so it is done only when what the element
 * shows has changed (tiles, text, selection, hover, focus, scroll) or its size has, not on every frame of the model
 * standing up or lying down. Starts out wanting both.
 */
export function createTextureFreshness() {
  const state = {
    map: { stale: true, size: '' },
    page: { stale: true, size: '' },
  };
  return {
    markMap() {
      state.map.stale = true;
    },
    markPage() {
      state.page.stale = true;
    },
    markAll() {
      state.map.stale = true;
      state.page.stale = true;
    },
    needsMap(size: string) {
      return state.map.stale || state.map.size !== size;
    },
    needsPage(size: string) {
      return state.page.stale || state.page.size !== size;
    },
    mapTaken(size: string) {
      state.map = { stale: false, size };
    },
    pageTaken(size: string) {
      state.page = { stale: false, size };
    },
  };
}
