using CoreLog.Web.Models;

namespace CoreLog.Web.Services;

/// <summary>Port over the CoreLog REST API used by the MVC controllers.</summary>
public interface ICoreLogApi
{
    Task<IReadOnlyList<DeviceDto>> GetDevicesAsync(CancellationToken cancellationToken = default);

    Task<IReadOnlyList<PanicDto>> GetPanicsAsync(
        bool? acknowledged = null,
        int page = 1,
        int size = 50,
        CancellationToken cancellationToken = default);

    Task<PanicDto> AcknowledgePanicAsync(
        string panicId,
        string operatorName,
        CancellationToken cancellationToken = default);

    Task<CommandDto> DispatchCommandAsync(
        string deviceId,
        DispatchCommandRequest request,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<CommandDto>> GetCommandsAsync(
        string deviceId,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<TrackerDto>> GetTrackersAsync(CancellationToken cancellationToken = default);

    Task<RegisterTrackerResponse> RegisterTrackerAsync(
        RegisterTrackerRequest request,
        CancellationToken cancellationToken = default);

    Task DeleteTrackerAsync(string trackerId, CancellationToken cancellationToken = default);
}
