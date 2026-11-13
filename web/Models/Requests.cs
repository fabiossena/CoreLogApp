using System.Text.Json.Serialization;

namespace CoreLog.Web.Models;

/// <summary>Body of `POST /api/panic/{panicId}/ack`.</summary>
public sealed class AcknowledgePanicRequest
{
    [JsonPropertyName("operator")] public string Operator { get; set; } = string.Empty;
}

/// <summary>Body of `POST /api/devices/{deviceId}/commands`.</summary>
public sealed class DispatchCommandRequest
{
    [JsonPropertyName("command_type")] public string CommandType { get; set; } = string.Empty;
    [JsonPropertyName("payload")] public Dictionary<string, object?> Payload { get; set; } = new();
}

/// <summary>Body of `POST /api/trackers`.</summary>
public sealed class RegisterTrackerRequest
{
    [JsonPropertyName("type")] public string Type { get; set; } = string.Empty;
    [JsonPropertyName("name")] public string Name { get; set; } = string.Empty;
    [JsonPropertyName("vehicle_id")] public string VehicleId { get; set; } = string.Empty;
    [JsonPropertyName("polling_interval_seconds")] public int PollingIntervalSeconds { get; set; } = 30;
    [JsonPropertyName("credentials")] public Dictionary<string, string> Credentials { get; set; } = new();
    [JsonPropertyName("enabled")] public bool Enabled { get; set; } = true;
}

/// <summary>
/// Form model for the tracker registration screen. The controller builds the
/// per-type credentials dictionary from the relevant fields.
/// </summary>
public sealed class TrackerFormModel
{
    public string Type { get; set; } = "Sascar";
    public string Name { get; set; } = string.Empty;
    public string VehicleId { get; set; } = string.Empty;
    public int PollingIntervalSeconds { get; set; } = 30;
    public bool Enabled { get; set; } = true;

    public string? Plate { get; set; }
    public string? IntegrationUser { get; set; }
    public string? Password { get; set; }

    public string? ExternalFleetId { get; set; }
    public string? WsttUser { get; set; }
    public string? WsttPassword { get; set; }

    public string? FleetId { get; set; }
    public string? ApiKey { get; set; }

    public string? TraccarDeviceId { get; set; }
    public string? ChipModel { get; set; }

    public string? FcmSenderId { get; set; }
}
