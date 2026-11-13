# CoreLog Web — ASP.NET Core MVC (.NET 8)

Dashboard server-rendered em **ASP.NET Core MVC (.NET 8 LTS)** para operar a
frota CoreLog: monitoramento em tempo real, eventos de pânico, envio de comandos
e administração de rastreadores.

> O dashboard anterior (React + Vite) foi substituído por MVC. Não há Node/npm
> nesta pasta: o build é `dotnet build`, e as páginas são Razor renderizadas no
> servidor.

## Stack

| Camada | Tecnologia |
|---|---|
| Web | ASP.NET Core MVC, Razor Views, Tag Helpers |
| HTTP | `HttpClient` tipado + `System.Text.Json` |
| Tempo real | SignalR JS client (navegador) + Leaflet |
| Observabilidade | OpenTelemetry (traces + métricas OTLP) |
| Testes | xUnit + `HttpMessageHandler` fake (`web.Tests/`) |
| Deploy | Docker multi-stage (`Dockerfile.web`) + Kubernetes |

## Arquitetura

```
┌──────────────────────── PRESENTATION (MVC) ─────────────────────────┐
│ Controllers: HomeController · PanicController · CommandCenter       │
│ Views: Home/Index · Panic/Index · CommandCenter/Index               │
│ wwwroot: site.css · dashboard.js · command-center.js                │
│ Browser: Leaflet + @microsoft/signalr (arquivos locais em lib/)     │
└──────────────────────────────────┬───────────────────────────────────┘
                                   │ ICoreLogApi (porta tipada)
┌──────────────────────────────────▼───────────────────────────────────┐
│ SERVICES / DATA                                                     │
│ CoreLogApiClient : HttpClient + snake_case JSON + problem+json       │
│ Models: DeviceDto · PanicDto · CommandDto · TrackerDto               │
│ ViewModels: Dashboard · PanicIndex · CommandCenter                   │
└──────────────────────────────────┬───────────────────────────────────┘
                                   ▼
                CoreLog REST /api/...        SignalR /hubs/tracking
```

- **Controllers** orquestram serviços e montam ViewModels; não fazem I/O direto.
- **Razor Views** são server-rendered; o JavaScript só cuida do mapa e dos
  eventos em tempo real.
- **CoreLogApiClient** centraliza URL, serialização `snake_case`, timeouts e
  tratamento de erros `problem+json`.
- **Antiforgery** em todos os POSTs de formulário; validação no servidor.
- **OpenTelemetry** instrumenta ASP.NET Core e `HttpClient` e exporta via OTLP.

### Estrutura

```
web/
├── Program.cs                    # DI, HttpClient, OTel, pipeline
├── CoreLog.Web.csproj
├── appsettings.json              # CoreLog:BaseUrl / HubUrl / Operator
├── Controllers/
│   ├── HomeController.cs         # dashboard
│   ├── PanicController.cs        # listar/reconhecer pânicos
│   └── CommandCenterController.cs# comandos + rastreadores
├── Models/                       # DTOs, requests e ViewModels
├── Services/                     # ICoreLogApi + CoreLogApiClient
├── Views/                        # Razor (Layout + páginas)
└── wwwroot/
    ├── css/site.css
    ├── js/dashboard.js           # mapa + SignalR
    ├── js/command-center.js      # formulários + CommandAcked
    └── lib/                      # signalr.js e leaflet (sem CDN)
```

## Páginas

| Rota | Funcionalidade |
|---|---|
| `/` | Mapa da frota, lista de veículos e banner de pânicos pendentes; posições/status via SignalR |
| `/panics` | Filtro pendentes/reconhecidos/todos + reconhecimento com operador |
| `/commands` | Enviar comando, histórico do veículo, registrar/remover rastreadores |

Os dados iniciais vêm do REST (`GET /api/devices`, `/api/panic`, `/api/trackers`)
e as atualizações chegam do hub `/hubs/tracking` (`PositionReceived`,
`PanicReceived`, `DeviceStatusChanged`, `CommandAcked`).

## Rodar localmente

### 1. Mock do contrato (sem backend)

Na raiz do repositório:

```bash
node tools/mock-corelog/server.mjs --port 8099
```

O `appsettings.json` já aponta para `http://localhost:8099`.

### 2. Aplicação MVC

```bash
dotnet run --project web/CoreLog.Web.csproj --urls http://localhost:8096
```

Abra <http://localhost:8096>. O endpoint de saúde fica em `/health`.

Para usar um CoreLog real, altere `web/appsettings.json` ou use variáveis de
ambiente:

```bash
CoreLog__BaseUrl=http://localhost:8090 \
CoreLog__HubUrl=http://localhost:8090/hubs/tracking \
dotnet run --project web/CoreLog.Web.csproj
```

| Chave | Padrão | Uso |
|---|---|---|
| `CoreLog:BaseUrl` / `CoreLog__BaseUrl` | `http://localhost:8099` | REST usado pelo servidor |
| `CoreLog:HubUrl` / `CoreLog__HubUrl` | `http://localhost:8099/hubs/tracking` | hub usado pelo **navegador** |
| `CoreLog:Operator` / `CoreLog__Operator` | `web.operator` | identidade no ack de pânico |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4317` | collector OTLP |

> `HubUrl` precisa ser acessível a partir do navegador. Em Docker/K8s, o
> `BaseUrl` pode usar DNS interno, mas o `HubUrl` deve ser uma URL pública (ou
> roteada pelo Ingress, como em `deploy/k8s/20-web.yaml`).

## Testes

```bash
dotnet test web.Tests/CoreLog.Web.Tests.csproj
```

Cobrem o `CoreLogApiClient`: envelope de lista, serialização `snake_case` do
comando, `problem+json` em erros e `DELETE 204`.

## Docker

```bash
# a partir da raiz do repositório
docker build -f Dockerfile.web -t corelog-web:1.0.0 .

docker run --rm -p 8085:8080 \
  -e CoreLog__BaseUrl=http://host.docker.internal:8099 \
  -e CoreLog__HubUrl=http://localhost:8099/hubs/tracking \
  corelog-web:1.0.0
```

Ou `docker compose up -d web` (porta `8085`). A imagem é multi-stage
(`dotnet/sdk:8.0` → `dotnet/aspnet:8.0`).

## Kubernetes

Os manifests seguem em `deploy/k8s/`:

- `01-configmap.yaml` contém `CoreLog__BaseUrl`, `CoreLog__HubUrl`,
  `CoreLog__Operator` e o endpoint OTLP.
- `20-web.yaml` roda 2 réplicas com probes em `/health` e Ingress; o path
  `/hubs` é roteado para o Service `corelog-api` para o navegador conectar no
  SignalR.

```bash
docker build -f Dockerfile.web -t <registry>/corelog-web:1.0.0 .
docker push <registry>/corelog-web:1.0.0
kubectl apply -k deploy/k8s
```

## Decisões

| Decisão | Motivo |
|---|---|
| **MVC + Razor** | Dashboard autenticado/administrativo se beneficia de renderização no servidor, formulários com antiforgery e menos JavaScript. |
| **HttpClient tipado** | Timeout, base address e serialização configurados uma vez no DI. |
| **Sem SPA/npm** | Build e deploy mais simples; SignalR/Leaflet são estáticos e versionados em `wwwroot/lib`. |
| **OpenTelemetry** | Mesmo collector/dashboards do backend e do app mobile. |
| **Views compiladas** | `RazorGenerate` com `TargetPath` no `.csproj` evita o aviso RSG002 e embute as views no assembly. |
