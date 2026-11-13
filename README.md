# CoreLog Mobile + Web (MVVM · Layered)

Two deliverables in one repository, both talking to the **CoreLog** backend
(`hexagonal-architecture` repo, .NET 8 / PostgreSQL+PostGIS / Kafka / SignalR):

1. **`mobile/`** — React Native app (Android + iOS) with a **native background service** that
   sends GPS positions every 60 s, buffers offline in SQLite, has a **panic button**, and
   receives remote commands (change frequency, silence, reactivate, request position) from
   CoreLog over FCM.
2. **`web/`** — React dashboard that **monitors all devices in real time**, receives panic
   events, sends commands to specific devices, and registers/manages trackers (Sascar,
   Omnilink, Autotrac, Chinese GPS via Traccar, mobile app devices).

```
mvvm-layered-app/
├── mobile/                 # React Native — MVVM + Layered
├── web/                    # React dashboard — Layered + MVVM hooks
├── docs/api-contract.md    # single source of truth for the REST/SignalR contract
├── docker-compose.yml      # web + observability (OpenTelemetry collector, Grafana, Loki, Tempo, Prometheus)
├── Dockerfile.web          # multi-stage build for the dashboard
├── deploy/k8s/             # Kubernetes manifests (same images/config as compose)
└── README.md               # this file
```

---

## Why MVVM + Layered (and NOT Hexagonal) here

The CoreLog **backend** uses Hexagonal Architecture because it has *five* external
integrations (Sascar SOAP, Omnilink WSTT, Autotrac API, Traccar, mobile app) and *three*
delivery channels (webhook, SignalR, REST history). Ports/adapters pay for themselves there.

The **mobile app** and the **web dashboard** are the opposite case:

| | Backend | Mobile / Web |
|---|---|---|
| External integrations | 5 inbound + 3 outbound | **1** (CoreLog REST + SignalR) |
| Domain logic | freshness policy, trip window, outbox | trivial (map DTO → view state) |
| Correct abstraction | Ports & Adapters | **Layered + MVVM** |

Adding ports/adapters to a client that has a single integration would create a forest of
one-implementation interfaces — pure YAGNI overhead. Layered Architecture already gives the
two things we actually need:

* **Presentation / Domain / Data / Infrastructure** separation (mobile) or
  **Presentation / Domain / Data** (web) — dependencies point inward only.
* **MVVM in the presentation layer** — the View is dumb, the ViewModel owns observable
  state + commands, the Model (domain entities) stays framework-free and unit-testable.

### MVVM best practices applied (aligned to the reference design)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ USER-CENTRIC FLOW (MVVM)                                                   │
│                                                                             │
│  USER ─▶ VIEW (UI, interactions)                                           │
│             │ commands, state update                                       │
│             ▼                                                              │
│          VIEWMODEL (observable state, commands)                            │
│             │ business requests, model state                               │
│             ▼                                                              │
│          MODEL (business entities, services) ──▶ persistence / data flow   │
└─────────────────────────────────────────────────────────────────────────────┘
```

| Practice | Where it shows up in this repo |
|---|---|
| **Observable state + commands** | `HomeViewModel` (mobile) exposes state via a subscription mechanism; `useDashboard` / `useDeviceDetail` / `useCommandCenter` (web) are MVVM-style hooks returning `{ state, commands }` |
| **Explicit async states** | every viewmodel models `idle / loading / success / empty / error` — never a bare `boolean` |
| **Application Services / Use Cases** | `StartTrackingUseCase`, `SendPanicUseCase`, `HandleRemoteCommandUseCase` (mobile) keep rules out of the ViewModel |
| **Repositories (data access abstraction)** | `LocationRepository`, `CommandRepository` (mobile), `CoreLogClient` (web) |
| **Dependency Injection** | `web/src/di/container.ts`; mobile wires dependencies in `App.tsx` composition root |
| **Local application cache** | `web/src/data/cache/localCache.ts` with TTL — avoids repeated identical REST calls |
| **Feature-based presentation** | one folder per screen/feature in `presentation/` |
| **Observability** | every service exports **OpenTelemetry** traces/logs/metrics over OTLP; the .NET CoreLog backend uses **Serilog** → OpenTelemetry as well (see below) |
| **Testing in CI/CD** | `npm test` in both apps; Docker image build = the "build/test/scan" stage of the pipeline |

---

## Architecture diagrams

### Mobile (React Native, MVVM + Layered)

```
┌──────────────────────────────── PRESENTATION ────────────────────────────────┐
│  HomeScreen.tsx ──(commands)──▶ HomeViewModel.ts ──(observable state)──▶ UI  │
│       │                              │                                       │
│  PanicButton.tsx ────────────────────┘                                       │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │ use cases
┌──────────────────────────────────────▼───────────────────────────────────────┐
│  DOMAIN (pure TypeScript, no React / no I/O)                                 │
│  entities: Position · PanicEvent · RemoteCommand                             │
│  usecases: StartTracking · StopTracking · SendPanic · HandleRemoteCommand    │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │ interfaces (DIP)
┌──────────────────────────────────────▼───────────────────────────────────────┐
│  DATA                                     │  INFRASTRUCTURE                  │
│  LocationRepository                       │  BackgroundServiceBridge (native)│
│  CommandRepository                        │  CoreLogApiClient (axios+retry)  │
│  PositionBuffer (SQLite offline queue)    │  FcmCommandReceiver (FCM)        │
│                                           │  InstallationTracker (app_remove)│
└───────────────────────────────────────┬──────────────────────────────────────┘
                                        │
                 ┌──────────────────────▼───────────────────────┐
                 │   NATIVE BACKGROUND SERVICE (no JS timers)   │
                 │  Android: Foreground Service + WorkManager   │
                 │  iOS: background location updates            │
                 │  collect 60 s ─▶ batch ─▶ POST /api/tracking/events
                 │  network down ─▶ SQLite buffer ─▶ retry w/ backoff
                 └──────────────────────┬───────────────────────┘
                                        ▼
                                   CoreLog API
