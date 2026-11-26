# Ana backend imajı
#   docker build -t otopark-backend ./backend
#   docker run -p 5080:5080 otopark-backend
# Ayarlar ortam değişkenleriyle ezilebilir:
#   Database__Provider=PostgreSQL
#   ConnectionStrings__PostgreSQL="Host=postgres;Port=5432;Database=otopark;Username=otopark;Password=otopark123"
#   Cors__Origins__0=http://localhost:5173
#   Vision__ApiKey=..., Jwt__Key=...

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY src/OtoparkSistemi.Api/OtoparkSistemi.Api.csproj src/OtoparkSistemi.Api/
RUN dotnet restore src/OtoparkSistemi.Api/OtoparkSistemi.Api.csproj
COPY src/ src/
RUN dotnet publish src/OtoparkSistemi.Api/OtoparkSistemi.Api.csproj -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish .
# appsettings.json içindeki "Urls" (localhost) değerini ezmek için önek SİZ "Urls" kullanılır
# (ASPNETCORE_URLS, appsettings.json'dan daha düşük önceliklidir).
ENV Urls=http://+:5080 \
    ASPNETCORE_ENVIRONMENT=Production
EXPOSE 5080
ENTRYPOINT ["dotnet", "OtoparkSistemi.Api.dll"]
