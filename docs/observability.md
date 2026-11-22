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

## Custom RUM actions

Automatic interaction tracking records ordinary button and link clicks. Add a
custom RUM action only when the operation has product meaning or needs stable
attributes:

- `gpx_file_picker_opened`, `gpx_file_open_requested`, and `gpx_loaded`
- `operation_failed` and `operation_warning` for caught failures
- `view_mode_toggled`
- `map_style_changed`
- `flyover_control` and `flyover_state_changed`
- `waypoint_add_requested`, `waypoint_add_rejected`, `waypoint_edit`,
  `waypoint_move`, `waypoint_remove`, and `waypoint_focus_requested`
- `elapsed_time_picker_opened` and `elapsed_time_committed`
- `png_export_requested`
- `info_link_clicked` for links inside the falling Info flag
- `highest_point_toggled` and `waypoint_placement_toggled`
- `info_flag_toggled`
- `date_picker_opened` and `date_changed`

Prefer stable attributes such as `ok`, `source`, `map_style`, `waypoint_id`,
`waypoint_name`, `route_distance_km`, and `waypoint_count`. The loaded GPX
body is sent to Browser Logs as `gpx_content`, not attached to every RUM
action. Do not create a custom event for every render frame, pointer move, or
generic click that automatic interaction tracking already captures.

`waypoint_edit` is emitted once when a name edit is committed (on blur or
Enter). `waypoint_move` records the clamped waypoint distance after the move.

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
