namespace CoreLog.Web.Services;

/// <summary>Configuration for the CoreLog backend (REST + SignalR).</summary>
public sealed class CoreLogOptions
{
    /// <summary>Configuration section name.</summary>
    public const string SectionName = "CoreLog";

    /// <summary>CoreLog REST base URL (no trailing slash).</summary>
    public string BaseUrl { get; set; } = "http://localhost:8090";

    /// <summary>SignalR hub URL used by the browser.</summary>
    public string HubUrl { get; set; } = "http://localhost:8090/hubs/tracking";

    /// <summary>Operator identity sent when acknowledging panics.</summary>
    public string Operator { get; set; } = "web.operator";

    /// <summary>HTTP timeout for REST calls.</summary>
    public int TimeoutSeconds { get; set; } = 15;
}
