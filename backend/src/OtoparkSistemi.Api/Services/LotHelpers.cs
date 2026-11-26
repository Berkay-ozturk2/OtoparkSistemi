using System.Text.Json;
using OtoparkSistemi.Api.Domain;
using OtoparkSistemi.Api.Dtos;

namespace OtoparkSistemi.Api.Services;

/// <summary>Otopark kodu varsayılanları (tek yerde tanımlı).</summary>
public static class LotDefaults
{
    /// <summary>lot parametresi / lotCode alanı verilmeyen her istek bu otoparka uygulanır (geriye dönük uyum).</summary>
    public const string DefaultLotCode = "GAZI";

    /// <summary>Boş → GAZI, aksi hâlde kırpılmış büyük harf kod.</summary>
    public static string Normalize(string? lotCode) =>
        string.IsNullOrWhiteSpace(lotCode) ? DefaultLotCode : lotCode.Trim().ToUpperInvariant();

    /// <summary>Boş → null (filtre yok), aksi hâlde kırpılmış büyük harf kod.</summary>
    public static string? NormalizeOptional(string? lotCode) =>
        string.IsNullOrWhiteSpace(lotCode) ? null : lotCode.Trim().ToUpperInvariant();
}

/// <summary>ParkingLot.FloorsJson / DecorJson dönüşümleri.</summary>
public static class LotJson
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);

    public static string Serialize<T>(T value) => JsonSerializer.Serialize(value, Options);

    public static List<FloorDto> Floors(ParkingLot lot) => Deserialize<FloorDto>(lot.FloorsJson);

    public static List<MapDecorDto> Decor(ParkingLot lot) => Deserialize<MapDecorDto>(lot.DecorJson);

    private static List<T> Deserialize<T>(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new List<T>();
        try
        {
            return JsonSerializer.Deserialize<List<T>>(json, Options) ?? new List<T>();
        }
        catch (JsonException)
        {
            return new List<T>();
        }
    }

    public static ParkingLotDto ToDto(ParkingLot lot) =>
        new(lot.Id, lot.Code, lot.Name, lot.Address, lot.Description, lot.MapWidth, lot.MapHeight,
            Floors(lot), Decor(lot), lot.IsActive);
}
