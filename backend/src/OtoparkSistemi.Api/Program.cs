using System.Text;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using OtoparkSistemi.Api.BackgroundServices;
using OtoparkSistemi.Api.Data;
using OtoparkSistemi.Api.Dtos;
using OtoparkSistemi.Api.Hubs;
using OtoparkSistemi.Api.Middleware;
using OtoparkSistemi.Api.Services;

var builder = WebApplication.CreateBuilder(args);
var config = builder.Configuration;

// ---------------- Veritabanı (Sqlite varsayılan, PostgreSQL isteğe bağlı) ----------------
var dbProvider = config["Database:Provider"] ?? "Sqlite";
var usePostgres = dbProvider.Equals("PostgreSQL", StringComparison.OrdinalIgnoreCase)
                  || dbProvider.Equals("Postgres", StringComparison.OrdinalIgnoreCase);

string connectionString;
if (usePostgres)
{
    connectionString = config.GetConnectionString("PostgreSQL")
                       ?? throw new InvalidOperationException("ConnectionStrings:PostgreSQL tanımlı değil.");
}
else
{
    // Göreli SQLite yolunu proje (içerik kök) klasörüne sabitle
    var sqliteBuilder = new SqliteConnectionStringBuilder(config.GetConnectionString("Sqlite") ?? "Data Source=otopark.db");
    if (!string.IsNullOrEmpty(sqliteBuilder.DataSource)
        && sqliteBuilder.DataSource != ":memory:"
        && !Path.IsPathRooted(sqliteBuilder.DataSource))
    {
        sqliteBuilder.DataSource = Path.Combine(builder.Environment.ContentRootPath, sqliteBuilder.DataSource);
    }
    connectionString = sqliteBuilder.ToString();
}

builder.Services.AddDbContext<AppDbContext>(options =>
{
    if (usePostgres) options.UseNpgsql(connectionString);
    else options.UseSqlite(connectionString);
});

// ---------------- MVC + JSON ----------------
builder.Services
    .AddControllers(options =>
    {
        // Zorunlu alan doğrulamasını servislerde Türkçe mesajlarla yapıyoruz
        options.SuppressImplicitRequiredAttributeForNonNullableReferenceTypes = true;
    })
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter());
    });

builder.Services.Configure<ApiBehaviorOptions>(options =>
{
    // Model doğrulama hatalarını da { message } biçiminde döndür
    options.InvalidModelStateResponseFactory = context =>
    {
        var detail = context.ModelState.Values
            .SelectMany(v => v.Errors)
            .Select(e => string.IsNullOrWhiteSpace(e.ErrorMessage) ? e.Exception?.Message : e.ErrorMessage)
            .FirstOrDefault(m => !string.IsNullOrWhiteSpace(m));
        return new BadRequestObjectResult(new ErrorResponse("Geçersiz istek: " + (detail ?? "alanları kontrol edin.")));
    };
});

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter());
});

// ---------------- SignalR ----------------
builder.Services.AddSignalR().AddJsonProtocol(options =>
{
    options.PayloadSerializerOptions.Converters.Add(new JsonStringEnumConverter());
});

// ---------------- JWT ----------------
builder.Services.Configure<JwtOptions>(config.GetSection("Jwt"));
var jwt = config.GetSection("Jwt").Get<JwtOptions>() ?? new JwtOptions();
if (Encoding.UTF8.GetByteCount(jwt.Key) < 32)
    throw new InvalidOperationException("Jwt:Key en az 32 bayt olmalıdır.");

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.MapInboundClaims = false; // "role", "sub", "email" claim adları olduğu gibi kalsın
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = jwt.Issuer,
            ValidateAudience = true,
            ValidAudience = jwt.Audience,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.Key)),
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromMinutes(1),
            NameClaimType = TokenService.NameClaim,
            RoleClaimType = TokenService.RoleClaim
        };
        options.Events = new JwtBearerEvents
        {
            // SignalR: tarayıcı WebSocket'te başlık gönderemediği için token query string'den alınır
            OnMessageReceived = context =>
            {
                var accessToken = context.Request.Query["access_token"].ToString();
                if (!string.IsNullOrEmpty(accessToken) && context.HttpContext.Request.Path.StartsWithSegments("/hubs"))
                    context.Token = accessToken;
                return Task.CompletedTask;
            },
            OnChallenge = async context =>
            {
                context.HandleResponse();
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                await context.Response.WriteAsJsonAsync(new ErrorResponse("Bu işlem için giriş yapmalısınız (oturum geçersiz veya süresi dolmuş)."));
            },
            OnForbidden = async context =>
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                await context.Response.WriteAsJsonAsync(new ErrorResponse("Bu işlem için yetkiniz yok."));
            }
        };
    });
