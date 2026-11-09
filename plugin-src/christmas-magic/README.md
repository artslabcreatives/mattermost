# Mattermost Christmas Magic

Plugin ID: `com.custom.christmas-magic`. A personal **Animations On/Off** switch in the top header controls colorful snowflakes, an original SVG Santa sleigh pulled by two reindeer (led by a glowing-nosed one), presents that Santa drops onto the message box and that open into a joke reward card ("You have been promoted!… just kidding 😄") when clicked, a snowman walking along the top of the message box, and subtle golden sparkles. All artwork is included in the bundle; no external asset requests are made.

## Integration and compatibility

This repository's staging server reports `12.0.0.custom`; its Docker Compose configuration enables plugins and uploads. The plugin uses the official root-component, channel-header, WebSocket-event, and reconnect registration APIs. The small Go backend only supplies authenticated, read-only animation configuration and broadcasts administrator changes. It does not write messages, users, or application data.

The current SDK has no general global-header component slot. To meet the top-header requirement without modifying Mattermost core, a small adapter inserts one plugin-owned React portal host into `#global-header #RightControlsContainer`. It follows header replacements and removes the host on unload. This DOM integration is version-sensitive: verify it after Mattermost upgrades. A supported channel-header switch is the fallback when the global header is absent or hidden on smaller screens; older SDKs without `registerChannelHeaderIcon` use a channel-header menu action. A standard main-menu action is always available, including mobile layouts that hide both the global and desktop channel headers. The top bar is hidden by Mattermost at widths up to 768px.

The manifest permits Mattermost 10+, but **the installed server has not yet had this new plugin uploaded or tested in a logged-in session**. Automated browser verification uses the built plugin with a registry/header fixture, not a live Mattermost login. Confirm the checklist below on staging before enabling on production. Recent Chromium, Firefox, Safari, and Mattermost desktop WebViews are intended targets; native mobile applications do not load webapp plugins.

