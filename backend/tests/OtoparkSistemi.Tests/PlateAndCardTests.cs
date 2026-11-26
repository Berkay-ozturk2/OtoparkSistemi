using OtoparkSistemi.Api.Services;

namespace OtoparkSistemi.Tests;

public class PlateHelperTests
{
    [Theory]
    [InlineData("34 ABC 123", "34ABC123")]
    [InlineData("34-abc.123", "34ABC123")]
    [InlineData("TR 06 ABC 123", "06ABC123")]
    [InlineData("tr06abc123", "06ABC123")]
    [InlineData("  35 şğ 4567 ", "35SG4567")]
    [InlineData("34 çıö 12", "34CIO12")]
    [InlineData("06 İÜ 789", "06IU789")]
    [InlineData("", "")]
    [InlineData(null, "")]
    public void Plaka_normalize_edilir(string? input, string expected)
    {
        Assert.Equal(expected, PlateHelper.Normalize(input));
    }

    [Theory]
    [InlineData("34ABC123", true)]
    [InlineData("06ABC12", true)]
    [InlineData("34AB1234", true)]
    [InlineData("34A1234", true)]
    [InlineData("34A12345", true)]
    [InlineData("81Z9999", true)]
    [InlineData("00ABC123", false)]
    [InlineData("82ABC123", false)]
    [InlineData("34ABC1234", false)]
    [InlineData("34A12", false)]
    [InlineData("ABC123", false)]
    [InlineData("", false)]
    public void TR_plaka_bicimi_dogrulanir(string plate, bool expected)
    {
        Assert.Equal(expected, PlateHelper.IsValid(plate));
    }

    [Fact]
    public void Plaka_gosterim_bicimine_cevrilir()
    {
        Assert.Equal("34 ABC 123", PlateHelper.Format("34ABC123"));
        Assert.Equal("06 A 1234", PlateHelper.Format("06A1234"));
    }

    [Fact]
    public void Anonimlestirme_geri_dondurulemez_ve_tekrarlanabilirdir()
    {
        var a = PlateHelper.Anonymize("34ABC123");
        Assert.StartsWith(PlateHelper.HashPrefix, a);
        Assert.DoesNotContain("34ABC123", a);
        Assert.Equal(a, PlateHelper.Anonymize("34ABC123"));
        Assert.Equal(a, PlateHelper.Anonymize(a)); // iki kez hash'lenmez
    }
}

public class MockPaymentProviderTests
{
    private static readonly ManualTimeProvider Clock = new(new DateTimeOffset(2026, 11, 25, 8, 0, 0, TimeSpan.Zero));

    private static PaymentProviderResult Charge(string number, string month = "12", string year = "2030", string cvc = "123") =>
        new MockPaymentProvider(Clock)
            .ChargeAsync(new PaymentChargeRequest(45m, new CardInfo("Test Kullanıcı", number, month, year, cvc), "test"))
            .GetAwaiter().GetResult();

    [Theory]
    [InlineData("5528790000000008")]
    [InlineData("4766620000000001")]
    [InlineData("4242 4242 4242 4242")] // Luhn geçerli
    public void Basarili_kartlar(string number)
    {
        var r = Charge(number);
        Assert.True(r.Success);
        Assert.False(string.IsNullOrEmpty(r.TransactionId));
    }

    [Fact]
    public void Yetersiz_bakiye_karti_reddedilir()
    {
        var r = Charge("4111111111111129");
        Assert.False(r.Success);
        Assert.Contains("Yetersiz bakiye", r.Message);
    }

    [Fact]
    public void Luhn_gecersiz_kart_reddedilir()
    {
        Assert.False(Charge("4242424242424241").Success);
    }

    [Fact]
    public void Suresi_gecmis_kart_reddedilir()
    {
        Assert.False(Charge("5528790000000008", "10", "2026").Success);
    }

    [Fact]
    public void Kart_son_dort_hane()
    {
        Assert.Equal("0008", CardHelper.Last4("5528 7900 0000 0008"));
    }
}
