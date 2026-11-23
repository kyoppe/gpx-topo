# Browser observability

This document describes the gpx-topo browser observability implementation.
Keep the runtime configuration and event names aligned with this document when
Datadog instrumentation is changed.

## Datadog RUM application

- Application ID: `d5807eba-5947-4933-b5e1-b25c996dfe32`
- Client Token: `pubd8fe53f9f169d37ec0ca3bf772e6ee88`
- Site: `datadoghq.com`
- Service: `gpx-topo-web`

The Client Token is a browser token and is not an API Key or Application Key.
Never put Datadog API Keys or Application Keys in the frontend.

## Environment and version

Use these values at SDK initialization time:

- Local Vite development server (`npm run dev`): `env=dev`
- Cloudflare Pages builds: `env=kyo`
- Local version: the full output of `git rev-parse HEAD`
- Cloudflare Pages version: `CF_PAGES_COMMIT_SHA`
- External CI fallback: `GITHUB_SHA`

Cloudflare Pages injects `CF_PAGES_COMMIT_SHA` during its build. A custom
GitHub Action is not required when the project is deployed through the
Cloudflare Pages Git integration. Use `GITHUB_SHA` only when an external
workflow performs the build or deployment.

## RUM and Browser Logs settings

- `sessionSampleRate: 100`
- `sessionReplaySampleRate: 100`
- `defaultPrivacyLevel: "allow"`
- `trackUserInteractions: true`
- `trackResources: true`
- `trackLongTasks: true`
- Browser Logs enabled
- `forwardErrorsToLogs: true`
- `forwardConsoleLogs: "all"`
- `beforeSend` preserves explicit `event_type` values and supplies
  `browser_console`, `browser_error`, or `browser_log` to automatic logs.
- Browser Logs also receive `service`, `env`, and `version` when the SDK event
  does not already contain them.

User-entered values are not masked. Waypoint names, GPX file names, and GPX
content may be included in RUM context or Browser Logs when they are relevant
to the operation being recorded.

## Time between user interactions

RUM view context includes `engaged_ms`: the time in milliseconds between the
first and most recent user interaction within that view. It excludes time
before the first and after the last interaction, but includes any idle gaps
between interactions. It is not a sum of active intervals.

The tracker starts after RUM initialization, once for the lifetime of the page.
It observes `pointerdown`, pressed `pointermove`, `pointerup`, `keydown`,
`wheel`, and `click` in the capture phase with passive listeners. This covers
map drags, touch pinches, trackpad zoom, and controls that stop propagation,
without treating pointer hover or animations as interaction.

The first interaction writes zero; views with no interactions have no value.
Subsequent writes are throttled to once per second, with a trailing update
using the last interaction's timestamp. Pending updates are flushed when the
page becomes hidden or receives `pagehide`, so background time is not added.
These lifecycle flushes can bypass the throttle. A change in
`datadogRum.getInternalContext()?.view?.id` resets the timestamps and pending
update before recording another interaction, including after session renewal
or a future route change. The app currently has only the `/` route.

In Datadog, register `@context.engaged_ms` as a numeric measure with millisecond
units. Filter to `@type:view service:gpx-topo-web` and SUM the measure grouped by
user to obtain each user's total across views. Datadog retains the latest
version of each view event; do not sum the same context from action events.

After deployment, verify the ingested view context against a known sequence
of interactions, including session renewal, and confirm that it stops growing
after the last interaction.

## Custom RUM actions

Automatic interaction tracking records ordinary button and link clicks. Add a
custom RUM action only when the operation has product meaning or needs stable
attributes:

- `gpx_file_picker_opened`, `gpx_file_open_requested`, and `gpx_loaded`
- `operation_failed` and `operation_warning` for caught failures
- `html_in_canvas_ready` after the feature probe passes and the engine is constructed
- `html_in_canvas_painted` once per engine, after a `paint` event produces its
  first successful element texture upload (`texElementSubImage2D`)
- `view_mode_toggled`
- `map_style_changed`
- `flyover_control` and `flyover_state_changed`
- `waypoint_add_requested`, `waypoint_add_rejected`, `waypoint_edit`,
  `waypoint_move`, `waypoint_remove`, and `waypoint_focus_requested`
- `elapsed_time_picker_opened` and `elapsed_time_committed`
- `photo_requested` when the camera key accepts a capture
- `photo_shown` when the print starts floating over the map
- `photo_saved` when the browser download is initiated
- `photo_copied` when the image is copied to the clipboard
- `photo_post_opened` when the X post composer opens
- `photo_closed` when the print returns to the camera key, with `via` set to
  `button` or `escape`; automatic closing during a flyover is not counted
- `info_link_clicked` for links inside the falling Info flag
- `highest_point_toggled` and `waypoint_placement_toggled`
- `info_flag_toggled`
- `map_pin_placement_started`, `map_pin_placement_cancelled` (with `source` when
  cancelled by Escape), `map_pin_placed` (with `lat` and `lon`),
  `map_pin_label_changed` (with `has_label`), and `map_pin_cleared`
- `map_pin_landed` when a pin dropped in 3D touches the ground, with
  `duration_ms` from placement; it is not emitted on the flat map, where the
  pin appears at once. A placement with no matching landing means the drop was
  not seen
- `map_maneuver_requested`, `map_maneuver_cancelled`, and
  `map_maneuver_state_changed`
- `map_permalink_detached` when the first interaction returns a permalink URL to
  the plain one, with `reason`
- `x_hint_shown` when a hint card springs out of the HUD, with `kind` (`map-pin`,
  `permalink`, or the latest media kind)
- `date_picker_opened` and `date_changed`

Prefer stable attributes such as `ok`, `source`, `map_style`, `waypoint_id`,
`waypoint_name`, `route_distance_km`, and `waypoint_count`. The loaded GPX
body is sent to Browser Logs as `gpx_content`, not attached to every RUM
action. Do not create a custom event for every render frame, pointer move, or
generic click that automatic interaction tracking already captures.

`waypoint_edit` is emitted once when a name edit is committed (on blur or
Enter). `waypoint_move` records the clamped waypoint distance after the move.

Both HTML-in-Canvas actions include `is_webview`, detected from the `wv` token
in the user agent, and `user_agent_data_brands` when
`navigator.userAgentData.brands` is available (an array of `{ brand, version }`
objects). These attributes are diagnostic and do not affect feature detection.
The ready action retains its existing timing and meaning: API availability and
engine construction do not establish painting success. The painted action
requires a non-throwing upload with no WebGL error or lost context on the first
successful upload; fallback animation frames and failed uploads do not emit it.
It confirms an element snapshot was uploaded, not that every element or final
screen pixel rendered correctly.

## Browser Logs

Use Browser Logs for diagnosis rather than product analytics:

- Forward uncaught `window` errors and unhandled promise rejections.
- Log caught GPX parsing, tile, terrain, export, and HTML-in-Canvas failures.
- Log loaded GPX content with the file name and route summary for troubleshooting.
- Log recoverable warnings with a stable `event_type`.
- Keep `console` forwarding enabled for debugging, while avoiding ad hoc
  duplicate messages for the same RUM action.

## Verification

Before considering an observability change complete:

1. Run `npm run dev` and verify that the initialized RUM context uses `env=dev`
   and the current local commit hash.
2. Run `npm run typecheck`, `npm test`, and `npm run build`.
3. Verify a Cloudflare Pages build uses `env=kyo` and
   `CF_PAGES_COMMIT_SHA`.
4. Query Datadog using the application ID and check view, action, error,
   resource, long-task, replay, and Browser Logs data.
