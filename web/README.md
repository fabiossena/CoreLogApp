# CoreLog Web Dashboard

Real-time fleet-monitoring dashboard for the CoreLog backend: live device list and map,
panic events with mandatory acknowledgement, per-device and bulk device commands, and
manual tracker registration.

* **Stack:** React 18 + TypeScript + Vite, `react-router-dom`, `@microsoft/signalr`,
  `react-leaflet` + `leaflet`, Vitest + Testing Library (jsdom).
* **Architecture:** Layered Architecture (Presentation / Domain / Data + Realtime) with
  MVVM-style hooks, SOLID (SRP, DIP), YAGNI, Separation of Concerns.
* **Contract:** every REST call and SignalR event matches
  [`docs/api-contract.md`](../docs/api-contract.md) exactly (snake_case JSON,
  ISO-8601 UTC timestamps).

---

## 1. Architecture

### 1.1 Layers (Presentation / Domain / Data) + MVVM hooks

```
┌────────────────────────────────────────────────────────────────────────────┐
│ PRESENTATION (View)                                                       │
│   pages/       DashboardPage · DeviceDetailPage ·                         │
│                PanicEventsPage · CommandCenterPage                        │
│   components/  DeviceMap · DeviceList · PanicAlertBanner                  │
│   App.tsx      composition root + routing (react-router-dom)              │
│        │  renders state · invokes commands — no network code here         │
├────────┼───────────────────────────────────────────────────────────────────┤
│ VIEWMODELS (MVVM: Model ⇄ ViewModel ⇄ View)                               │
│   useDashboard · useDeviceDetail · useCommandCenter                       │
│        │  own state, derive/merge data, expose commands + observable state│
│        │  depend on INTERFACES only (DIP): ICoreLogClient, ITrackingRealtime│
├────────┼───────────────────────────────────────────────────────────────────┤
│ DOMAIN (pure, framework-free)                                             │
│   entities/ Device · PanicEvent · Command · Tracker                       │
│   helpers: status derivation, event merging, command lifecycle,           │
│            per-type credential metadata/validation                        │
├────────┼───────────────────────────────────────────────────────────────────┤
│ DATA + REALTIME                                                           │
│   data/api/CoreLogClient.ts     typed REST client (cache-aside)           │
│   data/cache/localCache.ts      in-memory TTL cache                       │
│   realtime/SignalRClient.ts     typed TrackingHub client                  │
│   di/container.ts               manual DI composition root                │
└────────────────────────────────────────────────────────────────────────────┘
```

Dependency rule: **arrows only point downward**. The presentation layer knows the
viewmodels; viewmodels know the domain entities and the data-layer *interfaces*;
only the data layer knows HTTP, JSON and the local cache; only
`di/container.ts` knows the concrete classes.

### 1.2 Why not hexagonal (ports & adapters)?

The backend of CoreLog is a good candidate for hexagonal architecture — many inbound and
outbound adapters around a rich domain. This deliverable is a **browser UI** with exactly
one inbound transport (HTTP responses) and one realtime channel (one SignalR hub). A full
ports-and-adapters ceremony would wrap a single HTTP client and a single hub connection
into "adapters" without adding any architectural value — that is YAGNI. The layered +
MVVM-hooks style keeps the same *benefits* that matter here:

* **DIP/testability** — viewmodels consume `ICoreLogClient` and `ITrackingRealtime`
  interfaces declared in the data/realtime layers, so tests inject mocks (no network).
* **SRP** — each layer (and each viewmodel) has one reason to change: UI layout,
  state orchestration, business rules, transport.
* **SoC** — Leaflet/React render, viewmodels orchestrate, clients transport,
  the cache optimizes, the container wires.

If the dashboard ever grows multiple delivery channels (server-sent events, offline
replication, message bus), migrating the data layer into hexagonal adapters is a
mechanical refactor — the interfaces are already the seams.

### 1.3 Monitoring and commands always go **through CoreLog**

