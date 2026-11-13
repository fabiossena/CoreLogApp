# CoreLog Web — ASP.NET Core MVC

Server-rendered dashboard for the CoreLog fleet API: live positions, panic
events, command dispatch and tracker administration.

> The previous dashboard (React + Vite) was replaced by **ASP.NET Core MVC
> (.NET 8)**. There is no Node/npm in this folder: build with `dotnet build`
> and pages are rendered on the server with Razor.

## Stack

| Layer | Technology |
|---|---|
| Web | ASP.NET Core MVC, Razor Views, Tag Helpers |
| HTTP | Typed `HttpClient` + `System.Text.Json` |
| Real time | SignalR JS client (browser) + Leaflet |
| Observability | OpenTelemetry (traces + metrics over OTLP) |
| Tests | xUnit + fake `HttpMessageHandler` (`web.Tests/`) |
| Deploy | Docker multi-stage (`Dockerfile.web`) + Kubernetes |

## Architecture

```
┌──────────────────────── PRESENTATION (MVC) ─────────────────────────┐
│ Controllers: HomeController · PanicController · CommandCenter       │
│ Views: Home/Index · Panic/Index · CommandCenter/Index               │
│ wwwroot: site.css · dashboard.js · command-center.js                │
│ Browser: Leaflet + @microsoft/signalr (local files under lib/)      │
└──────────────────────────────────┬───────────────────────────────────┘
                                   │ ICoreLogApi (typed port)
┌──────────────────────────────────▼───────────────────────────────────┐
│ SERVICES / DATA                                                     │
│ CoreLogApiClient : HttpClient + snake_case JSON + problem+json       │
│ Models: DeviceDto · PanicDto · CommandDto · TrackerDto               │
│ ViewModels: Dashboard · PanicIndex · CommandCenter                   │
└──────────────────────────────────┬───────────────────────────────────┘
                                   ▼
                CoreLog REST /api/...        SignalR /hubs/tracking
```

- **Controllers** orchestrate services and build ViewModels; no direct I/O.
- **Razor Views** are server-rendered; JavaScript only handles the map and
  real-time events.
- **CoreLogApiClient** centralizes base URL, `snake_case` serialization,
  timeouts and `problem+json` errors.
- **Antiforgery** protects every form POST; validation runs on the server.
- **OpenTelemetry** instruments ASP.NET Core and `HttpClient` and exports OTLP.

### Structure

```
web/
├── Program.cs                    # DI, HttpClient, OTel, pipeline
├── CoreLog.Web.csproj
├── appsettings.json              # CoreLog:BaseUrl / HubUrl / Operator
├── Controllers/
│   ├── HomeController.cs         # dashboard
│   ├── PanicController.cs        # list/acknowledge panics
│   └── CommandCenterController.cs# commands + trackers
├── Models/                       # DTOs, requests and ViewModels
├── Services/                     # ICoreLogApi + CoreLogApiClient
├── Views/                        # Razor (Layout + pages)
└── wwwroot/
    ├── css/site.css
    ├── js/dashboard.js           # map + SignalR
    ├── js/command-center.js      # forms + CommandAcked
    └── lib/                      # signalr.js and leaflet (no CDN)
```

## Pages

| Route | Features |
|---|---|
| `/` | Fleet map, device list and pending-panic banner; positions/status over SignalR |
| `/panics` | Filter pending/acknowledged/all + acknowledge as an operator |
| `/commands` | Dispatch a command, view history, register/remove trackers |

Initial data comes from REST (`GET /api/devices`, `/api/panic`, `/api/trackers`);
updates arrive from `/hubs/tracking` (`PositionReceived`, `PanicReceived`,
`DeviceStatusChanged`, `CommandAcked`).

## Run locally

### 1. Contract mock (no backend)

From the repository root:

```bash
node tools/mock-corelog/server.mjs --port 8099
```

`appsettings.json` already points to `http://localhost:8099`.

### 2. MVC application

```bash
dotnet run --project web/CoreLog.Web.csproj --urls http://localhost:8086
```

Open <http://localhost:8086>. Health check: `/health`.

To use a real CoreLog backend, edit `web/appsettings.json` or use environment
variables:

```bash
CoreLog__BaseUrl=http://localhost:8090 \
CoreLog__HubUrl=http://localhost:8090/hubs/tracking \
dotnet run --project web/CoreLog.Web.csproj
```

| Key | Default | Purpose |
|---|---|---|
| `CoreLog:BaseUrl` / `CoreLog__BaseUrl` | `http://localhost:8099` | REST used by the server |
| `CoreLog:HubUrl` / `CoreLog__HubUrl` | `http://localhost:8099/hubs/tracking` | hub used by the **browser** |
| `CoreLog:Operator` / `CoreLog__Operator` | `web.operator` | identity for panic acknowledgement |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4317` | OTLP collector |

> `HubUrl` must be reachable from the browser. In Docker/K8s the `BaseUrl` can
> use an internal DNS name, but `HubUrl` must be public (or routed by an
> Ingress, as in `deploy/k8s/20-web.yaml`).

## Tests

```bash
dotnet test web.Tests/CoreLog.Web.Tests.csproj
```

Cover the `CoreLogApiClient`: list envelope, `snake_case` command payload,
`problem+json` errors and `DELETE 204`.

## Docker

```bash
# from the repository root
docker build -f Dockerfile.web -t corelog-web:1.0.0 .

docker run --rm -p 8085:8080 \
  -e CoreLog__BaseUrl=http://host.docker.internal:8099 \
  -e CoreLog__HubUrl=http://localhost:8099/hubs/tracking \
  corelog-web:1.0.0
```

Or `docker compose up -d web` (port `8085`). The image is multi-stage
(`dotnet/sdk:8.0` → `dotnet/aspnet:8.0`).

## Kubernetes

Manifests live in `deploy/k8s/`:

- `01-configmap.yaml` contains `CoreLog__BaseUrl`, `CoreLog__HubUrl`,
  `CoreLog__Operator` and the OTLP endpoint.
- `20-web.yaml` runs 2 replicas with `/health` probes and an Ingress; the
  `/hubs` path is routed to the `corelog-api` Service so the browser can reach
  SignalR.

```bash
docker build -f Dockerfile.web -t <registry>/corelog-web:1.0.0 .
docker push <registry>/corelog-web:1.0.0
kubectl apply -k deploy/k8s
```

## Decisions

| Decision | Why |
|---|---|
| **MVC + Razor** | Administrative dashboards benefit from server rendering, antiforgery forms and less JavaScript. |
| **Typed `HttpClient`** | Base address, timeout and JSON configured once in DI. |
| **No SPA/npm** | Simpler build/deploy; SignalR/Leaflet are static and versioned in `wwwroot/lib`. |
| **OpenTelemetry** | Same collector/dashboards as the backend and mobile app. |
| **Compiled views** | `RazorGenerate` with `TargetPath` in the `.csproj` avoids RSG002 and embeds views in the assembly. |
