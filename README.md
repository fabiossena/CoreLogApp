# CoreLog Mobile + Web (MVVM · MVC · Layered)

Two deliverables in one repository, both talking to the **CoreLog** backend
(`hexagonal-architecture` repo, .NET 8 / PostgreSQL+PostGIS / Kafka / SignalR):

1. **`mobile/`** — React Native app (Android + iOS) with a **native background service** that
   sends GPS positions every 60 s, buffers offline in SQLite, has a **panic button**, and
   receives remote commands (change frequency, silence, reactivate, request position) from
   CoreLog over FCM.
2. **`web/`** — **ASP.NET Core MVC (.NET 8)** dashboard that **monitors all devices in real
   time** (SignalR + Leaflet), receives panic events, sends commands to specific devices, and
   registers/manages trackers (Sascar, Omnilink, Autotrac, Chinese GPS via Traccar, mobile app
   devices).

```
CoreLogApp/
├── mobile/                 # React Native — MVVM + Layered
├── web/                    # ASP.NET Core MVC — Razor + SignalR + OpenTelemetry
├── docs/api-contract.md    # single source of truth for the REST/SignalR contract
├── docker-compose.yml      # web + observability (OpenTelemetry collector, Grafana, Loki, Tempo, Prometheus)
├── Dockerfile.web          # multi-stage .NET build for the dashboard
├── deploy/k8s/             # Kubernetes manifests (same images/config as compose)
└── README.md               # this file
```

---

## Why MVVM/MVC + Layered (and NOT Hexagonal) here

The CoreLog **backend** uses Hexagonal Architecture because it has *five* external
integrations (Sascar SOAP, Omnilink WSTT, Autotrac API, Traccar, mobile app) and *three*
delivery channels (webhook, SignalR, REST history). Ports/adapters pay for themselves there.

The **mobile app** and the **web dashboard** are the opposite case:

| | Backend | Mobile / Web |
|---|---|---|
| External integrations | 5 inbound + 3 outbound | **1** (CoreLog REST + SignalR) |
| Domain logic | freshness policy, trip window, outbox | trivial (map DTO → view state) |
| Correct abstraction | Ports & Adapters | **Layered + MVVM** (mobile) · **Layered + MVC** (web) |

Adding ports/adapters to a client that has a single integration would create a forest of
one-implementation interfaces — pure YAGNI overhead. Layered Architecture already gives the
two things we actually need:

* **Presentation / Domain / Data / Infrastructure** separation (mobile) or
  **Presentation / Services / Models** (web) — dependencies point inward only.
* **MVVM in the mobile presentation layer** — the View is dumb, the ViewModel owns observable
  state + commands, the Model stays framework-free and unit-testable. The **web** uses
  **MVC**: Razor Views are server-rendered, Controllers orchestrate typed services, and the
  DTOs/ViewModels stay independent of HTTP details.

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
| **Observable state + commands** | `HomeViewModel` (mobile) exposes state via a subscription mechanism; MVC Controllers (web) orchestrate commands and pass ViewModels to Razor views |
| **Explicit async states** | mobile viewmodels model `idle / loading / success / empty / error`; the MVC pages render success/empty/error explicitly |
| **Application Services / Use Cases** | `StartTrackingUseCase`, `SendPanicUseCase`, `HandleRemoteCommandUseCase` (mobile) keep rules out of the ViewModel; `CoreLogApiClient` (web) is the single application service over REST |
| **Repositories (data access abstraction)** | `LocationRepository`, `CommandRepository` (mobile), `ICoreLogApi` (web) |
| **Dependency Injection** | ASP.NET Core DI wires `ICoreLogApi`/`HttpClient` in `web/Program.cs`; mobile wires dependencies in `App.tsx` composition root |
| **Antiforgery + validation** | every MVC form POST validates its model and requires an antiforgery token |
| **Feature-based presentation** | one folder per screen/feature in `presentation/` (mobile) and per Controller/View (web) |
| **Observability** | mobile + web + backend export **OpenTelemetry** over OTLP; the MVC app instruments ASP.NET Core and `HttpClient` |
| **Testing in CI/CD** | `npm test` (mobile) + `dotnet test` (web); Docker image build = the "build/test/scan" stage of the pipeline |

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