```
 Browser (this app)                     CoreLog backend                    Devices
 ─────────────────                      ───────────────                    ───────
 REST  ── GET /api/devices ────────────►  device store
         GET /api/panic ──────────────►  panic store
 SignalR ◄── PositionReceived ─────────  hub broadcast  ◄── positions ────  tracker/GPS
         ◄── PanicReceived ────────────  hub broadcast  ◄── panic ─────────  mobile app
         ◄── DeviceStatusChanged ──────  timeout detector
         ◄── CommandAcked ─────────────  ack fan-out    ◄── ack ──────────  FCM / provider API
 REST  ── POST /api/devices/{id}/commands ► command dispatcher ──────────►  FCM data message
                                                                       or tracker provider API
         POST /api/panic/{id}/ack ────►  panic acknowledgement
         POST /api/trackers ───────────►  polling-worker / webhook config
```

* The web dashboard **never opens a WebSocket to a device or tracker** and never talks to
  FCM or a tracker provider directly. Every command, acknowledgement and registration is
  a REST call to CoreLog; every live update is a SignalR event emitted by CoreLog.
* SignalR connection: `/hubs/tracking`, groups `all-devices` (dashboard) and
  `device-{vehicleId}` (detail page); client → server methods `JoinAll()` / `JoinVehicle(vehicleId)`.
* Commands are dispatched with `POST /api/devices/{deviceId}/commands` and awaited through
  the `CommandAcked` event; if no ack arrives within the timeout the UI marks the command
  **Failed** (see `CommandAckTracker` in `src/domain/entities/Command.ts`).

---

## 2. REST + SignalR contract (examples copied from `docs/api-contract.md`)

### 2.1 Conventions

* All JSON fields use **snake_case** (`vehicle_id`, `timestamp_utc`, `command_id`, ...).
* Timestamps are ISO-8601 UTC (`2026-11-12T11:20:00Z`).
* Base URL comes from `CORELOG_BASE_URL` (mobile) / `VITE_CORELOG_BASE_URL` (web).
* Errors are RFC 9110 problem+json shaped: `{ "title": "...", "status": 400, "errors": { ... } }`.

### 2.2 Panic events

`GET /api/panic` — query params: `acknowledged` (`true`/`false`), `from`, `to`, `page`, `size`:

```json
{
  "page": 1,
  "size": 50,
  "total_count": 2,
  "items": [
    {
      "panic_id": "3b8f1f4a-0f6d-4a2a-9c5e-1f2a3b4c5d6e",
      "event_id": "9f1c5b0e-3d2a-4f77-9c11-0a2b3c4d5e6f",
      "vehicle_id": "VEH-001",
      "timestamp_utc": "2026-11-12T11:20:00Z",
      "last_known_position": {
        "latitude": 41.1579,
        "longitude": -8.6291,
        "timestamp_utc": "2026-11-12T11:19:40Z"
      },
      "source": "MobileApp",
      "acknowledged": false,
      "acknowledged_at_utc": null,
      "acknowledged_by": null
    }
  ]
}
```

`POST /api/panic/{panicId}/ack` — body: `{ "operator": "fabio.sena" }` → `200 OK` with the updated panic object.

### 2.3 Device commands

`POST /api/devices/{deviceId}/commands`:

```json
{
  "command_type": "SET_FREQUENCY",
  "payload": { "seconds": 30 }
}
```

`command_type` is one of:

| Type | Payload |
|---|---|
| `SET_FREQUENCY` | `{ "seconds": 30 }` |
| `SILENCE` | `{ "duration_seconds": 600 }` |
| `REACTIVATE` | `{}` |
| `REQUEST_IMMEDIATE_POSITION` | `{}` |

Response `201 Created`:

```json
{
  "command_id": "c1c2c3c4-1111-4222-8333-444455556666",
  "device_id": "VEH-001",
  "command_type": "SET_FREQUENCY",
  "payload": { "seconds": 30 },
  "status": "Pending",
  "created_at_utc": "2026-11-12T11:21:00Z"
}
```

`GET /api/devices/{deviceId}/commands` — history:

```json
{
  "items": [
    {
      "command_id": "c1c2c3c4-1111-4222-8333-444455556666",
      "device_id": "VEH-001",
      "command_type": "SILENCE",
      "payload": { "duration_seconds": 600 },
      "status": "Acked",
      "created_at_utc": "2026-11-12T11:21:00Z",
      "acknowledged_at_utc": "2026-11-12T11:21:04Z",
      "silenced_until_utc": "2026-11-12T11:31:00Z",
      "error": null
    }
  ]
}
```

`status` ∈ `Pending` | `Acked` | `Failed` | `Silenced`.

