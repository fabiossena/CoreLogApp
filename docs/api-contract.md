# CoreLog API Contract (shared by mobile and web)

This document is the **single source of truth** for the REST and SignalR contract used by
`mobile/` and `web/`. Both READMEs must reproduce the examples below unchanged so the two
clients stay compatible with the same CoreLog backend.

> The CoreLog backend endpoints below are **not implemented in this repository**. They are
> documented here so the mobile app and the web dashboard can be built and tested against
> them (tests use mocked clients).

## Conventions

* All JSON fields use **snake_case** (`vehicle_id`, `timestamp_utc`, `command_id`, ...).
* Timestamps are ISO-8601 UTC (`2026-11-12T11:20:00Z`).
* Base URL comes from `CORELOG_BASE_URL` (mobile) / `VITE_CORELOG_BASE_URL` (web).
* Errors are RFC 9110 problem+json shaped: `{ "title": "...", "status": 400, "errors": { ... } }`.

---

## 1. Position ingestion (mobile → CoreLog)

```
POST /api/tracking/events
Content-Type: application/json

[
  {
    "vehicle_id": "VEH-001",
    "latitude": 41.1579,
    "longitude": -8.6291,
    "timestamp_utc": "2026-11-12T11:20:00Z",
    "speed_kmh": 72.5
  }
]
```

Response `202 Accepted`:

```json
{ "accepted": 2, "rejected": 0 }
```

The body is a **JSON array** (batch). `speed_kmh` is optional. `source` is set to
`MobileApp` by the backend for this endpoint.

---

## 2. Panic events

### POST /api/panic — send a panic (mobile)

```json
{
  "event_id": "9f1c5b0e-3d2a-4f77-9c11-0a2b3c4d5e6f",
  "vehicle_id": "VEH-001",
  "timestamp_utc": "2026-11-12T11:20:00Z",
  "last_known_position": {
    "latitude": 41.1579,
    "longitude": -8.6291,
    "timestamp_utc": "2026-11-12T11:19:40Z",
    "speed_kmh": 72.5
  },
  "source": "MobileApp"
}
```

Response `201 Created`:

```json
{ "panic_id": "3b8f1f4a-0f6d-4a2a-9c5e-1f2a3b4c5d6e" }
```

### GET /api/panic — list panics (web)

Query params: `acknowledged` (`true`/`false`), `from`, `to`, `page`, `size`.

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

### POST /api/panic/{panicId}/ack — acknowledge (web)

Body: `{ "operator": "fabio.sena" }` → `200 OK` with the updated panic object.

---

## 3. Device commands

### POST /api/devices/{deviceId}/commands — dispatch (web)

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

### GET /api/devices/{deviceId}/commands — history (web)

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

### POST /api/devices/{deviceId}/commands/{commandId}/ack — mobile ack

```json
{ "result": "Ok", "message": "Applied" }
```

→ `200 OK`.

---

## 4. Trackers (web → CoreLog admin API)

### POST /api/trackers — register

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

`type` ∈ `Sascar` | `Omnilink` | `Autotrac` | `ChineseGPS` | `MobileApp`.

Per-type `credentials`:

| Type | Credentials |
|---|---|
| `Sascar` | `plate`, `integration_user`, `password` |
| `Omnilink` | `external_fleet_id`, `wstt_user`, `wstt_password` |
| `Autotrac` | `fleet_id`, `api_key` |
| `ChineseGPS` | `traccar_device_id`, `chip_model` |
| `MobileApp` | `fcm_sender_id` (optional) |

Response `201 Created`:

```json
{ "tracker_id": "t1t2t3t4-5555-4666-7777-888899990000", "type": "Sascar", "vehicle_id": "VEH-010" }
```

### GET /api/trackers — list

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

### DELETE /api/trackers/{trackerId} → `204 No Content`.

---

## 5. History queries (web)

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

### GET /api/devices — device list for the dashboard

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

---

## 6. SignalR — `/hubs/tracking`

Groups the client joins:

| Group | Purpose |
|---|---|
| `all-devices` | Dashboard stream (all devices, panics, status changes) |
| `device-{vehicleId}` | Device detail page |

Client → server methods: `JoinAll()`, `JoinVehicle(vehicleId)`.

Server → client events:

### `PositionReceived`

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

### `PanicReceived`

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

### `DeviceStatusChanged`

```json
{
  "vehicle_id": "VEH-002",
  "status": "PossiblyOffline",
  "previous_status": "Online",
  "changed_at_utc": "2026-11-12T11:25:00Z",
  "reason": "No position received for 3 minutes"
}
```

### `CommandAcked`

```json
{
  "command_id": "c1c2c3c4-1111-4222-8333-444455556666",
  "device_id": "VEH-001",
  "status": "Acked",
  "acknowledged_at_utc": "2026-11-12T11:21:04Z"
}
```

---

## 7. Backend behaviour expected by both clients

* **Timeout detection** — no position for > 3 minutes (per device, configurable) ⇒
  `DeviceStatusChanged` with `PossiblyOffline` on `all-devices`, stored on the device.
* **Panic** — stored with priority, emitted immediately as `PanicReceived` on `all-devices`.
* **Command dispatch** — FCM data message for mobile devices, provider API call for trackers;
  on ack ⇒ `CommandAcked` on `device-{vehicleId}`.
* **Tracker registration** — creates the polling-worker configuration or inbound webhook URL.

---

## 8. FCM data messages (CoreLog → mobile)

Data-only messages (no notification), keys in snake_case:

| `command_type` | Extra data keys |
|---|---|
| `SET_FREQUENCY` | `seconds` |
| `SILENCE` | `duration_seconds` |
| `REACTIVATE` | — |
| `REQUEST_IMMEDIATE_POSITION` | — |

Every data message also carries `command_id` and `device_id`. The app must acknowledge each
command with `POST /api/devices/{deviceId}/commands/{commandId}/ack`.