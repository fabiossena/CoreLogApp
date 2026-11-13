using CoreLog.Web.Services;
using Microsoft.Extensions.Options;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;

var builder = WebApplication.CreateBuilder(args);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
builder.Services
    .AddOptions<CoreLogOptions>()
    .Bind(builder.Configuration.GetSection(CoreLogOptions.SectionName))
    .Validate(options => Uri.TryCreate(options.BaseUrl, UriKind.Absolute, out _),
        "CoreLog:BaseUrl must be an absolute URL.")
    .ValidateOnStart();

// ---------------------------------------------------------------------------
// MVC + typed CoreLog HTTP client
// ---------------------------------------------------------------------------
builder.Services.AddControllersWithViews();

builder.Services.AddHttpClient<ICoreLogApi, CoreLogApiClient>((serviceProvider, client) =>
{
    var options = serviceProvider.GetRequiredService<IOptions<CoreLogOptions>>().Value;
    client.BaseAddress = new Uri(options.BaseUrl.TrimEnd('/') + "/");
    client.Timeout = TimeSpan.FromSeconds(options.TimeoutSeconds);
    client.DefaultRequestHeaders.Accept.ParseAdd("application/json");
});

// ---------------------------------------------------------------------------
// Observability — traces and metrics over OTLP (endpoint from
// OTEL_EXPORTER_OTLP_ENDPOINT, default http://localhost:4317).
// ---------------------------------------------------------------------------
builder.Services.AddOpenTelemetry()
    .ConfigureResource(resource => resource.AddService("corelog-web"))
    .WithTracing(tracing => tracing
        .AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation()
        .AddOtlpExporter())
    .WithMetrics(metrics => metrics
        .AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation()
        .AddOtlpExporter());

var app = builder.Build();

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------
if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/error");
    app.UseHsts();
}

app.UseStaticFiles();
app.UseRouting();
app.UseAuthorization();

app.MapControllers();
app.MapGet("/health", () => Results.Ok(new
{
    status = "healthy",
    service = "corelog-web-mvc",
    utc = DateTime.UtcNow,
}));

app.Run();
