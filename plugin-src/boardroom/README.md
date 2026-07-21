# Board Room plugin

Books the board room from a panel in the App Bar, next to Zoom. Any logged-in
Mattermost user can use it; there is no separate login.

- **Plugin ID:** `com.artslabcreatives.boardroom`
- **Scope:** bookings are kept **per team**.
- **Permissions:** everyone in the team sees every booking; only the person who
  created a booking can edit or cancel it. System admins can also change one, so
  a room can be freed when its owner is away.
- **Notifications:** a `boardroom` bot DMs the host and participants when a
  booking is created, changed or cancelled. The person making the change isn't
  notified. Turn this off in the System Console.

## Build

```bash
make bundle     # -> dist/com.artslabcreatives.boardroom.tar.gz
make test       # Go unit tests + webapp typecheck
```

## Install

Upload the tarball in **System Console → Plugins → Plugin Management**, or:

```bash
mmctl --local plugin add dist/com.artslabcreatives.boardroom.tar.gz --force
mmctl --local plugin enable com.artslabcreatives.boardroom
```

Note that `docker compose cp` cannot reach `/tmp` in the staging container
(it's a tmpfs); stage the tarball through a bind-mounted path such as
`volumes/app/mattermost/plugins/` instead.

## Settings

Configured in **System Console → Plugins → Board Room**: opening hour, closing
hour, slot length (15/20/30/60 min) and whether to notify attendees. Mattermost
has no numeric setting type, so these are dropdowns of strings that the server
parses; anything blank or nonsensical falls back to 08:00–20:00 / 30 min.

## Google Calendar sync

A booking becomes **one** Google event: the host is the organiser and the
participants are attendees, so Google puts it on everyone's calendar and sends
the invites itself. That means only the host needs credentials — attendees never
connect anything.

Authentication is a **service account with domain-wide delegation**, which
impersonates the host. Nobody has to run a `/connect` command.

Sync is deliberately **best-effort**: the room is a physical resource, so a
booking never fails because Google is unreachable. Each booking records a
`sync_state`:

| State | Meaning | Shown in the panel |
|:--|:--|:--|
| `synced` | On Google Calendar | ✓ On Google Calendar |
| `failed` | Booked, but Google refused or was unreachable | ⚠ warning + reason on hover |
| `off` | An admin deliberately disabled sync | nothing |

`off` means *disabled on purpose*. Enabling sync without pasting a key reports
`failed` with an explanation, so a half-finished setup can't pass unnoticed.

### One-time setup (needs a Workspace super admin)

1. In Google Cloud, create a **service account** and download its JSON key.
   Enable the **Google Calendar API** on the project.
2. On the service account, note its **Client ID** (the numeric `client_id`).
3. In the **Google Workspace admin console** → Security → Access and data
   control → **API controls** → **Domain-wide delegation** → *Add new*:
   - Client ID: the service account's client ID
   - Scope: `https://www.googleapis.com/auth/calendar.events`
4. In Mattermost, **System Console → Plugins → Board Room**:
   - Paste the whole JSON key into **Google service account key**
   - Set **Room timezone** (`Asia/Colombo`) and, optionally,
     **Only invite this email domain** (`artslabcreatives.com`)
   - Turn **Sync to Google Calendar** on

Point 3 is the step that actually grants access; without it Google returns
`unauthorized_client` and bookings report `failed`.

### Timezone

Bookings are wall-clock times in the **room's** zone, so `Room timezone` is what
turns 09:00 into a real instant for Google. The container runs in UTC, so this
must never be left to the server's local zone. The IANA database is embedded in
the binary (`time/tzdata`), so lookups work even on an image without tzdata.

### Attendees without Google accounts

Test and `@localhost` accounts have no Google identity and would make Google
reject the whole event. Set **Only invite this email domain** to your Workspace
domain and they're quietly left off the invite; the booking is unaffected.

## How double-booking is prevented

The room is a physical resource, so a clash must be impossible rather than
merely unlikely.

- Times are stored as **minutes from midnight in the room's local wall-clock
  time**, not as absolute timestamps, so a 09:00 booking reads as 09:00 for
  everyone regardless of their timezone.
- Bookings live in the KV store as **one entry per team per day**. The overlap
  check and the write happen inside a single `SetAtomicWithRetries`
  compare-and-set, so two people submitting the same slot at once cannot both
  win — the loser gets a `409` naming the booking that beat them.
- Touching bookings don't clash: one ending at 10:00 and the next starting at
  10:00 is allowed.
- The UI greys out taken slots and blocks submission, but that's only a
  courtesy; the server is the authority.

## API

All routes are under `/plugins/com.artslabcreatives.boardroom/api/v1` and
require a logged-in session.

| Method | Path | Notes |
|:--|:--|:--|
| `GET` | `/config` | Opening hours and slot length. |
| `GET` | `/bookings?team_id=&from=&to=` | Dates are `YYYY-MM-DD`; `to` defaults to `from`. |
| `POST` | `/bookings` | `409` with a `conflict` body if the slot is taken. |
| `PUT` | `/bookings/{id}` | Creator (or system admin) only. |
| `DELETE` | `/bookings/{id}` | Creator (or system admin) only. |

## Layout

- `server/` — Go plugin. `booking.go` (model + validation), `store.go` (KV +
  conflict detection), `api.go` (HTTP + authorization), `notify.go` (bot DMs).
- `webapp/` — React panel registered via `registerAppBarComponent`, falling back
  to a channel header button if the App Bar is disabled. React, Redux and
  react-redux come from the host as globals and must stay in webpack `externals`
  — bundling a second copy would break hooks and detach the store.

Mattermost hides the App Bar and all plugin RHS panels below 768px, so the panel
is desktop-only by design; on phones people use the native apps.
