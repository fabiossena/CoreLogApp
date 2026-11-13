using System.Net;
using System.Text;
using System.Text.Json;
using CoreLog.Web.Models;
using CoreLog.Web.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace CoreLog.Web.Tests;

public sealed class CoreLogApiClientTests
{
    [Fact]
    public async Task GetDevices_maps_the_items_envelope()
    {
        var handler = new StubHandler(_ => Json(HttpStatusCode.OK,
            """{"items":[{"vehicle_id":"VEH-001","display_name":"Van 01","status":"Online"}]}"""));
        var client = CreateClient(handler);

        var devices = await client.GetDevicesAsync();

        Assert.Single(devices);
        Assert.Equal("VEH-001", devices[0].VehicleId);
        Assert.Equal("Van 01", devices[0].DisplayName);
        Assert.Equal("Online", devices[0].Status);
        Assert.Equal("/api/devices", handler.Requests[0].Path);
    }

    [Fact]
    public async Task DispatchCommand_sends_snake_case_json_to_the_device_endpoint()
    {
        var handler = new StubHandler(_ => Json(HttpStatusCode.Created,
            """{"command_id":"c1","device_id":"VEH-1","command_type":"SET_FREQUENCY","status":"Pending","created_at_utc":"2026-11-12T10:00:00Z"}"""));
        var client = CreateClient(handler);

        var command = await client.DispatchCommandAsync("VEH-1", new DispatchCommandRequest
        {
            CommandType = "SET_FREQUENCY",
            Payload = new Dictionary<string, object?> { ["seconds"] = 30 },
        });

        Assert.Equal("c1", command.CommandId);
        var request = handler.Requests[0];
        Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal("/api/devices/VEH-1/commands", request.Path);
        Assert.Contains("\"command_type\":\"SET_FREQUENCY\"", request.Body);
        Assert.Contains("\"seconds\":30", request.Body);
    }

    [Fact]
    public async Task AcknowledgePanic_uses_the_problem_json_title_on_errors()
    {
        var handler = new StubHandler(_ => Json(HttpStatusCode.BadRequest,
            """{"title":"Pânico já reconhecido.","status":400}"""));
        var client = CreateClient(handler);

        var exception = await Assert.ThrowsAsync<CoreLogApiException>(
            () => client.AcknowledgePanicAsync("p1", "tester"));

        Assert.Equal(HttpStatusCode.BadRequest, exception.StatusCode);
        Assert.Equal("Pânico já reconhecido.", exception.Message);
    }

    [Fact]
    public async Task DeleteTracker_accepts_204_no_content()
    {
        var handler = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.NoContent));
        var client = CreateClient(handler);

        await client.DeleteTrackerAsync("t1");

        Assert.Equal(HttpMethod.Delete, handler.Requests[0].Method);
        Assert.Equal("/api/trackers/t1", handler.Requests[0].Path);
    }

    private static CoreLogApiClient CreateClient(StubHandler handler)
    {
        var httpClient = new HttpClient(handler)
        {
            BaseAddress = new Uri("http://corelog.test/"),
        };
        return new CoreLogApiClient(httpClient, NullLogger<CoreLogApiClient>.Instance);
    }

    private static HttpResponseMessage Json(HttpStatusCode status, string body) => new(status)
    {
        Content = new StringContent(body, Encoding.UTF8, "application/json"),
    };

    private sealed class StubHandler : HttpMessageHandler
    {
        private readonly Func<HttpRequestMessage, HttpResponseMessage> _responder;

        public StubHandler(Func<HttpRequestMessage, HttpResponseMessage> responder)
        {
            _responder = responder;
        }

        public List<CapturedRequest> Requests { get; } = new();

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            var body = request.Content is null
                ? string.Empty
                : await request.Content.ReadAsStringAsync(cancellationToken);
            Requests.Add(new CapturedRequest(
                request.Method,
                request.RequestUri?.AbsolutePath ?? string.Empty,
                body));
            return _responder(request);
        }
    }

    private sealed record CapturedRequest(HttpMethod Method, string Path, string Body);
}
