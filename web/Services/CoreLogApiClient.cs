using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using CoreLog.Web.Models;

namespace CoreLog.Web.Services;

/// <summary>
/// Typed HTTP client for the CoreLog backend.
///
/// Controllers depend on <see cref="ICoreLogApi"/>; this class owns the wire
/// format (snake_case JSON), query strings and problem+json error parsing.
/// </summary>
public sealed class CoreLogApiClient : ICoreLogApi
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly HttpClient _client;
    private readonly ILogger<CoreLogApiClient> _logger;

    public CoreLogApiClient(HttpClient client, ILogger<CoreLogApiClient> logger)
    {
        _client = client;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<DeviceDto>> GetDevicesAsync(
        CancellationToken cancellationToken = default)
    {
        var response = await GetAsync<ListResponse<DeviceDto>>("api/devices", cancellationToken);
        return response.Items;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<PanicDto>> GetPanicsAsync(
        bool? acknowledged = null,
        int page = 1,
        int size = 50,
        CancellationToken cancellationToken = default)
    {
        var query = $"?page={page}&size={size}";
        if (acknowledged.HasValue)
        {
            query += $"&acknowledged={acknowledged.Value.ToString().ToLowerInvariant()}";
        }

        var response = await GetAsync<ListResponse<PanicDto>>($"api/panic{query}", cancellationToken);
        return response.Items;
    }

    /// <inheritdoc />
    public Task<PanicDto> AcknowledgePanicAsync(
        string panicId,
        string operatorName,
        CancellationToken cancellationToken = default)
    {
        return SendAsync<PanicDto>(
            HttpMethod.Post,
            $"api/panic/{Uri.EscapeDataString(panicId)}/ack",
            new AcknowledgePanicRequest { Operator = operatorName },
            cancellationToken);
    }

    /// <inheritdoc />
    public Task<CommandDto> DispatchCommandAsync(
        string deviceId,
        DispatchCommandRequest request,
        CancellationToken cancellationToken = default)
    {
        return SendAsync<CommandDto>(
            HttpMethod.Post,
            $"api/devices/{Uri.EscapeDataString(deviceId)}/commands",
            request,
            cancellationToken);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<CommandDto>> GetCommandsAsync(
        string deviceId,
        CancellationToken cancellationToken = default)
    {
        var response = await GetAsync<ListResponse<CommandDto>>(
            $"api/devices/{Uri.EscapeDataString(deviceId)}/commands",
            cancellationToken);
        return response.Items;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<TrackerDto>> GetTrackersAsync(
        CancellationToken cancellationToken = default)
    {
        var response = await GetAsync<ListResponse<TrackerDto>>("api/trackers", cancellationToken);
        return response.Items;
    }

    /// <inheritdoc />
    public Task<RegisterTrackerResponse> RegisterTrackerAsync(
        RegisterTrackerRequest request,
        CancellationToken cancellationToken = default)
    {
        return SendAsync<RegisterTrackerResponse>(
            HttpMethod.Post,
            "api/trackers",
            request,
            cancellationToken);
    }

    /// <inheritdoc />
    public async Task DeleteTrackerAsync(
        string trackerId,
        CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(
            HttpMethod.Delete,
            $"api/trackers/{Uri.EscapeDataString(trackerId)}");
        using var response = await _client.SendAsync(request, cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
    }

    private async Task<T> GetAsync<T>(string path, CancellationToken cancellationToken)
    {
        using var response = await _client.GetAsync(path, cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
        var body = await response.Content.ReadFromJsonAsync<T>(JsonOptions, cancellationToken);
        return body ?? throw new CoreLogApiException(
            response.StatusCode,
            "CoreLog returned an empty response body.");
    }

    private async Task<T> SendAsync<T>(
        HttpMethod method,
        string path,
        object body,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(method, path)
        {
            Content = JsonContent.Create(body, options: JsonOptions),
        };
        using var response = await _client.SendAsync(request, cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
        var result = await response.Content.ReadFromJsonAsync<T>(JsonOptions, cancellationToken);
        return result ?? throw new CoreLogApiException(
            response.StatusCode,
            "CoreLog returned an empty response body.");
    }

    private async Task EnsureSuccessAsync(
        HttpResponseMessage response,
        CancellationToken cancellationToken)
    {
        if (response.IsSuccessStatusCode)
        {
            return;
        }

        var title = $"CoreLog respondeu HTTP {(int)response.StatusCode}.";
        try
        {
            var problem = await response.Content.ReadFromJsonAsync<ProblemDto>(
                JsonOptions,
                cancellationToken);
            if (!string.IsNullOrWhiteSpace(problem?.Title))
            {
                title = problem!.Title!;
            }
            else if (!string.IsNullOrWhiteSpace(problem?.Detail))
            {
                title = problem!.Detail!;
            }
        }
        catch (JsonException)
        {
            // Non-JSON body: keep the status message.
        }

        _logger.LogWarning("CoreLog request failed with {StatusCode}: {Title}",
            (int)response.StatusCode, title);
        throw new CoreLogApiException(response.StatusCode, title);
    }

    private sealed class ProblemDto
    {
        [JsonPropertyName("title")] public string? Title { get; set; }
        [JsonPropertyName("detail")] public string? Detail { get; set; }
        [JsonPropertyName("status")] public int? Status { get; set; }
    }
}
