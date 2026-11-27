import { useEffect, useMemo, useState } from 'react';

import { sceneTiles, type SceneLayer, type SiteScene } from './siteScene';

/**
 * The GSI blank map around a scene, as plain positioned images.
 * Tiles are fetched as blobs so the picture stays same-origin and can be uploaded as a canvas texture.
 * A tile that fails to load is left out; the paper behind it stays.
 */
export default function SceneMap({
  scene,
  width,
  height,
  layer = 'blank',
  focusY,
}: {
  scene: SiteScene;
  width: number;
  height: number;
  layer?: SceneLayer;
  focusY?: number;
}) {
  const tiles = useMemo(() => sceneTiles(scene, width, height, layer, focusY), [scene, width, height, layer, focusY]);
  const [sources, setSources] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    for (const tile of tiles) {
      fetch(tile.url)
        .then((response) => (response.ok ? response.blob() : null))
        .then((blob) => {
          if (!blob) return;
          const url = URL.createObjectURL(blob);
          if (cancelled) {
            URL.revokeObjectURL(url);
            return;
          }
          urls.push(url);
          setSources((current) => ({ ...current, [tile.key]: url }));
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [tiles]);

  return (
    <div className="scene-map" style={{ width, height }} aria-hidden="true">
      {tiles.map((tile) =>
        sources[tile.key] ? (
          <img key={tile.key} src={sources[tile.key]} alt="" width={256} height={256} style={{ left: tile.left, top: tile.top }} />
        ) : null,
      )}
    </div>
  );
}
