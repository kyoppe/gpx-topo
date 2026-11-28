import type { CoverageRegion } from './regions';
import type { Copy } from './i18n';

const GSI_CREDIT_URL = 'https://maps.gsi.go.jp/development/ichiran.html';
const OSM_CREDIT_URL = 'https://www.openstreetmap.org/copyright';
const USGS_CREDIT_URL = 'https://www.usgs.gov/3d-elevation-program';

export function MapCredit({ region, copy }: { region: CoverageRegion; copy: Copy }) {
  if (region === 'unsupported') return null;

  return (
    <div className="map-credit" data-piece="content" data-map-control="" drawable="" data-selectable="">
      {region === 'japan' ? (
        <a href={GSI_CREDIT_URL} target="_blank" rel="noreferrer">
          {copy.ui.gsiCredit}
        </a>
      ) : (
        <>
          <a href={OSM_CREDIT_URL} target="_blank" rel="noreferrer">
            {copy.ui.osmCredit}
          </a>
          <span aria-hidden="true"> · </span>
          <a href={USGS_CREDIT_URL} target="_blank" rel="noreferrer">
            {copy.ui.usgsCredit}
          </a>
        </>
      )}
    </div>
  );
}
