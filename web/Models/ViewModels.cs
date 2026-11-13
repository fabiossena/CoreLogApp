namespace CoreLog.Web.Models;

/// <summary>View model of the dashboard page.</summary>
public sealed class DashboardViewModel
{
    public IReadOnlyList<DeviceDto> Devices { get; set; } = Array.Empty<DeviceDto>();
    public IReadOnlyList<PanicDto> PendingPanics { get; set; } = Array.Empty<PanicDto>();
    public string HubUrl { get; set; } = string.Empty;
    public string CoreLogBaseUrl { get; set; } = string.Empty;
    public string? Error { get; set; }
}

/// <summary>View model of the panic events page.</summary>
public sealed class PanicIndexViewModel
{
    public IReadOnlyList<PanicDto> Panics { get; set; } = Array.Empty<PanicDto>();
    public string Filter { get; set; } = "pending";
    public string? Error { get; set; }
}

/// <summary>View model of the command center page.</summary>
public sealed class CommandCenterViewModel
{
    public IReadOnlyList<DeviceDto> Devices { get; set; } = Array.Empty<DeviceDto>();
    public IReadOnlyList<TrackerDto> Trackers { get; set; } = Array.Empty<TrackerDto>();
    public IReadOnlyList<CommandDto> Commands { get; set; } = Array.Empty<CommandDto>();
    public string? SelectedDeviceId { get; set; }
    public string HubUrl { get; set; } = string.Empty;
    public string? Error { get; set; }
}

/// <summary>Generic error page model.</summary>
public sealed class ErrorViewModel
{
    public string? RequestId { get; set; }
    public bool ShowRequestId => !string.IsNullOrEmpty(RequestId);
}