### Web (ASP.NET Core MVC, .NET 8)

```
┌──────────────────────────────── PRESENTATION (MVC) ─────────────────────────┐
│ Controllers: HomeController · PanicController · CommandCenterController      │
│ Views: Dashboard · Panic events · Command center (Razor, server-rendered)    │
│ wwwroot: site.css · dashboard.js · command-center.js · Leaflet · SignalR JS  │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │ ICoreLogApi (typed port)
┌──────────────────────────────────────▼───────────────────────────────────────┐
│ SERVICES / DATA                                                              │
│ CoreLogApiClient : HttpClient + System.Text.Json (snake_case + problem+json) │
│ Models: DeviceDto · PanicDto · CommandDto · TrackerDto                       │
│ ViewModels: Dashboard · PanicIndex · CommandCenter                           │
│ DI/composition: Program.cs · Observability: OpenTelemetry (OTLP)             │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       ▼
    CoreLog REST /api/...          CoreLog SignalR /hubs/tracking (browser)
```

> The browser connects directly to the SignalR hub for live positions, panics
> and command acknowledgements; all REST calls go through the MVC server, so
> the web never talks to devices.

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
**[`docs/api-contract.md`](docs/api-contract.md)** and is referenced by both
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

> Point the MVC dashboard at a running CoreLog instance (e.g. the
> `hexagonal-architecture` stack on `http://localhost:8090`) with
> `CoreLog__BaseUrl` / `CoreLog__HubUrl`; without it the dashboard still boots
> and shows the offline/empty states.

### Apps only

```bash
dotnet run --project web/CoreLog.Web.csproj --urls http://localhost:8096  # MVC dashboard
cd mobile && npm install && npm test                                      # mobile unit tests
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

dotnet run --project web/CoreLog.Web.csproj --urls http://localhost:8096
```

`web/appsettings.json` already points at the mock (`http://localhost:8099`).
Change `CoreLog:BaseUrl` / `CoreLog:HubUrl` (or the `CoreLog__*` environment
variables) to talk to a real backend. The Docker stack can be pointed at the
mock too:

```bash
CORELOG_BASE_URL=http://host.docker.internal:8099 \
CORELOG_HUB_URL=http://localhost:8099/hubs/tracking \
docker compose up -d web
```

### Kubernetes

```bash
docker build -f Dockerfile.web -t <registry>/corelog-web:1.0.0 .
docker push <registry>/corelog-web:1.0.0
kubectl apply -k deploy/k8s
```

---

## Tests

```bash
dotnet test web.Tests/CoreLog.Web.Tests.csproj  # MVC: API client + problem+json + snake_case
cd mobile && npm test                           # HomeViewModel, use cases (mocked repositories),
                                                # BackgroundServiceBridge integration (feature flag)
```

---

## Documentation index

| Document | Content |
|---|---|
| [`docs/api-contract.md`](docs/api-contract.md) | REST + SignalR + FCM contract (source of truth) |
| [`mobile/README.md`](mobile/README.md) | arquitetura mobile, execução local Android/iOS, build e publicação nas lojas |
| [`store/README.md`](store/README.md) | Google Play (Internal App Sharing), TestFlight, Data safety e checklist |
| [`store/privacy-policy.md`](store/privacy-policy.md) | modelo de política de privacidade (LGPD/GDPR) |
| [`web/README.md`](web/README.md) | MVC architecture, routes, configuration, tests and deploy |

---

## Próximos passos

| # | Ação | Onde |
|---|---|---|
| 1 | Configurar a URL de produção do CoreLog no app mobile | `mobile/src/config/production.ts` |
| 2 | Adicionar credenciais FCM (`google-services.json`, `GoogleService-Info.plist`, APNs) | `mobile/README.md` §8 |
| 3 | Implementar no backend os endpoints `/api/devices`, `/api/panic`, `/api/trackers` e os grupos SignalR `all-devices` | `docs/api-contract.md` |
| 4 | Testar Android via **Internal App Sharing** | `store/README.md` §2 |
| 5 | Testar iOS via **TestFlight** (macOS) | `store/README.md` §4 |
| 6 | Evoluir o app simplificado de portfólio | [fabiossena/mvvm-layered-app](https://github.com/fabiossena/mvvm-layered-app) |