References: [Web app SDK](https://developers.mattermost.com/integrate/reference/webapp/webapp-reference/), [plugin overview](https://developers.mattermost.com/integrate/plugins/).

## Build and package

Requirements: Node.js 18+ with npm, Go 1.26.3+, and GNU Make. From this directory:

```sh
make bundle
make test
```

The uploadable package is `dist/com.custom.christmas-magic-<version>.tar.gz` (version from `plugin.json`, currently 1.5.0). It includes the manifest, Linux amd64/arm64 server executables, and the webapp bundle. React/ReactDOM are supplied by Mattermost and are not bundled. Source dependencies are locked in `go.mod`, `go.sum`, and `webapp/package-lock.json`. Build outputs are ignored by Git.

Optional real-browser fixture check (requires a local Chrome/Chromium executable):

```sh
cd webapp
CHROME_BIN=/path/to/chrome node tests/browser-smoke.cjs
```

This runs the packaged JavaScript against React and a minimal host fixture in desktop light/dark and narrow layouts. Screenshots are saved under `webapp/test-results/`. Unit tests cover user preferences, configuration races, reduced motion, hidden tabs, dates, reconnects, blocked storage, and listener cleanup. Go tests cover configuration validation and endpoint authentication/method handling.

## License

The plugin needs a license key (`MMXMAS-XXXX-XXXX-XXXX-XXXX`) from [Buy Me a Coffee](https://buymeacoffee.com/rsahan/e/594048) in **System Console → Plugins → Mattermost Christmas Magic → License Key**. Each key works on one Mattermost server.

- **On activation** the server checks the key with `https://buy.sahanranasingha.me` (`/api/license/verify`, then `/api/license/activate` the first time), binding it to this installation's Mattermost diagnostic ID with the site URL as its name. Without a valid key, activation fails with `license error: …` and the plugin stays off. After entering a key for a plugin that failed to start, save, then disable and re-enable it in Plugin Management.
- **A key already bound to another server** is rejected with "This license key is already in use by another Mattermost server!"
- **Changing the key** while the plugin runs re-checks it (only when the key actually changes); a failure is logged as a warning.
- **License server outages:** if the server cannot be reached at activation (network error, timeout, or HTTP 5xx), a key verified on this server within the last 7 days is still accepted, so an outage cannot switch the plugin off for everyone on restart. An explicit "invalid" answer is never overridden. Only a SHA-256 hash of the key is stored for this.
- The key is visible only to system administrators in the System Console and is removed from the settings sent to users' browsers. (It is not a masked "secret" field because Mattermost masks those even when empty, which made a missing key look entered.)
- Each check makes up to two HTTPS requests with an 8-second timeout, so a slow license server can delay plugin activation (and Mattermost startup) by up to about 16 seconds.

## Install on staging

1. Open **System Console → Plugins → Plugin Management** as a system administrator.
2. Upload `dist/com.custom.christmas-magic-1.5.0.tar.gz` (choose **Overwrite** if an older version is installed; no server restart is needed) and enable **Mattermost Christmas Magic**.
3. Open its settings and configure the dates, density, and flight interval. Leave dates blank for a staging preview. For a seasonal rollout, set explicit start/end dates before enabling it for employees.
4. Open a channel and verify the **Animations** switch in the top header. Reload existing clients if the plugin does not appear immediately.

Both Docker and standard self-hosted installs use the same uploadable archive. For Docker, keep the plugin and client-plugin directories on persistent volumes (already configured in `docker-compose.staging.yml`). No core rebuild or server restart is required when using Plugin Management. If uploads are disabled on another installation, its administrator must first enable `PluginSettings.Enable` and `PluginSettings.EnableUploads` through the deployment's normal configuration process. Do not copy files into a running plugin directory or edit the server's configuration directly to install this plugin.

## Controls and behavior

If the switch is disabled with **Christmas settings are unavailable**, check the authenticated request to `/plugins/com.custom.christmas-magic/configuration`. A working endpoint returns JSON for signed-in users and HTTP 401 for unauthenticated requests; a 404 means the plugin is not active. Mattermost's plugin RPC gob-encodes `PublishWebSocketEvent` payloads, so the configuration event must contain only plain values (see `configuration.payload`). An earlier build sent the Go struct, which corrupted the plugin's API connection: activation never finished, the endpoint returned 404, and a server restart waited for the plugin indefinitely. `TestConfigurationEventEncodesOverRPC` guards against this.

| Administrator setting | Default | Behavior |
| --- | --- | --- |
| Enable Christmas animations | On | Master switch; pushes changes to connected clients |
| Snowfall / Santa / Falling gifts | On | Independently controls each effect; gifts require Santa |
| Walking snowman | On | A snowman walks back and forth on top of the message box |
| Santa sound | On | When Santa appears, plays an 11-second clip: sleigh bells and a "Jingle Bells" chorus on bells, then Santa saying "Ho ho ho, Merry Christmas". Each user can mute it with the speaker button next to the header switch |
| Snow density | 60 | Maximum desktop flakes, clamped to 0–150 and reduced by screen size/CPU count |
| Santa minimum / maximum wait | 30 / 90 seconds | Random wait before the first flight and after each completed flight, clamped to 30–3600 seconds |
| Gift messages | On | Clicking a falling or landed gift opens it and shows one of the **Gift messages**, congratulating the user by first name; closes with ×, Escape, or after 10 seconds. When off, gifts are decorative and let clicks pass through |
| Gift messages (text) | 8 joke rewards | One per line: the headline, then `\|` and an optional smaller line. Pre-filled with the built-in messages (special leave, half day, increment, promotion…); edit freely. Clearing the box restores the built-in list |
| Show "just kidding 😄" | On | Small corner note on every gift message; turn off if the messages are real |
| Christmas tree | On | A rotating 3D tree on the top-right corner of the message box, with a speech bubble for wishes |
| /christmas wishes | On | `/christmas <wish>` shows the wish to everyone in the tree's bubble, then saved wishes take turns |
| Start / end date | Empty | Optional inclusive `YYYY-MM-DD` dates in each viewer's local timezone; invalid dates disable effects |

Each viewer's header switch is stored per Mattermost user ID in browser local storage and synchronized between tabs on the same origin. It survives refreshes; it does not affect other users or devices. If browser storage is unavailable, the switch still works for that session. Administrator restrictions, dates, and `prefers-reduced-motion` take priority and disable the switch with an explanatory tooltip. Hidden tabs unmount the effects and cancel their animation frames and flight timers; returning starts a fresh randomized wait. Date boundaries are checked at local midnight and when tab visibility changes. Configuration is fetched on initialization/reconnection and pushed on changes, with no polling.

Santa flies left to right over 14–19 seconds at varying heights and drops 2–4 presents from under the sleigh while it is on screen. Presents fall, bounce and rest on top of the message box for 15 seconds, then fade. Snowflakes use the Bootstrap Icons `snow2` shape in six icy colors and sizes from 7 to 26 px, spinning as they fall. The snowman follows the message box as it moves or grows and never receives input. Apart from the presents (when gift wishes are on) and the wish card, every overlay uses `pointer-events: none` and is hidden from assistive technologies, so selection, typing and scrolling keep working. Presents are small, short-lived buttons labelled "Open a Christmas gift". Wishes are visual only, not rewards or chat notifications.

The header switch is keyboard focusable, uses `role="switch"` and `aria-checked`, and has a stable accessible label. Reduced motion suppresses all decorative animation. Particle counts and canvas device-pixel ratio are capped. No claim of 60 FPS is made without profiling the target device.

## Christmas wishes

Typing `/christmas Happy holidays, everyone!` saves the wish (up to 200 characters; one wish per user every 30 seconds) and pushes it to every connected client. The tree's bubble shows new wishes first, each for 5–11 seconds depending on length; when none are waiting, saved wishes take turns, newest first, every 12 seconds. The sender gets a private confirmation. Wishes are kept in the plugin's key-value store (the latest 500).

**System Console → Plugins → Mattermost Christmas Magic → Christmas wishes** lists every wish with its sender and time. System administrators can remove one or all; removal disappears from everyone's tree immediately. The list API is `GET /plugins/com.custom.christmas-magic/wishes` (signed-in users) and `DELETE …/wishes[/<id>]` (system administrators, with Mattermost's CSRF token).

## Sound

`public/santa.wav` (22 kHz mono, about 470 KB) is served by Mattermost at `/plugins/com.custom.christmas-magic/public/santa.wav` and plays at half volume once per flight. Browsers only allow sound after the user has interacted with the page; until then Santa flies silently. The speaker button's state is stored per user in local storage (`com.custom.christmas-magic:<user-id>:sound`) and defaults to on. Muting, turning animations off, or hiding the tab stops the sound immediately.

The clip is generated by `webapp/scripts/build-sound.cjs`, which mixes a synthesized "Jingle Bells" melody with:

- [Sleigh bells](https://commons.wikimedia.org/wiki/File:Sleigh_bells.wav) by The Midnite Wolf (CC0, Wikimedia Commons)
- `freesound_community-santa-claus-merry-christmas-ho-ho-ho-103426.wav`, Santa saying "Ho ho ho, Merry Christmas", supplied by the team from [artslab-pr/image-host](https://github.com/artslab-pr/image-host/blob/main/freesound_community-santa-claus-merry-christmas-ho-ho-ho-103426.wav). The file name follows Pixabay's download naming (uploader `freesound_community`, ID 103426); confirm its license there before redistributing the plugin outside the company.

## Disable, uninstall, and rollback

- **Personal:** set the header switch to Off. All animation elements and work stop immediately.
- **All users:** disable animations in the plugin settings, or disable the plugin in Plugin Management. Client registrations, DOM hosts, observers, listeners, requests, and timers are cleaned up on unload.
- **Uninstall:** disable and remove the plugin in Plugin Management. This does not modify application content. The small per-user browser preferences may remain; remove this plugin's `com.custom.christmas-magic:<user-id>:enabled` and `:sound` local-storage entries if desired.
- **Rollback:** keep the previous release archive before upgrading; disable/remove the current plugin and upload the previous version through Plugin Management. Record the administrator settings before removal if they need to be restored. For an initial installation, removing the plugin restores the original UI.

## Staging acceptance checklist

- [ ] Upload/enable succeeds; connected clients receive settings without a reload.
- [ ] Header switch appears once, with visible focus and Space/Enter operation.
- [ ] Off removes snow, Santa, gifts, and sparkles immediately; On resumes them.
- [ ] Refresh, channel/team navigation, header replacement, and logout/login do not duplicate effects; preferences stay scoped to the user.
- [ ] Administrator disable, each effect setting, density, frequency, valid date boundaries, and invalid dates behave as documented.
- [ ] Reduced motion suppresses all effects, including when changed while the page is open.
- [ ] Backgrounding the tab stops frames/timers; foregrounding resumes with a new wait.
- [ ] Messages remain selectable, the editor works, and channels/sidebar/menus remain clickable during a flight.
- [ ] Light/dark themes, narrow layouts, browser zoom, and desktop clients remain usable.
- [ ] Santa drops presents that land on the message box; clicking one shows a joke reward with the user's first name and "just kidding 😄" and closes without chat notifications or focus theft.
- [ ] The snowman walks on the message box, follows it when the right-hand sidebar opens or the box grows, and never blocks typing.
- [ ] Disable/re-enable/uninstall leaves no hosts, observers, animation frames, or timers behind.
- [ ] No console errors; profile frame time and memory on representative employee devices.
