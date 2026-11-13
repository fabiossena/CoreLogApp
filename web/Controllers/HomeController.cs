using System.Diagnostics;
using CoreLog.Web.Models;
using CoreLog.Web.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace CoreLog.Web.Controllers;

/// <summary>Dashboard: fleet snapshot, pending panics and real-time map.</summary>
[Route("")]
[Route("dashboard")]
public sealed class HomeController : Controller
{
    private readonly ICoreLogApi _api;
    private readonly CoreLogOptions _options;
    private readonly ILogger<HomeController> _logger;

    public HomeController(ICoreLogApi api, IOptions<CoreLogOptions> options, ILogger<HomeController> logger)
    {
        _api = api;
        _options = options.Value;
        _logger = logger;
    }

    [HttpGet("")]
    public async Task<IActionResult> Index(CancellationToken cancellationToken)
    {
        var viewModel = new DashboardViewModel
        {
            HubUrl = _options.HubUrl,
            CoreLogBaseUrl = _options.BaseUrl,
        };

        try
        {
            var devicesTask = _api.GetDevicesAsync(cancellationToken);
            var panicsTask = _api.GetPanicsAsync(acknowledged: false, cancellationToken: cancellationToken);
            await Task.WhenAll(devicesTask, panicsTask);

            viewModel.Devices = await devicesTask;
            viewModel.PendingPanics = await panicsTask;
        }
        catch (Exception exception)
        {
            _logger.LogError(exception, "Could not load the dashboard from CoreLog.");
            viewModel.Error = exception.Message;
        }

        return View(viewModel);
    }

    [HttpGet("error")]
    [ResponseCache(Duration = 0, Location = ResponseCacheLocation.None, NoStore = true)]
    public IActionResult Error()
    {
        return View(new ErrorViewModel
        {
            RequestId = Activity.Current?.Id ?? HttpContext.TraceIdentifier,
        });
    }
}
