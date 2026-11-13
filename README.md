# CoreLog — Mobile (MVVM) + Web (MVC)

Two client applications for the **CoreLog** fleet-tracking backend
(.NET 8 / PostgreSQL+PostGIS / Kafka / SignalR):

| App | Stack | Architecture | What it does |
|---|---|---|---|
| **`mobile/`** | React Native (Android + iOS) | **MVVM + Layered** | Background GPS tracking, offline SQLite buffer, panic button and FCM commands |
| **`web/`** | **ASP.NET Core MVC (.NET 8)** + Razor | **MVC + Layered** | Real-time fleet dashboard, panic acknowledgement, commands and tracker management |

```
CoreLogApp/
├── mobile/                 # React Native (MVVM + Layered)
├── web/                    # ASP.NET Core MVC (Razor + SignalR + OpenTelemetry)
├── web.Tests/              # xUnit tests for the MVC API client
├── tools/mock-corelog/     # contract mock (REST + SignalR) for local development
├── docs/api-contract.md    # single source of truth for the REST/SignalR contract
├── docker-compose.yml      # web + observability (OTel, Grafana, Loki, Tempo, Prometheus)
├── Dockerfile.web          # multi-stage .NET build for the dashboard
├── deploy/k8s/             # Kubernetes manifests
└── store/                  # Play/TestFlight release docs and checklists
```

---

## What runs where

| Service | URL / port | Started by |
|---|---|---|
| **Web MVC (development)** | http://localhost:8086 | `dotnet run` |
| **Web MVC (Docker)** | http://localhost:8085 | `docker compose up` |
| **Contract mock** | http://localhost:8099 | `node tools/mock-corelog/server.mjs` |
| **Metro bundler** | http://localhost:8088 (or 8081) | `npx react-native start` |
| **CoreLog backend (real)** | http://localhost:8090 | the `CoreLog` backend repository |
| **Grafana** | http://localhost:3001 (admin/admin) | Docker Compose |
| **Prometheus** | http://localhost:9090 | Docker Compose |
| **Loki / Tempo** | http://localhost:3100 / :3200 | Docker Compose |

---

## Prerequisites

| Tool | Version | Needed for |
|---|---|---|
| Node.js | 18+ (20 recommended) | mobile + mock |
| npm | 10+ | mobile |
| .NET SDK | **8.0** | web MVC |
| Docker Desktop | current | full stack (web + observability) |
| JDK | **17** (`JAVA_HOME`) | Android build |
| Android SDK | API **35**, build-tools **35.0.0**, NDK **26.1.10909125** | Android build |
| Android emulator/device | API 35 | mobile |
| macOS + Xcode | 16+ | iOS only |

---

## Step-by-step: run everything locally

### 1. Start the contract mock (no backend needed)

The real CoreLog backend (separate repository) implements ingestion and trips,
but not the `devices`/`panic`/`trackers` REST surface used by these clients.
`tools/mock-corelog` implements that contract, including a live GPS simulation
and a SignalR hub.

```bash
node tools/mock-corelog/server.mjs --port 8099
```

Verify:

```bash
node tools/mock-corelog/smoke-test.mjs
# 12/12 checks passed
```

### 2. Run the web dashboard (ASP.NET Core MVC)

```bash
dotnet run --project web/CoreLog.Web.csproj --urls http://localhost:8086
```

Open <http://localhost:8086>:

- `/` — fleet map (Leaflet + SignalR), device list and pending panics
- `/panics` — filter and acknowledge panic events
- `/commands` — dispatch commands, command history, register/remove trackers
- `/health` — health check

The API base URL is configured in `web/appsettings.json` and defaults to the
mock (`http://localhost:8099`). To use a real backend:

```bash
CoreLog__BaseUrl=http://localhost:8090 \
CoreLog__HubUrl=http://localhost:8090/hubs/tracking \
dotnet run --project web/CoreLog.Web.csproj --urls http://localhost:8086
```

> `CoreLog__HubUrl` is used by the **browser**; it must be reachable from the
> machine running the browser.

### 3. Run the mobile app (Android)

