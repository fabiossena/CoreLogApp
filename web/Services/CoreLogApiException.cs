using System.Net;

namespace CoreLog.Web.Services;

/// <summary>Raised when CoreLog returns a non-success status code.</summary>
public sealed class CoreLogApiException : Exception
{
    public CoreLogApiException(HttpStatusCode statusCode, string message)
        : base(message)
    {
        StatusCode = statusCode;
    }

    /// <summary>HTTP status returned by CoreLog.</summary>
    public HttpStatusCode StatusCode { get; }
}