```

### Web (React, Layered + MVVM hooks)

```
┌──────────────────────────────────── PRESENTATION ────────────────────────────┐
│  DashboardPage  DeviceDetailPage  PanicEventsPage  CommandCenterPage         │
│  components: DeviceMap · DeviceList · PanicAlertBanner                       │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │ hooks (MVVM viewmodels)
┌──────────────────────────────────────▼───────────────────────────────────────┐
│  VIEWMODELS                                                                  │
│  useDashboard · useDeviceDetail · useCommandCenter  ──▶ { state, commands }  │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │
┌──────────────────────────────────────▼───────────────────────────────────────┐
│  DOMAIN: Device · PanicEvent · Command · Tracker   (pure types + rules)      │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │ interfaces (DIP)
┌──────────────────────────────────────▼───────────────────────────────────────┐
│  DATA: CoreLogClient (REST) · localCache (TTL) · SignalRClient (WebSocket)   │
│  DI: di/container.ts constructs everything and injects it                    │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       ▼
   CoreLog REST /api/...          CoreLog SignalR /hubs/tracking
```

---

## How the app talks to CoreLog

```
MOBILE ──HTTP batch──▶ POST /api/tracking/events   (JSON array, 10 positions / 5 min)
MOBILE ──HTTP high─prio──▶ POST /api/panic          (3 retries, else SQLite queue)
CORELOG ──FCM data message──▶ mobile                (SET_FREQUENCY / SILENCE /
                                                     REACTIVATE / REQUEST_IMMEDIATE_POSITION)
MOBILE ──HTTP ack──▶ POST /api/devices/{id}/commands/{commandId}/ack

WEB ──HTTP──▶ /api/panic · /api/devices/{id}/commands · /api/trackers · history queries
WEB ──SignalR──▶ /hubs/tracking  (groups: all-devices, device-{vehicleId})
                  events: PositionReceived · PanicReceived · DeviceStatusChanged · CommandAcked