```bash
cd mobile
npm install
```

Configure the backend in `mobile/src/config/dev.ts`:

```ts
coreLogBaseUrl: 'http://10.0.2.2:8099'  // mock from the Android emulator
vehicleId: 'VEH-001'
```

Start the emulator/device, then Metro in one terminal and the app in another:

```bash
# terminal 1 (inside mobile/)
npx react-native start --port 8088

# terminal 2 (inside mobile/)
adb reverse tcp:8081 tcp:8088
npm run android
```

The `adb reverse` maps the port the debug app expects (8081) to Metro on 8088.
If you prefer to run Metro on the default 8081 and the port is free, skip the
reverse and just run `npm run android`.

Alternatively, set the debug host explicitly:

```bash
adb shell run-as com.corelog.mobile \
  sh -c 'mkdir -p shared_prefs && echo "<map><string name=\"debug_http_host\">10.0.2.2:8088</string></map>" > shared_prefs/com.corelog.mobile_preferences.xml'
```

On Windows, if Gradle fails with `Could not move temporary workspace`, build
from `mobile/android` with a short project cache:

```bash
cd mobile/android
.\gradlew.bat app:installDebug -PreactNativeDevServerPort=8081 --project-cache-dir=C:\gr\corelog
```

Grant location permissions (required for background tracking):

```bash
adb shell pm grant com.corelog.mobile android.permission.ACCESS_FINE_LOCATION
adb shell pm grant com.corelog.mobile android.permission.ACCESS_COARSE_LOCATION
adb shell pm grant com.corelog.mobile android.permission.ACCESS_BACKGROUND_LOCATION
adb shell pm grant com.corelog.mobile android.permission.POST_NOTIFICATIONS
```

In the app: **Start tracking** → positions are buffered natively and POSTed to
`/api/tracking/events`. **PANIC** sends an immediate alert. The mock logs:

```
ingestion: accepted 1/1 position(s)
panic created for VEH-001
```

#### iOS (macOS only)

```bash
cd mobile/ios && pod install && cd ..
npm run ios
```

Use `http://localhost:8099` for the iOS simulator (change
`coreLogBaseUrl` in `src/config/dev.ts`). Background location requires a real
device and the "Always" permission.

### 4. Run the full stack with Docker

```bash
docker compose up --build
```

- Web MVC: <http://localhost:8085>
- Grafana: <http://localhost:3001> (admin/admin)
- Prometheus: <http://localhost:9090>
- OTLP collector: `localhost:4317` (gRPC) / `localhost:4318` (HTTP)

Point it at the mock or a real backend:

```bash
CORELOG_BASE_URL=http://host.docker.internal:8099 \
CORELOG_HUB_URL=http://localhost:8099/hubs/tracking \
docker compose up -d web
```

`CoreLog__BaseUrl` is the server-side REST URL; `CoreLog__HubUrl` is the
browser-visible SignalR URL.

### 5. Point at the real CoreLog backend

| App | Configuration |
|---|---|
| Mobile | `mobile/src/config/dev.ts` (or `production.ts`) `coreLogBaseUrl` |
| Web | `web/appsettings.json` → `CoreLog:BaseUrl` / `CoreLog:HubUrl`, or `CoreLog__*` environment variables |
| Docker | `CORELOG_BASE_URL` / `CORELOG_HUB_URL` |

For production, replace the placeholder in `mobile/src/config/production.ts`
with the real HTTPS URL.

---

## Tests

```bash
# Mobile (Jest + TypeScript)
cd mobile
npm test
npm run typecheck

# Web (xUnit)
dotnet test web.Tests/CoreLog.Web.Tests.csproj
```

Current status: **36 mobile tests + 4 web tests passing**.

---

## Architecture at a glance

### Mobile — MVVM + Layered

```
HomeScreen ──commands──▶ HomeViewModel ──use cases──▶ Domain
    ▲                         │                        │
    └──── observable state ◀──┘                        │ ports
                                                       ▼
                         Data (repositories) + Infrastructure (HTTP, FCM,
                         native background service, SQLite buffer)
```

