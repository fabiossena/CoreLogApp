using System.Text.Json.Serialization;

namespace CoreLog.Web.Models;

/// <summary>Envelope used by the CoreLog list endpoints.</summary>
public sealed class ListResponse<T>
{
    [JsonPropertyName("items")]
    public List<T> Items { get; set; } = new();
}

/// <summary>A tracked vehicle (`GET /api/devices`).</summary>
public sealed class DeviceDto
{
    [JsonPropertyName("vehicle_id")] public string VehicleId { get; set; } = string.Empty;
    [JsonPropertyName("display_name")] public string DisplayName { get; set; } = string.Empty;
    [JsonPropertyName("status")] public string Status { get; set; } = "Offline";
    [JsonPropertyName("tracking_enabled")] public bool TrackingEnabled { get; set; }
    [JsonPropertyName("source")] public string Source { get; set; } = string.Empty;
    [JsonPropertyName("last_position_at_utc")] public DateTimeOffset? LastPositionAtUtc { get; set; }
    [JsonPropertyName("last_position")] public PositionDto? LastPosition { get; set; }
    [JsonPropertyName("region")] public string? Region { get; set; }
    [JsonPropertyName("trip_id")] public string? TripId { get; set; }
}

/// <summary>A GPS position.</summary>
public sealed class PositionDto
{
    [JsonPropertyName("latitude")] public double Latitude { get; set; }
    [JsonPropertyName("longitude")] public double Longitude { get; set; }
    [JsonPropertyName("timestamp_utc")] public DateTimeOffset? TimestampUtc { get; set; }
    [JsonPropertyName("speed_kmh")] public double? SpeedKmh { get; set; }
}

/// <summary>Last known position attached to a panic.</summary>
public sealed class PanicPositionDto
{
    [JsonPropertyName("latitude")] public double Latitude { get; set; }
    [JsonPropertyName("longitude")] public double Longitude { get; set; }
    [JsonPropertyName("timestamp_utc")] public DateTimeOffset? TimestampUtc { get; set; }
}

/// <summary>A panic (distress) event (`GET /api/panic`).</summary>
public sealed class PanicDto
{
    [JsonPropertyName("panic_id")] public string PanicId { get; set; } = string.Empty;
    [JsonPropertyName("event_id")] public string EventId { get; set; } = string.Empty;
    [JsonPropertyName("vehicle_id")] public string VehicleId { get; set; } = string.Empty;
    [JsonPropertyName("timestamp_utc")] public DateTimeOffset? TimestampUtc { get; set; }
    [JsonPropertyName("last_known_position")] public PanicPositionDto? LastKnownPosition { get; set; }
    [JsonPropertyName("source")] public string Source { get; set; } = string.Empty;
    [JsonPropertyName("acknowledged")] public bool Acknowledged { get; set; }
    [JsonPropertyName("acknowledged_at_utc")] public DateTimeOffset? AcknowledgedAtUtc { get; set; }
    [JsonPropertyName("acknowledged_by")] public string? AcknowledgedBy { get; set; }
}

/// <summary>A command dispatched to a device (`GET /api/devices/{id}/commands`).</summary>
public sealed class CommandDto
{
    [JsonPropertyName("command_id")] public string CommandId { get; set; } = string.Empty;
    [JsonPropertyName("device_id")] public string DeviceId { get; set; } = string.Empty;
    [JsonPropertyName("command_type")] public string CommandType { get; set; } = string.Empty;
    [JsonPropertyName("payload")] public Dictionary<string, object?> Payload { get; set; } = new();
    [JsonPropertyName("status")] public string Status { get; set; } = "Pending";
    [JsonPropertyName("created_at_utc")] public DateTimeOffset? CreatedAtUtc { get; set; }
    [JsonPropertyName("acknowledged_at_utc")] public DateTimeOffset? AcknowledgedAtUtc { get; set; }
    [JsonPropertyName("silenced_until_utc")] public DateTimeOffset? SilencedUntilUtc { get; set; }
    [JsonPropertyName("error")] public string? Error { get; set; }
}

/// <summary>A tracker registered with CoreLog (`GET /api/trackers`).</summary>
public sealed class TrackerDto
{
    [JsonPropertyName("tracker_id")] public string TrackerId { get; set; } = string.Empty;
    [JsonPropertyName("type")] public string Type { get; set; } = string.Empty;
    [JsonPropertyName("name")] public string Name { get; set; } = string.Empty;
    [JsonPropertyName("vehicle_id")] public string VehicleId { get; set; } = string.Empty;
    [JsonPropertyName("polling_interval_seconds")] public int PollingIntervalSeconds { get; set; }
    [JsonPropertyName("credentials")] public Dictionary<string, string> Credentials { get; set; } = new();
    [JsonPropertyName("enabled")] public bool Enabled { get; set; }
    [JsonPropertyName("created_at_utc")] public DateTimeOffset? CreatedAtUtc { get; set; }
}

/// <summary>Response of `POST /api/trackers`.</summary>
public sealed class RegisterTrackerResponse
{
    [JsonPropertyName("tracker_id")] public string TrackerId { get; set; } = string.Empty;
    [JsonPropertyName("type")] public string Type { get; set; } = string.Empty;
    [JsonPropertyName("vehicle_id")] public string VehicleId { get; set; } = string.Empty;
}
