// ===========================================================================
// Serilog -> OpenTelemetry example for the CoreLog .NET backend
// ---------------------------------------------------------------------------
// This file is a REFERENCE for the hexagonal-architecture CoreLog repository
// (it is not part of this repo's build). It shows how the .NET side emits the
// same OTLP stream consumed by the collector in docker-compose.yml, so logs,
// traces and metrics from the backend land in the same Grafana dashboards as
// the mobile and web clients.
//
// NuGet packages:
//   Serilog
//   Serilog.AspNetCore
//   OpenTelemetry.Extensions.Hosting
//   OpenTelemetry.Exporter.OpenTelemetryProtocol
//   OpenTelemetry.Instrumentation.AspNetCore
//   OpenTelemetry.Instrumentation.Http
//
// appsettings.json (excerpt):
// ---------------------------------------------------------------------------
// {
//   "Serilog": {
//     "Using": [ "Serilog.Sinks.Console", "Serilog.Sinks.OpenTelemetry" ],
//     "MinimumLevel": {
//     "Default": "Information",
//         "Override": {
//           "Microsoft": "Warning",
//           "Microsoft.AspNetCore": "Warning",
//           "System": "Warning"
//         }
//     },
//     "WriteTo": [
//       { "Name": "Console" },
//       {
//         "Name": "OpenTelemetry",
//         "Args": {
//           "endpoint": "http://otel-collector:4318/v1/logs",
//           "protocol": "http/protobuf",
//           "queueSizeLimit": 10000,
//           "batchPostingLimit": 1000
//         }
//       }
//     ],
//     "Enrich": [ "FromLogContext", "WithMachineName", "WithThreadId" ],
//     "Properties": { "Application": "CoreLog.Api", "service.name": "corelog-api" }
//   }
// }
//
// Program.cs (excerpt) — Serilog bootstrap + OpenTelemetry traces/metrics:
// ---------------------------------------------------------------------------
// Log.Logger = new LoggerConfiguration()
//     .ReadFrom.Configuration(builder.Configuration)
//     .CreateLogger();
//
// builder.Host.UseSerilog();
//
// builder.Services.AddOpenTelemetry()
//     .WithTracing(tracing => tracing
//         .AddAspNetCoreInstrumentation()
//         .AddHttpClientInstrumentation()
//         .AddOtlpExporter(o => o.Endpoint = new Uri(
//             builder.Configuration["Otlp:Endpoint"] ?? "http://otel-collector:4318/v1/traces")))
//     .WithMetrics(metrics => metrics
//         .AddAspNetCoreInstrumentation()
//         .AddHttpClientInstrumentation()
//         .AddOtlpExporter(o => o.Endpoint = new Uri(
//             builder.Configuration["Otlp:Endpoint"] ?? "http://otel-collector:4318/v1/metrics")));
//
// In docker-compose / k8s set:
//   Otlp__Endpoint=http://otel-collector:4318
//
// Result: every log line, span and metric from the .NET backend appears in
// Grafana next to the mobile/web telemetry — one collector, one dashboard.
// ===========================================================================

namespace CoreLog.Observability;

/// <summary>
/// Documentation-only marker type describing the Serilog → OpenTelemetry
/// integration used by the CoreLog backend. No runtime behaviour.
/// </summary>
public static class SerilogOpenTelemetryNotes
{
    /// <summary>OTLP HTTP endpoint of the collector for logs.</summary>
    public const string LogsEndpoint = "http://otel-collector:4318/v1/logs";

    /// <summary>OTLP HTTP endpoint of the collector for traces.</summary>
    public const string TracesEndpoint = "http://otel-collector:4318/v1/traces";

    /// <summary>OTLP HTTP endpoint of the collector for metrics.</summary>
    public const string MetricsEndpoint = "http://otel-collector:4318/v1/metrics";
}