- Framework-free domain (`src/domain`) and observable ViewModel
  (`src/presentation/viewmodels`).
- Native Android foreground service / iOS CoreLocation does the actual GPS and
  uploads independently of the JS thread.
- See [`mobile/README.md`](mobile/README.md) for details and release steps.

### Web — MVC + Layered

```
Razor Views ──▶ Controllers ──▶ ICoreLogApi (typed HttpClient)
   ▲                │                    │
   └── ViewModels ◀─┘                    ▼
                                   CoreLog REST /api/...
Browser ◀── SignalR /hubs/tracking (Leaflet map + live updates)
```

- `Controllers/` orchestrate use cases; `Services/` own HTTP/JSON concerns;
  `Views/` are server-rendered with antiforgery-protected forms.
- OpenTelemetry instruments ASP.NET Core and `HttpClient` (OTLP).
- See [`web/README.md`](web/README.md) for routes, configuration and deploy.

---

## Configuration reference

| Key | Where | Default |
|---|---|---|
| `coreLogBaseUrl` | `mobile/src/config/dev.ts` | `http://10.0.2.2:8099` |
| `batchSize` / `positionIntervalSeconds` | same | `1` / `15` (demo) |
| `CoreLog:BaseUrl` | `web/appsettings.json` | `http://localhost:8099` |
| `CoreLog:HubUrl` | `web/appsettings.json` | `http://localhost:8099/hubs/tracking` |
| `CoreLog:Operator` | `web/appsettings.json` | `web.operator` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | environment | `http://localhost:4317` |

---

## Troubleshooting (Windows)

| Symptom | Fix |
|---|---|
| `Unable to load script` on Android | Metro not reachable. Run Metro on 8088 and `adb reverse tcp:8081 tcp:8088`, or set `debug_http_host` as shown above. |
| Port 8081 already in use | Another service owns it; use Metro on 8088 and the reverse above. |
| `Could not move temporary workspace` in Gradle | Long path lock. Use `.\gradlew.bat app:installDebug --project-cache-dir=C:\gr\corelog`. |
| Buffer never drains | Fixed in the native service: uploads run on a background executor (not the main thread). |
| Remote command ignored on Android 14+ | Receiver is registered with `RECEIVER_NOT_EXPORTED`; rebuild the APK. |
| Push notifications missing | Add `mobile/android/app/google-services.json` and `mobile/ios/.../GoogleService-Info.plist`; see `mobile/README.md`. |
| Web shows empty states | Mock/backend not running or `CoreLog__BaseUrl` wrong. Open `/health` and check the API URL in the footer. |
| `npm` hangs with nvm4w | Use `node "C:\nvm4w\nodejs\node_modules\npm\bin\npm-cli.js" ...`. |

---

## Release (Play Store / TestFlight)

- **Android**: `mobile/android/version.properties`, upload keystore
  (`mobile/android/keystore/README.md`), `bundleRelease`, then Play Console →
  **Internal app sharing** (`store/README.md` §2).
- **iOS**: Xcode archive → App Store Connect → **TestFlight**
  (`store/README.md` §4).
- Store listing texts and privacy policy templates are in [`store/`](store/).

---

## Documentation index

| Document | Content |
|---|---|
| [`docs/api-contract.md`](docs/api-contract.md) | REST + SignalR + FCM contract |
| [`web/README.md`](web/README.md) | MVC architecture, routes, configuration, tests, deploy |
| [`mobile/README.md`](mobile/README.md) | mobile architecture, local run, release steps |
| [`store/README.md`](store/README.md) | Play Internal App Sharing, TestFlight, Data safety |
| [`store/privacy-policy.md`](store/privacy-policy.md) | LGPD/GDPR privacy policy template |
| [`store/play-listing.md`](store/play-listing.md) | Google Play listing text |
| [`store/app-store-listing.md`](store/app-store-listing.md) | App Store listing text |
| [`store/release-checklist.md`](store/release-checklist.md) | Release checklist |

## License

This repository is a demonstration project. See the individual source files and
the backend repository for licensing details.
