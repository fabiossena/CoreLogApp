using CoreLog.Web.Models;
using CoreLog.Web.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace CoreLog.Web.Controllers;

/// <summary>Command dispatch, command history and tracker administration.</summary>
[Route("commands")]
public sealed class CommandCenterController : Controller
{
    private static readonly HashSet<string> CommandTypes = new(StringComparer.Ordinal)
    {
        "SET_FREQUENCY", "SILENCE", "REACTIVATE", "REQUEST_IMMEDIATE_POSITION",
    };

    private static readonly HashSet<string> TrackerTypes = new(StringComparer.Ordinal)
    {
        "Sascar", "Omnilink", "Autotrac", "ChineseGPS", "MobileApp",
    };

    private readonly ICoreLogApi _api;
    private readonly CoreLogOptions _options;
    private readonly ILogger<CommandCenterController> _logger;

    public CommandCenterController(
        ICoreLogApi api,
        IOptions<CoreLogOptions> options,
        ILogger<CommandCenterController> logger)
    {
        _api = api;
        _options = options.Value;
        _logger = logger;
    }

    [HttpGet("")]
    public async Task<IActionResult> Index(string? deviceId, CancellationToken cancellationToken)
    {
        var viewModel = new CommandCenterViewModel
        {
            HubUrl = _options.HubUrl,
            SelectedDeviceId = string.IsNullOrWhiteSpace(deviceId) ? null : deviceId,
        };

        try
        {
            var devicesTask = _api.GetDevicesAsync(cancellationToken);
            var trackersTask = _api.GetTrackersAsync(cancellationToken);
            await Task.WhenAll(devicesTask, trackersTask);

            viewModel.Devices = await devicesTask;
            viewModel.Trackers = await trackersTask;

            if (viewModel.SelectedDeviceId is not null)
            {
                viewModel.Commands = await _api.GetCommandsAsync(
                    viewModel.SelectedDeviceId,
                    cancellationToken);
            }
        }
        catch (Exception exception)
        {
            _logger.LogError(exception, "Could not load the command center.");
            viewModel.Error = exception.Message;
        }

        return View(viewModel);
    }

    [HttpPost("dispatch")]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Dispatch(
        string deviceId,
        string commandType,
        int? seconds,
        int? durationSeconds,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(deviceId) || !CommandTypes.Contains(commandType))
        {
            TempData["Error"] = "Selecione um veículo e um tipo de comando válido.";
            return RedirectToAction(nameof(Index));
        }

        var payload = new Dictionary<string, object?>();
        switch (commandType)
        {
            case "SET_FREQUENCY":
                if (seconds is null or <= 0)
                {
                    TempData["Error"] = "Informe um intervalo positivo (segundos).";
                    return RedirectToAction(nameof(Index), new { deviceId });
                }
                payload["seconds"] = seconds.Value;
                break;
            case "SILENCE":
                if (durationSeconds is null or <= 0)
                {
                    TempData["Error"] = "Informe uma duração positiva (segundos).";
                    return RedirectToAction(nameof(Index), new { deviceId });
                }
                payload["duration_seconds"] = durationSeconds.Value;
                break;
        }

        try
        {
            var command = await _api.DispatchCommandAsync(
                deviceId,
                new DispatchCommandRequest
                {
                    CommandType = commandType,
                    Payload = payload,
                },
                cancellationToken);

            TempData["Message"] =
                $"Comando {command.CommandType} enviado para {deviceId} (id {command.CommandId}).";
        }
        catch (Exception exception)
        {
            _logger.LogError(exception, "Could not dispatch {CommandType} to {DeviceId}.",
                commandType, deviceId);
            TempData["Error"] = exception.Message;
        }

        return RedirectToAction(nameof(Index), new { deviceId });
    }

    [HttpPost("trackers")]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> RegisterTracker(
        [FromForm] TrackerFormModel form,
        CancellationToken cancellationToken)
    {
        if (!TrackerTypes.Contains(form.Type))
        {
            TempData["Error"] = "Tipo de rastreador inválido.";
            return RedirectToAction(nameof(Index));
        }
        if (string.IsNullOrWhiteSpace(form.Name) || string.IsNullOrWhiteSpace(form.VehicleId))
        {
            TempData["Error"] = "Informe o nome e o veículo do rastreador.";
            return RedirectToAction(nameof(Index));
        }

        var credentials = new Dictionary<string, string>();
        string? missing = null;

        void Require(string? value, string key, string label)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                missing ??= label;
                return;
            }
            credentials[key] = value.Trim();
        }

        switch (form.Type)
        {
            case "Sascar":
                Require(form.Plate, "plate", "placa");
                Require(form.IntegrationUser, "integration_user", "usuário de integração");
                Require(form.Password, "password", "senha");
                break;
            case "Omnilink":
                Require(form.ExternalFleetId, "external_fleet_id", "fleet id externo");
                Require(form.WsttUser, "wstt_user", "usuário WSTT");
                Require(form.WsttPassword, "wstt_password", "senha WSTT");
                break;
            case "Autotrac":
                Require(form.FleetId, "fleet_id", "fleet id");
                Require(form.ApiKey, "api_key", "API key");
                break;
            case "ChineseGPS":
                Require(form.TraccarDeviceId, "traccar_device_id", "device id do Traccar");
                Require(form.ChipModel, "chip_model", "modelo do chip");
                break;
            case "MobileApp":
                if (!string.IsNullOrWhiteSpace(form.FcmSenderId))
                {
                    credentials["fcm_sender_id"] = form.FcmSenderId.Trim();
                }
                break;
        }

        if (missing is not null)
        {
            TempData["Error"] = $"Credencial obrigatória ausente: {missing}.";
            return RedirectToAction(nameof(Index));
        }

        try
        {
            var created = await _api.RegisterTrackerAsync(
                new RegisterTrackerRequest
                {
                    Type = form.Type,
                    Name = form.Name.Trim(),
                    VehicleId = form.VehicleId.Trim(),
                    PollingIntervalSeconds = form.PollingIntervalSeconds,
                    Credentials = credentials,
                    Enabled = form.Enabled,
                },
                cancellationToken);

            TempData["Message"] =
                $"Rastreador {created.Type} registrado para {created.VehicleId} (id {created.TrackerId}).";
        }
        catch (Exception exception)
        {
            _logger.LogError(exception, "Could not register tracker {TrackerName}.", form.Name);
            TempData["Error"] = exception.Message;
        }

        return RedirectToAction(nameof(Index));
    }

    [HttpPost("trackers/{trackerId}/delete")]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> DeleteTracker(
        string trackerId,
        CancellationToken cancellationToken)
    {
        try
        {
            await _api.DeleteTrackerAsync(trackerId, cancellationToken);
            TempData["Message"] = $"Rastreador {trackerId} removido.";
        }
        catch (Exception exception)
        {
            _logger.LogError(exception, "Could not delete tracker {TrackerId}.", trackerId);
            TempData["Error"] = exception.Message;
        }

        return RedirectToAction(nameof(Index));
    }
}
