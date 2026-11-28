import type { ViewMode } from './mapMode';

export function shouldShowCurrentLocationControl(viewMode: ViewMode, apart: boolean): boolean {
  return viewMode === 'map' && !apart;
}
