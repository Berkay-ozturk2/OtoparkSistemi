using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using OtoparkSistemi.Api.Dtos;

namespace OtoparkSistemi.Api.Middleware;

/// <summary>Görüntü servisi uç noktalarını X-Api-Key başlığı ile korur (Vision:ApiKey).</summary>
public class VisionApiKeyAttribute : TypeFilterAttribute
{
    public VisionApiKeyAttribute() : base(typeof(VisionApiKeyFilter))
    {
    }
}

public class VisionApiKeyFilter(IConfiguration configuration) : IAuthorizationFilter
{
    public const string HeaderName = "X-Api-Key";

    public void OnAuthorization(AuthorizationFilterContext context)
    {
        var expected = configuration["Vision:ApiKey"];
        if (string.IsNullOrEmpty(expected))
        {
            context.Result = new ObjectResult(new ErrorResponse("Görüntü servisi API anahtarı yapılandırılmamış (Vision:ApiKey)."))
            {
                StatusCode = StatusCodes.Status500InternalServerError
            };
            return;
        }

        var provided = context.HttpContext.Request.Headers[HeaderName].ToString();
        if (string.IsNullOrEmpty(provided) || !FixedTimeEquals(provided, expected))
        {
            context.Result = new UnauthorizedObjectResult(new ErrorResponse("Geçersiz veya eksik API anahtarı (X-Api-Key)."));
        }
    }

    private static bool FixedTimeEquals(string a, string b) =>
        CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(a), Encoding.UTF8.GetBytes(b));
}