### 2.4 Tracker registration

`POST /api/trackers`:

```json
{
  "type": "Sascar",
  "name": "Fleet A — plate 12-AB-34",
  "vehicle_id": "VEH-010",
  "polling_interval_seconds": 30,
  "credentials": { "plate": "12-AB-34", "integration_user": "corelog" },
  "enabled": true
}
```

Response `201 Created`:

```json
{ "tracker_id": "t1t2t3t4-5555-4666-7777-888899990000", "type": "Sascar", "vehicle_id": "VEH-010" }
```

`GET /api/trackers`:

```json
{
  "items": [
    {
      "tracker_id": "t1t2t3t4-5555-4666-7777-888899990000",
      "type": "ChineseGPS",
      "name": "Traccar — chip 8900",
      "vehicle_id": "VEH-011",
      "polling_interval_seconds": 30,
      "credentials": { "traccar_device_id": "TRC-118", "chip_model": "Concox GT06" },
      "enabled": true,
      "created_at_utc": "2026-11-10T09:00:00Z"
    }
  ]
}
```

`DELETE /api/trackers/{trackerId}` → `204 No Content`.

### 2.5 History queries

```
GET /api/tracking/{vehicleId}/positions?from=2026-11-11T11:00:00Z&to=2026-11-12T11:00:00Z&page=1&size=500
GET /api/tracking/{vehicleId}/last
GET /api/trips/{tripId}/positions?page=1&size=100
```

Response (list) — same shape as `GET /api/panic` pagination:

```json
{
  "page": 1,
  "size": 500,
  "total_count": 120,
  "total_pages": 1,
  "from_utc": "2026-11-11T11:00:00Z",
  "to_utc": "2026-11-12T11:00:00Z",
  "items": [
    {
      "event_id": "e102395e-6ef1-4c46-b3bf-68d46fb6b7e5",
      "vehicle_id": "VEH-001",
      "latitude": 41.1496,
      "longitude": -8.611,
      "timestamp_utc": "2026-11-12T11:21:00Z",
      "speed_kmh": 68.2,
      "source": "MobileApp",
      "trip_id": "19ec5ed4-98f2-4c83-8f16-1794b336e7fd"
    }
  ]
}
```

`GET /api/tracking/{vehicleId}/last` returns a single position object or `404`
`{ "error": "No positions recorded for vehicle 'VEH-001'." }`.

`GET /api/devices` — device list for the dashboard:

```json
{
  "items": [
    {
      "vehicle_id": "VEH-001",
      "display_name": "Van 01",
      "status": "Online",
      "tracking_enabled": true,
      "source": "MobileApp",
      "last_position_at_utc": "2026-11-12T11:21:00Z",
      "last_position": { "latitude": 41.1496, "longitude": -8.611, "timestamp_utc": "2026-11-12T11:21:00Z" },
      "region": "Porto",
      "trip_id": "19ec5ed4-98f2-4c83-8f16-1794b336e7fd"
    }
  ]
}
```

`status` ∈ `Online` | `Offline` | `PossiblyOffline`.
`tracking_enabled` reflects the mobile app Start/Stop state.
`region` is used by the web bulk-command filter.

### 2.6 SignalR — `/hubs/tracking`

Groups the client joins:

| Group | Purpose |
|---|---|
| `all-devices` | Dashboard stream (all devices, panics, status changes) |
| `device-{vehicleId}` | Device detail page |

Client → server methods: `JoinAll()`, `JoinVehicle(vehicleId)`.

Server → client events:

#### `PositionReceived`

```json
{
  "vehicle_id": "VEH-001",
  "event_id": "e102395e-6ef1-4c46-b3bf-68d46fb6b7e5",
  "latitude": 41.1496,
  "longitude": -8.611,
  "timestamp_utc": "2026-11-12T11:21:00Z",
  "speed_kmh": 68.2,
  "source": "MobileApp",
  "trip_id": "19ec5ed4-98f2-4c83-8f16-1794b336e7fd"
}
```

#### `PanicReceived`

```json
{
  "panic_id": "3b8f1f4a-0f6d-4a2a-9c5e-1f2a3b4c5d6e",
  "event_id": "9f1c5b0e-3d2a-4f77-9c11-0a2b3c4d5e6f",
  "vehicle_id": "VEH-001",
  "timestamp_utc": "2026-11-12T11:20:00Z",
  "last_known_position": { "latitude": 41.1579, "longitude": -8.6291 },
  "source": "MobileApp"
}
```

