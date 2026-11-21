# gpx-topo

`gpx-topo` shows a GPX route on a faint GSI map and raises the same page into a 3D terrain model built from GSI DEM tiles.

- The terrain is one continuous surface at true scale: heights use the same metres per pixel as the map (1:1), with 10 m contours and 50 m index contours.
- The flat map is the GSI pale map with its hillshade. On the 3D model the hillshade, the map's own contour lines, and its vegetation marks are taken out, so the relief is drawn by the model's contours and its sunlight only.
- React owns the page: the map, waypoint pins, the side panel, the bar, and the pickers are ordinary HTML.
- HTML-in-Canvas (`<canvas layoutsubtree>`, `texElementSubImage2D`, `updateElementGeometry`) turns each piece into a WebGL2 texture and keeps the real DOM under it, so text stays selectable and buttons stay clickable while the model is turned.
- The bar is a row of real buttons drawn as keys on a slab in front of the camera. The date and time pickers rise off the panel; the time picker turns as two lit drums.
- The sun follows the real solar position for the date, start time, and the target time at each waypoint. The pickers preview the light while they are open.
- GPX and PNG exports stay in the browser.

## Usage

Open the app in desktop Chrome 157+ or Edge 157+. Other browsers get a short notice, because HTML-in-Canvas is not available in Safari, iOS browsers, or Firefox.

The bundled `SFMT2026-110km.gpx` fixture loads first. `GPX を開く` loads a local file.

| Action | Result |
| --- | --- |
| `立体にする` / `平面に戻す` | Raise the map into the 3D model, or put it back |
| Drag | Turn the model, as many times round as you like (the side panel turns with it until it leans 20 degrees on screen, then holds there, and swings level and over to the other side as the map passes half a turn; its cards step aside rather than cover each other). Going back to the plain view turns the short way |
| Right drag, middle drag, or Shift + drag | Move the model |
| Wheel (or pinch) in | On the flat map, raise it into the 3D model; in 3D, zoom toward the pointer. Close views fetch finer tiles for the part in view, nearest the middle first |
| Wheel (or pinch) out | Zoom out; once all the way out, lower the model back to the flat map |
| Hover the ground (3D) | Show the elevation there and light the contour at that height |
| Esc | Close an open picker, or go back to the flat map |
| Click a waypoint row or map pin | Move the sun to that waypoint's target time |
| Sun slider | Scrub the time of day |
| Start, date, or a waypoint's time | Open a picker: drag, wheel, arrow keys, or type four digits; Enter confirms, Esc cancels. Hovering a day previews its light |
| `ウェイポイント追加`, then click the map | Add a waypoint |
| `PNG` / `GPX` | Download the current view, or the route with the file's and the added waypoints |

Raising and zooming are separate wheel gestures: pause the wheel to go from one to the next. A page left part way up finishes the way the wheel was going.

Waypoints without a target time get an estimate of 6 min/km plus 0.1 min per metre climbed. A file without waypoints gets a start, a checkpoint every 25 km, the high point, and the finish.

## Local development

```bash
npm install
npm run dev
```

The Vite dev server proxies `/api/gsi/*` to `https://cyberjapandata.gsi.go.jp/xyz/*`, so tiles are same-origin for texture uploads.

## Checks

```bash
npm run typecheck
npm test
npm run build
```

## Data

GSI tiles (Geospatial Information Authority of Japan), attributed in the side panel:

- `pale`: base map. For the 3D model its contour lines (and their labels) and its small grey vegetation marks are removed by colour and shape
- `hillshademap`: hillshade over the flat map at 35% opacity
- `dem_png` (DEM10B): elevation for the terrain and its contours. The tiles are decoded from their PNG bytes, not read back from a canvas, because browsers with fingerprint protection (such as Brave Shields) add noise to canvas reads and one step of red in these tiles is 655 m. Sea tiles are treated as 0 m. If DEM tiles fail, the terrain falls back to GPX elevations.

Clock times are Japan Standard Time.

## Deployment (Cloudflare Pages)

- Build command: `npm run build`
- Output directory: `dist`
- `functions/api/gsi/[[path]].ts` proxies allowed GSI layers with a one-day edge cache.