```

The full contract (endpoints, payloads, SignalR events, FCM data messages) lives in
**[`docs/api-contract.md`](docs/api-contract.md)** and is reproduced verbatim in both
`mobile/README.md` and `web/README.md` so the two clients can never drift apart.

**The web never talks to devices.** All device communication goes through CoreLog
(FCM for mobile, provider APIs for trackers).

---

## Uninstall detection

| Platform | Mechanism | Reliability |
|---|---|---|
| **Android** | Firebase Analytics **`app_remove`** event → Cloud Function (or CoreLog-side webhook) → CoreLog marks the installation as removed | Direct signal |
| **iOS** | No `app_remove` equivalent. CoreLog-side signals: (a) **timeout** — no positions for X minutes ⇒ `PossiblyOffline` / removed, (b) **invalid FCM token** on send failure | Indirect — documented limitation |

The mobile `InstallationTracker` registers the Firebase Analytics instance id with CoreLog so
the backend can correlate `app_remove` with a `vehicle_id`.

## Rejected strategy: "second app for background survival"

**Explicitly rejected.** Shipping a companion/second app, device fingerprinting, or any
mechanism intended to keep tracking alive **after uninstall** violates both store policies:

* Google Play — *Device & Network Abuse*: apps must not persist tracking after uninstall;
  re-installing a hidden component to survive removal is a ban-level violation.
* Apple App Store — Guideline 2.5.4 / 5.1.1: no silent persistence, no re-activation after
  removal, "Always" location must be user-visible and revocable.
* OS level — Android kills the process and removes app data on uninstall; iOS removes the
  sandbox entirely. There is nothing left to run.

The only supported outcomes are: the user stops tracking from the UI, or the backend
detects the absence (timeout / `app_remove` / invalid FCM token) and marks the device offline.

---

## Observability (OpenTelemetry + Serilog → Grafana/Loki/Tempo)

All services in this repository export **OpenTelemetry** data over OTLP to the collector in
`docker-compose.yml`:

| Signal | Source | Backend |
|---|---|---|
| **Traces** | web (browser / server), mobile (when running against the collector) | **Tempo** |
| **Logs** | web + mobile structured logs; CoreLog .NET backend logs via **Serilog** with the OpenTelemetry sink | **Loki** |
| **Metrics** | request counters, outbox/queue gauges | **Prometheus** |

Everything is visualised in **Grafana** (provisioned datasources). The same config maps
1:1 to the Kubernetes manifests in `deploy/k8s/` — swap `localhost` service names for
`Service` DNS and the stack is cluster-ready.

> The .NET CoreLog backend uses `Serilog` + `OpenTelemetry.Extensions.Logging` to emit the
> same OTLP stream (see `observability/serilog-appsettings.example.cs`); the JS services use
> the OpenTelemetry JS SDK. One collector, one dashboard, one place to add a new exporter
> (Jaeger, SigNoz, Datadog, …).

---

## Running

### Everything with Docker Compose (recommended)

```bash
docker compose up --build
```

| Endpoint | URL |
|---|---|
| Web dashboard | http://localhost:8085 (set `WEB_PORT` to change) |
| Grafana (logs/traces/metrics) | http://localhost:3001 (admin / admin) |
| OpenTelemetry collector (OTLP gRPC) | localhost:4317 |
| OpenTelemetry collector (OTLP HTTP) | localhost:4318 |
| Loki | http://localhost:3100 |
| Tempo | http://localhost:3200 |
| Prometheus | http://localhost:9090 |

> Point `web/.env` at a running CoreLog instance (e.g. the `hexagonal-architecture`
> stack on `http://localhost:8090`) to see live data; without it the dashboard still boots
> and shows the offline/empty states.

### Apps only

```bash
cd web   && npm install && npm test && npm run dev     # dashboard
cd mobile && npm install && npm test                   # mobile unit tests
```

### Dashboard against the contract mock (no backend)

The local CoreLog backend (`C:\projects\CoreLog`) only implements ingestion,
trips and `JoinVehicle`/`positionUpdated`; it does not expose the
`devices`/`panic`/`trackers` REST surface nor the `JoinAll`/`PositionReceived`
hub used here. `tools/mock-corelog` implements that contract (zero
dependencies), including a live GPS simulation:

```bash
node tools/mock-corelog/server.mjs --port 8099   # REST + SignalR mock
node tools/mock-corelog/smoke-test.mjs           # 12 end-to-end checks

cd web && npm run dev                            # uses web/.env -> :8099
```

`web/.env` points at the mock; change `VITE_CORELOG_BASE_URL` /
`VITE_SIGNALR_HUB_URL` to talk to a real backend. The Docker stack can be
pointed at the mock too:

```bash
CORELOG_UPSTREAM=http://host.docker.internal:8099 docker compose up -d web
```

### Kubernetes

```bash
docker build -f Dockerfile.web -t <registry>/corelog-web:1.0.0 web
docker push <registry>/corelog-web:1.0.0
kubectl apply -k deploy/k8s
```

---

## Tests

```bash
cd web    && npm test    # useDashboard, useDeviceDetail, command dispatch, localCache
cd mobile && npm test    # HomeViewModel, use cases (mocked repositories),
                         # BackgroundServiceBridge integration test behind a feature flag
```

---

## Documentation index

| Document | Content |
|---|---|
| [`docs/api-contract.md`](docs/api-contract.md) | REST + SignalR + FCM contract (source of truth) |
| [`mobile/README.md`](mobile/README.md) | arquitetura mobile, execução local Android/iOS, build e publicação nas lojas |
| [`store/README.md`](store/README.md) | Google Play (Internal App Sharing), TestFlight, Data safety e checklist |
| [`store/privacy-policy.md`](store/privacy-policy.md) | modelo de política de privacidade (LGPD/GDPR) |
| [`web/README.md`](web/README.md) | dashboard architecture, pages, tracker registration, realtime |

---

## Próximos passos

| # | Ação | Onde |
|---|---|---|
| 1 | Configurar a URL de produção do CoreLog no app mobile | `mobile/src/config/production.ts` |
| 2 | Adicionar credenciais FCM (`google-services.json`, `GoogleService-Info.plist`, APNs) | `mobile/README.md` §8 |
| 3 | Implementar no backend os endpoints `/api/devices`, `/api/panic`, `/api/trackers` e os grupos SignalR `all-devices` | `docs/api-contract.md` |
| 4 | Testar Android via **Internal App Sharing** | `store/README.md` §2 |
| 5 | Testar iOS via **TestFlight** (macOS) | `store/README.md` §4 |
| 6 | Evoluir o app simplificado de portfólio | [fabiossena/CoreLogApp](https://github.com/fabiossena/CoreLogApp) |