#### `DeviceStatusChanged`

```json
{
  "vehicle_id": "VEH-002",
  "status": "PossiblyOffline",
  "previous_status": "Online",
  "changed_at_utc": "2026-11-12T11:25:00Z",
  "reason": "No position received for 3 minutes"
}
```

#### `CommandAcked`

```json
{
  "command_id": "c1c2c3c4-1111-4222-8333-444455556666",
  "device_id": "VEH-001",
  "status": "Acked",
  "acknowledged_at_utc": "2026-11-12T11:21:04Z"
}
```

---

## 3. Pages and functionality

| Page | Route | Viewmodel | What it does |
|---|---|---|---|
| DashboardPage | `/` | `useDashboard` | Device list (status, tracking ON/OFF, last position time, source), live map fed by `PositionReceived`, panic banner |
| DeviceDetailPage | `/devices/:vehicleId` | `useDeviceDetail` | Current position, last-24h trail (`GET /api/tracking/{vehicleId}/positions?from=&to=`), active trip (`GET /api/trips/{tripId}/positions`), command buttons awaiting `CommandAcked` with timeout |
| PanicEventsPage | `/panic` | `useDashboard` (`loadPanics`) | List with filters (acknowledged / pending / time range), device + last known position + timestamp, acknowledge button |
| CommandCenterPage | `/commands` | `useCommandCenter` | Tracker registration form, bulk commands to a fleet subset (region / status / trip filters), command history with delivery status |

**Panic banner:** loud, sticky, highest `z-index`, pulsing. It lists unacknowledged panics
and **cannot be dismissed before acknowledgement** — only after
`POST /api/panic/{panicId}/ack` succeeds does the entry offer a *Dismiss* action.

**Command lifecycle in the UI:** `Pending` → (`CommandAcked` event) → `Acked`, or →
`Failed` when no ack arrives within the timeout (10 s by default, configurable in tests
via `ackTimeoutMs`). Bulk commands show the same per-device outcome.

---

## 4. Tracker registration form (per type)

Fields common to every type: **Type** (select), **Name**, **Vehicle id**,
**Polling interval (seconds)**, **Enabled** (checkbox) — plus the per-type credential
fields below, generated from `TRACKER_CREDENTIAL_FIELDS` in `src/domain/entities/Tracker.ts`:

| Type | Credential fields (snake_case keys sent in `credentials`) |
|---|---|
| `Sascar` | `plate`, `integration_user`, `password` |
| `Omnilink` | `external_fleet_id`, `wstt_user`, `wstt_password` |
| `Autotrac` | `fleet_id`, `api_key` |
| `ChineseGPS` | `traccar_device_id`, `chip_model` |
| `MobileApp` | `fcm_sender_id` (optional) |

Required fields are validated before `POST /api/trackers`; missing fields are reported in
English next to the form.

---

## 5. Local cache

`src/data/cache/localCache.ts` is a small in-memory TTL cache (a `Map` of values with
absolute expiry timestamps — deliberately simple, YAGNI: no LRU, no persistence).

`CoreLogClient` uses cache-aside (`getOrLoad`) for **list queries** before hitting the
network:

| Cache key | Query | Invalidation |
|---|---|---|
| `devices` | `GET /api/devices` | TTL |
| `panics:{query}` | `GET /api/panic` | TTL + prefix-invalidate after an ack |
| `trackers` | `GET /api/trackers` | TTL + invalidate after register/delete |
| `commands:{deviceId}` | `GET /api/devices/{deviceId}/commands` | TTL + invalidate after dispatch |
| `positions:{vehicleId}:{from}:{to}` | `GET /api/tracking/{vehicleId}/positions` | TTL |
| `tripPositions:{tripId}` | `GET /api/trips/{tripId}/positions` | TTL |

Default TTL: 10 000 ms (override with `VITE_CACHE_TTL_MS`). This follows the MVVM best
practice of a local application cache so the viewmodels avoid repeated network calls for
the same list data.

## 6. Dependency injection

`src/di/container.ts` is the **only** module that imports the concrete `LocalCache`,
`CoreLogClient` and `SignalRClient` classes:

