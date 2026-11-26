using OtoparkSistemi.Api.Domain;
using OtoparkSistemi.Api.Services;

namespace OtoparkSistemi.Tests;

public class FeeCalculatorTests
{
    // Sözleşmedeki varsayılan tarife
    private static readonly List<Tariff> Tariffs = new()
    {
        new Tariff { Id = 1, Name = "0-1", MinMinutes = 0, MaxMinutes = 60, Price = 30m, IsActive = true },
        new Tariff { Id = 2, Name = "1-2", MinMinutes = 60, MaxMinutes = 120, Price = 45m, IsActive = true },
        new Tariff { Id = 3, Name = "2-4", MinMinutes = 120, MaxMinutes = 240, Price = 60m, IsActive = true },
        new Tariff { Id = 4, Name = "4-8", MinMinutes = 240, MaxMinutes = 480, Price = 80m, IsActive = true },
        new Tariff { Id = 5, Name = "8-24", MinMinutes = 480, MaxMinutes = 1440, Price = 100m, IsActive = true }
    };

    private static decimal Fee(int minutes, int freeMinutes = 15, decimal dailyMax = 100m) =>
        FeeCalculator.Calculate(TimeSpan.FromMinutes(minutes), Tariffs, freeMinutes, dailyMax);

    [Theory]
    [InlineData(0)]
    [InlineData(5)]
    [InlineData(15)]
    public void Ucretsiz_sure_icinde_ucret_sifirdir(int minutes)
    {
        Assert.Equal(0m, Fee(minutes));
    }

    [Theory]
    [InlineData(16, 30)]
    [InlineData(60, 30)]
    [InlineData(61, 45)]
    [InlineData(120, 45)]
    [InlineData(121, 60)]
    [InlineData(240, 60)]
    [InlineData(300, 80)]
    [InlineData(480, 80)]
    [InlineData(600, 100)]
    [InlineData(1440, 100)]
    public void Sure_dilimine_gore_ucret_hesaplanir(int minutes, int expected)
    {
        Assert.Equal((decimal)expected, Fee(minutes));
    }

    [Fact]
    public void Kesirli_dakika_yukari_yuvarlanir()
    {
        // 60 dk 30 sn → 61 dk → 45 TL
        var fee = FeeCalculator.Calculate(TimeSpan.FromSeconds(60 * 60 + 30), Tariffs, 15, 100m);
        Assert.Equal(45m, fee);
    }

    [Fact]
    public void Gunluk_tavan_dilim_ucretini_sinirlar()
    {
        // 10 saat → dilim 100 TL ama günlük tavan 70 TL
        Assert.Equal(70m, Fee(600, dailyMax: 70m));
    }

    [Fact]
    public void Cok_gunlu_sure_tam_gun_ve_kalan_dilim_toplamidir()
    {
        // 25 saat = 1 tam gün (100) + 60 dk (30) = 130
        Assert.Equal(130m, Fee(25 * 60));
        // 2 gün 3 saat = 200 + 60 = 260
        Assert.Equal(260m, Fee(2 * 1440 + 180));
        // Tam 3 gün = 300
        Assert.Equal(300m, Fee(3 * 1440));
    }

    [Fact]
    public void Cok_gunlu_surede_toplam_tavani_gecmez()
    {
        // Günlük tavan 50: 1 gün 10 saat → 50 + min(100, 50) = 100 = 2 × 50
        Assert.Equal(100m, Fee(1440 + 600, dailyMax: 50m));
    }

    [Fact]
    public void Pasif_tarife_dikkate_alinmaz()
    {
        var tariffs = new List<Tariff>
        {
            new() { MinMinutes = 0, MaxMinutes = 60, Price = 999m, IsActive = false },
            new() { MinMinutes = 0, MaxMinutes = 60, Price = 25m, IsActive = true },
            new() { MinMinutes = 60, MaxMinutes = 1440, Price = 90m, IsActive = true }
        };
        Assert.Equal(25m, FeeCalculator.Calculate(TimeSpan.FromMinutes(30), tariffs, 15, 100m));
    }

    [Fact]
    public void Ucretsiz_sure_sifir_ise_ilk_dakikadan_ucret_alinir()
    {
        Assert.Equal(30m, Fee(1, freeMinutes: 0));
    }
}