builder.Services.AddAuthorization();

// ---------------- CORS ----------------
var corsOrigins = config.GetSection("Cors:Origins").Get<string[]>() ?? new[] { "http://localhost:5173" };
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy => policy
        .WithOrigins(corsOrigins)
        .AllowAnyHeader()
        .AllowAnyMethod()
        .AllowCredentials());
});

// ---------------- Swagger ----------------
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new OpenApiInfo
    {
        Title = "Görüntü İşleme Destekli Akıllı Otopark Sistemi API",
        Version = "v1",
        Description = "BMT-315 dönem projesi ana backend. Sözleşme: docs/API_SOZLESMESI.md"
    });
    c.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Name = "Authorization",
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
        In = ParameterLocation.Header,
        Description = "/api/auth/login yanıtındaki token değerini girin."
    });
    c.AddSecurityDefinition("ApiKey", new OpenApiSecurityScheme
    {
        Name = VisionApiKeyFilter.HeaderName,
        Type = SecuritySchemeType.ApiKey,
        In = ParameterLocation.Header,
        Description = "Görüntü servisi uç noktaları (/api/vision/*) için X-Api-Key (varsayılan: dev-vision-key)."
    });
    c.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        {
            new OpenApiSecurityScheme
            {
                Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "Bearer" }
            },
            Array.Empty<string>()
        }
    });
    // Ayrı gereksinim nesneleri = "Bearer VEYA ApiKey"
    c.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        {
            new OpenApiSecurityScheme
            {
                Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "ApiKey" }
            },
            Array.Empty<string>()
        }
    });
});

// ---------------- Uygulama servisleri ----------------
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddHttpContextAccessor();
builder.Services.AddSingleton<AgentStatusStore>();
builder.Services.AddSingleton<IRealtimeNotifier, RealtimeNotifier>();
builder.Services.AddSingleton<IPaymentProvider, MockPaymentProvider>();
builder.Services.AddScoped<ParkingService>();
builder.Services.AddScoped<GateService>();
builder.Services.AddScoped<ReservationService>();
builder.Services.AddScoped<PermitService>();
builder.Services.AddSingleton(builder.Configuration.GetSection("Subscriptions").Get<SubscriptionPricing>() ?? new SubscriptionPricing());
builder.Services.AddScoped<SubscriptionService>();
builder.Services.AddScoped<PaymentService>();
builder.Services.AddScoped<ReportService>();
builder.Services.AddScoped<AuditService>();
builder.Services.AddScoped<TokenService>();
builder.Services.AddScoped<DemoDataService>();
builder.Services.AddHostedService<DataRetentionWorker>();
builder.Services.AddHostedService<ReservationExpiryWorker>();

var app = builder.Build();

// ---------------- Veritabanı oluşturma + seed ----------------
// Not: Migration yerine EnsureCreated kullanılır (README'de migration'a geçiş anlatılmıştır).
// Eski şemalı veritabanı (ör. tek otoparklı sürümden kalan otopark.db) tespit edilirse uyarı loglanır,
// veritabanı silinip yeniden oluşturulur ve seed edilir. Şema güncelse veri korunur.
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await SchemaGuard.EnsureDatabaseAsync(db, app.Logger);
}

var paymentProvider = config["Payment:Provider"] ?? "Mock";
if (!paymentProvider.Equals("Mock", StringComparison.OrdinalIgnoreCase))
{
    app.Logger.LogWarning("Payment:Provider = {Provider} henüz uygulanmadı; Mock sağlayıcı kullanılıyor.", paymentProvider);
}
app.Logger.LogInformation("Veritabanı sağlayıcısı: {Provider}", usePostgres ? "PostgreSQL" : "Sqlite");

// ---------------- HTTP hattı ----------------
app.UseMiddleware<ErrorHandlingMiddleware>();

app.UseSwagger();
app.UseSwaggerUI(c =>
{
    c.SwaggerEndpoint("/swagger/v1/swagger.json", "Akıllı Otopark API v1");
    c.DocumentTitle = "Akıllı Otopark API";
});

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapHub<ParkingHub>("/hubs/parking");
app.MapGet("/", () => Results.Redirect("/swagger")).ExcludeFromDescription();

app.Run();