```
loadConfig() ─► LocalCache ─► CoreLogClient ─┐
               config ─► SignalRClient ──────┴─► Container ─► viewmodels
```

* `createContainer(overrides?)` builds the graph; `App.tsx` creates it once and publishes
  it through `ContainerContext` (`useContainer()`).
* Pages hand the **interfaces** (`ICoreLogClient`, `ITrackingRealtime`) to the viewmodel
  hooks — Dependency Inversion: viewmodels never import the concrete classes, so tests
  inject mocks with `createContainer({ api, realtime })` or call the hooks directly with
  mock objects.
* Adding a new backend (or a fake for demos) is a one-line override — no viewmodel change.

---

## 7. Configuration (`.env.example`)

| Key | Purpose | Example |
|---|---|---|
| `CORELOG_BASE_URL` | Base URL of the CoreLog REST API — *server-side reference value, not read by Vite* | `http://localhost:8090` |
| `SIGNALR_HUB_URL` | TrackingHub URL — *server-side reference value, not read by Vite* | `http://localhost:8090/hubs/tracking` |
| `VITE_CORELOG_BASE_URL` | Base URL bundled into the browser client (used by `CoreLogClient`) | `http://localhost:8090` |
| `VITE_SIGNALR_HUB_URL` | Hub URL used by `SignalRClient`. Absolute `http(s)` URL, or a path resolved against `VITE_CORELOG_BASE_URL` | `http://localhost:8090/hubs/tracking` |
| `VITE_OPERATOR_ID` | Operator identity sent in the panic ack body `{ "operator": ... }` | `fabio.sena` |
| `VITE_CACHE_TTL_MS` | Optional TTL (ms) for cached list queries (default `10000`) | `10000` |

> **Note:** Vite only exposes `VITE_`-prefixed variables to the client bundle
> (`import.meta.env`). The unprefixed keys are kept for parity with the mobile/backend
> configuration; the dashboard reads the `VITE_` variants (falling back to the unprefixed
> ones only where a server-side proxy would read them).

Copy the file before running:

```bash
cp .env.example .env
```

---

## 8. How to run

Requires **Node 20** and **npm 10** (verified on Windows).

```bash
npm install     # install dependencies
npm test        # run the Vitest suite once (must be green)
npm run dev     # start the Vite dev server (http://localhost:5173)
npm run build   # type-check (tsc --noEmit) + production build into dist/
npm run preview # serve the production build locally
```

---

## 9. Testing notes

* Framework: **Vitest** + **@testing-library/react** in a **jsdom** environment
  (`vite.config.ts` → `test` block). Tests live in `__tests__/` (`*.test.ts[x]`);
  shared fixtures/doubles live in `__tests__/helpers/mocks.ts`.
* **No network anywhere:** every test injects mocked `ICoreLogClient` / `ITrackingRealtime`
  objects (`createApiMock`, `createRealtimeMock`). The mocks record calls and let tests
  emit `PositionReceived` / `PanicReceived` / `DeviceStatusChanged` / `CommandAcked`
  events as if the hub had pushed them.
* **No map tiles:** `DeviceMap` (Leaflet) is never rendered in tests — viewmodel and pure
  component tests only, so `npm test` works fully offline.
* Covered behaviour:
  * `useDashboard` — initial load, device-list merge of live positions (including
    unknown vehicles), `DeviceStatusChanged`, status derivation, live panics, the
    acknowledge flow (ack → still visible → dismiss hides) and failure handling.
  * `useDeviceDetail` — device group join, 24h trail window, per-vehicle position
    filtering, command dispatch → `CommandAcked` → `Acked`, timeout → `Failed`,
    dispatch errors, empty vehicle id.
  * `useCommandCenter` — tracker registration validation (per-type credentials),
    registration + list refresh, fleet filters (region/status/trip), bulk dispatch with
    per-device ack/timeout/error, refusal when no device matches, history loading.
  * `localCache` — TTL expiry, prefix invalidation, cache-aside loader behaviour.
  * Pure domain helpers — status thresholds, merge functions, command request building,
    `CommandAckTracker` (ack, early-ack buffering, timeout, clear, non-Acked status),
    credential validation; plus a `PanicAlertBanner` component test
    (dismiss only after acknowledge).
