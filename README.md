# gpx-topo

`gpx-topo` shows a GPX route on a faint GSI map and raises the same page into a 3D terrain model built from GSI DEM tiles.

- The terrain is one continuous surface at true scale: heights use the same metres per pixel as the map (1:1), with 10 m contours and 50 m index contours.
- The map can use the GSI standard, pale, blank map, or seamless aerial photos. The pale map has hillshade only when flat; on the 3D model its hillshade, own contour lines, and vegetation marks are taken out, so the relief is drawn by the model's contours and sunlight. Aerial photos do not use the GSI hillshade.
- React owns the page: the map, waypoint pins, the side panel, the bar, and the pickers are ordinary HTML.
- HTML-in-Canvas (`<canvas layoutsubtree>`, `texElementSubImage2D`, `updateElementGeometry`) turns each piece into a WebGL2 texture and keeps the real DOM under it, so text stays selectable and buttons stay clickable while the model is turned.
- The bar is a row of real buttons. On the flat map they are plain flat buttons; as the page stands up they rise into keys on a slab in front of the camera. The date and time pickers rise off the panel; the time picker turns as two lit drums.
- The sun follows the real solar position for the date, start time, and the target time at each waypoint. The pickers preview the light while they are open.
- GPX and PNG exports stay in the browser.

## Usage

Open the app in desktop Chrome 157+ or Edge 157+. Other browsers get a short notice, because HTML-in-Canvas is not available in Safari, iOS browsers, or Firefox.

The app opens on the map, centered on Mt. Fuji. `GPX を開く` loads a local file.

| Action | Result |
| --- | --- |
| `起こす` / `寝かす` | Raise the map into the 3D model, or put it back |
| Drag | Turn the model; on the flat map this raises it too, as many times round as you like (the side panel turns with it until it leans 20 degrees on screen, then holds there, and swings level and over to the other side as the map passes half a turn; its cards step aside rather than cover each other, and run off the edge of the view rather than being drawn in over the map). Going back to the plain view turns the short way |
| Right drag, middle drag, or Shift + drag | Move the model (in 3D; the flat map stays put). A right drag works from anywhere, pins and panel included; the browser menu stays away except in text fields |
| Wheel (or pinch) in | On the flat map, raise it into the 3D model as far as the wheel is turned; in 3D, zoom toward the pointer, the camera looking down more steeply the closer it gets so the ground stays in view rather than the model's sides. The side panel keeps its place while zoomed in. Close views fetch finer tiles for the part in view, nearest the middle first |
| Wheel (or pinch) out | Zoom out; once all the way out, lower the model back to the flat map |
| Hover the ground (3D) | Show the elevation there and light the contour at that height |
| Esc | Close an open picker, or go back to the flat map |
| Click a waypoint's number or map pin | In 3D, move the sun to that waypoint's target time; on the flat map, leave the view flat and select the waypoint |
| Sun slider | Scrub the time of day |
| Drag the red dot on the elevation profile | Move along the route, flat or in 3D; the clock, the light, and the dot on the map follow to the time the plan has you there |
| Start, date, or a waypoint's time | Open a picker: drag, wheel, arrow keys, or type four digits; Enter confirms, Esc cancels. Hovering a day previews its light |
| `ウェイポイント追加`, then click the route | Add a waypoint there. Clicks off the route add nothing |
| Type a km in the waypoint card and press `追加` | Add a waypoint that far along the route (full-width digits work too) |
| A waypoint's name or km in the card | Rename it, or move it along the route; `×` deletes it |
| `▲ 最高点` switch in the waypoint card | Show or hide the route's high point (`▲` and its height) on the map and on the elevation profile |
| `PNG` / `GPX` | Download the current view, or the route with its waypoints as they are now |

Raising and zooming are separate wheel gestures: pause the wheel to go from one to the next. A page left part way up stays where it is.

Waypoints without a target time get an estimate of 6 min/km plus 0.1 min per metre climbed. A file without waypoints gets fixed Start and Finish markers plus checkpoints every 5 km up to marathon distance, every 10 km below 100 km, or every 25 km from 100 km onward. A file with waypoints gets no automatic intermediate checkpoints; only missing endpoints are filled. Fixed Start and Finish markers cannot be deleted.

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

## Observability

Datadog Browser RUM and Browser Logs configuration, event naming, environment
selection, and commit version tagging are documented in
[`docs/observability.md`](docs/observability.md).

## Data

GSI tiles (Geospatial Information Authority of Japan), attributed in the side panel:

- `pale`: base map. For the 3D model its contour lines (and their labels) and its small grey vegetation marks are removed by colour and shape
- `blank`: GSI blank map, kept unchanged in the 3D model
- `hillshademap`: hillshade over the flat map at 35% opacity
- `dem_png` (DEM10B): elevation for the terrain and its contours. The tiles are decoded from their PNG bytes, not read back from a canvas, because browsers with fingerprint protection (such as Brave Shields) add noise to canvas reads and one step of red in these tiles is 655 m. Sea tiles are treated as 0 m. If DEM tiles fail, the terrain falls back to GPX elevations.

Clock times are Japan Standard Time.

## Deployment (Cloudflare Pages)

- Build command: `npm run build`
- Output directory: `dist`
- `functions/api/gsi/[[path]].ts` proxies allowed GSI layers with a one-day edge cache.

Pull requests targeting `main` run the test suite, typecheck, and build without
access to deployment secrets. Pushing to `main` runs the same validation, then
uploads the JUnit report to Datadog CI Visibility and deploys the validated
`dist` artifact to the `gpx-topo` Pages project.
The typecheck includes the Pages Functions under `functions/` with
Cloudflare Workers runtime types.

The Datadog upload is a deployment gate on `main`: if the upload fails, the
Cloudflare deployment does not start. The workflow uses pinned action and CLI
versions, and the deploy job does not rerun the test or build code.

Before the first push to `main`, configure these GitHub Actions secrets:

- `CLOUDFLARE_API_TOKEN`: an API token that can deploy to Cloudflare Pages
- `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account containing the Pages project
- `DD_API_KEY`: a Datadog API key that can submit CI Visibility test results

Enable GitHub Actions pipeline collection in the Datadog GitHub integration to
see workflow, job, and deployment pipeline data in CI Visibility. The workflow
uses `gpx-topo-web` as the Datadog service and `ci` as the environment.

The workflow does not configure GitHub branch protection. To make validation a
merge gate, require the `Validate and deploy / validate` check in the
repository ruleset or branch protection settings for `main`.

For manual recovery, deploy the built directory with Wrangler:

```bash
npx wrangler login
npx wrangler whoami
export CF_PAGES_COMMIT_SHA="$(git rev-parse --short=7 HEAD)"
npm ci
npm test
npm run build
npx wrangler pages deploy dist \
  --project-name gpx-topo \
  --branch main \
  --commit-hash "$CF_PAGES_COMMIT_SHA" \
  --commit-message "$(git log -1 --format=%s)"
```

`CF_PAGES_COMMIT_SHA` is injected into the build as the 7-character Datadog
`version`. The Cloudflare deployment can still use the full commit SHA for
deployment metadata if needed. Check recent deployments with:

```bash
npx wrangler pages deployment list --project-name gpx-topo
```
