using CoreLog.Web.Models;
using CoreLog.Web.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace CoreLog.Web.Controllers;

/// <summary>Panic events: list, filter and acknowledge.</summary>
[Route("panics")]
public sealed class PanicController : Controller
{
    private readonly ICoreLogApi _api;
    private readonly CoreLogOptions _options;
    private readonly ILogger<PanicController> _logger;

    public PanicController(ICoreLogApi api, IOptions<CoreLogOptions> options, ILogger<PanicController> logger)
    {
        _api = api;
        _options = options.Value;
        _logger = logger;
    }

    [HttpGet("")]
    public async Task<IActionResult> Index(string filter = "pending", CancellationToken cancellationToken = default)
    {
        var normalizedFilter = filter is "pending" or "acknowledged" or "all" ? filter : "pending";
        bool? acknowledged = normalizedFilter switch
        {
            "pending" => false,
            "acknowledged" => true,
            _ => null,
        };

        var viewModel = new PanicIndexViewModel { Filter = normalizedFilter };
        try
        {
            viewModel.Panics = await _api.GetPanicsAsync(
                acknowledged,
                size: 100,
                cancellationToken: cancellationToken);
        }
        catch (Exception exception)
        {
            _logger.LogError(exception, "Could not load panic events.");
            viewModel.Error = exception.Message;
        }

        return View(viewModel);
    }

    [HttpPost("acknowledge/{panicId}")]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Acknowledge(
        string panicId,
        string filter = "pending",
        CancellationToken cancellationToken = default)
    {
        try
        {
            await _api.AcknowledgePanicAsync(panicId, _options.Operator, cancellationToken);
            TempData["Message"] = $"Pânico {panicId} reconhecido por {_options.Operator}.";
        }
        catch (Exception exception)
        {
            _logger.LogError(exception, "Could not acknowledge panic {PanicId}.", panicId);
            TempData["Error"] = exception.Message;
        }

        return RedirectToAction(nameof(Index), new { filter });
    }
}
