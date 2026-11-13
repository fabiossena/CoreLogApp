# CoreLog contract mock

Zero-dependency Node server implementing the REST + SignalR surface defined in
[`docs/api-contract.md`](../../docs/api-contract.md), so the dashboard can be
developed and demoed end-to-end before the CoreLog backend exposes these
endpoints.

> **Why the mock exists:** the CoreLog backend at `C:\projects\CoreLog`
> implements ingestion (`/api/tracking/*`), trips and a hub with
> `JoinVehicle`/`positionUpdated`. This dashboard consumes a wider contract
> (`devices`, `panic`, `trackers`, device commands, `JoinAll`,
> `PositionReceived`, `PanicReceived`, `DeviceStatusChanged`, `CommandAcked`)
> that no local backend implements yet. The mock fills exactly that gap.

## Run

```bash
node tools/mock-corelog/server.mjs
# options: --port 8099  --quiet  --no-live
```

Then point the web app at it:

```env
VITE_CORELOG_BASE_URL=http://localhost:8099
VITE_SIGNALR_HUB_URL=http://localhost:8099/hubs/tracking
```

`web/.env` in this repository is already configured that way.

## Verify

```bash
node tools/mock-corelog/smoke-test.mjs                 # direct
node tools/mock-corelog/smoke-test.mjs http://localhost:8085  # through nginx
```

The smoke test uses the dashboard's own `@microsoft/signalr` client and checks
live positions, command dispatch + ack, panic creation/ack and tracker
registration/deletion (12 checks).

## Behaviour

| Area | Details |
|---|---|
| Fleet | 5 seeded devices (3 moving, 1 `PossiblyOffline`, 1 `Offline`) |
| Live sim | One `PositionReceived` per moving device every 3 s |
| Commands | `POST` returns `Pending`; acked after ~1.5 s with `CommandAcked` |
| Panics | 1 pending + 1 acknowledged seeded; `POST /api/panic` emits `PanicReceived` |
| Trackers | Sascar, ChineseGPS and MobileApp seeded |
| Persistence | In-memory only; restart resets the demo data |

## Endpoints

```
GET    /api/devices
GET    /api/panic?acknowledged&from&to&page&size
POST   /api/panic
POST   /api/panic/{panicId}/ack
POST   /api/devices/{deviceId}/commands
GET    /api/devices/{deviceId}/commands
POST   /api/devices/{deviceId}/commands/{commandId}/ack
GET    /api/trackers          POST /api/trackers
DELETE /api/trackers/{trackerId}
POST   /api/tracking/events
GET    /api/tracking/{vehicleId}/positions
GET    /api/tracking/{vehicleId}/last
GET    /api/trips/{tripId}/positions
POST   /hubs/tracking/negotiate   WS /hubs/tracking?id=<token>
GET    /health
```
