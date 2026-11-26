using Microsoft.EntityFrameworkCore;
using OtoparkSistemi.Api.BackgroundServices;
using OtoparkSistemi.Api.Domain;
using OtoparkSistemi.Api.Dtos;
using OtoparkSistemi.Api.Services;

namespace OtoparkSistemi.Tests;

public class GateServiceTests : IDisposable
{
    private readonly TestDb _t = new();

    public void Dispose() => _t.Dispose();

    private Task<GateDecisionResponse> CameraAsync(GateType gate, string plate, double confidence = 0.95, bool formatValid = true) =>
        _t.Gate.ProcessAsync(new GateInput(gate == GateType.Entry ? "giris-1" : "cikis-1", gate, plate, confidence, formatValid, IsManual: false));

    private Task<GateDecisionResponse> ManualAsync(GateType gate, string plate) =>
        _t.Gate.ProcessAsync(new GateInput("manuel", gate, plate, 1.0, true, IsManual: true));

    private static CardDto GoodCard => new("Test Kullanıcı", "5528790000000008", "12", "2030", "123");

    [Fact]
    public async Task Giris_cift_giris_odeme_ve_cikis_akisi()
    {
        // 1) Giriş → izin, en çok boş NORMAL yeri olan bölge (A: 8 normal + 2 engelli, B: 10 → B)
        var entry = await CameraAsync(GateType.Entry, "34 ABC 123");
        Assert.Equal(GateDecision.Allowed, entry.Decision);
        Assert.Equal("B", entry.SuggestedZone);
        Assert.Equal("GAZI", entry.LotCode);
        Assert.False(entry.IsDisabledPermit);
        Assert.Equal("B01", entry.SuggestedSlot);
        Assert.Equal(SlotType.Standard, entry.SlotType);
        Assert.NotNull(entry.SessionId);
        Assert.Contains("Önerilen bölge: B", entry.Message);

        // 2) Aynı plaka tekrar → red
        var again = await CameraAsync(GateType.Entry, "34ABC123");
        Assert.Equal(GateDecision.Denied, again.Decision);
        Assert.Contains("zaten içeride", again.Message);

        // 3) 90 dk sonra çıkış → ödeme gerekli (60-120 dk dilimi 45 TL)
        _t.Clock.Advance(TimeSpan.FromMinutes(90));
        var exitDenied = await CameraAsync(GateType.Exit, "34ABC123");
        Assert.Equal(GateDecision.Denied, exitDenied.Decision);
        Assert.Equal(45m, exitDenied.Fee);
        Assert.Equal("Ödeme gerekli: 45,00 TL", exitDenied.Message);

        // 4) Girişsiz ödeme: tutar sorgula + kartla öde
        var quote = await _t.Payments.QuoteAsync("34 abc 123");
        Assert.Equal(45m, quote.Amount);
        Assert.False(quote.IsPaid);

        var pay = await _t.Payments.PayAsync(new PayRequest(quote.SessionId, null, GoodCard));
        Assert.Equal(PaymentStatus.Success, pay.Status);
        Assert.Equal(45m, pay.Amount);

        var stored = await _t.Db.Payments.SingleAsync();
        Assert.Equal("0008", stored.CardLast4);

        // 5) Grace süresi içinde çıkış → izin, oturum kapanır
        _t.Clock.Advance(TimeSpan.FromMinutes(5));
        var exitOk = await CameraAsync(GateType.Exit, "34ABC123");
        Assert.Equal(GateDecision.Allowed, exitOk.Decision);

        var session = await _t.Db.ParkingSessions.SingleAsync(s => s.Id == entry.SessionId);
        Assert.Equal(SessionStatus.Completed, session.Status);
        Assert.Equal(45m, session.Fee);
        Assert.Equal(45m, session.PaidAmount);
        Assert.NotNull(session.ExitTime);

        Assert.Equal(4, await _t.Db.GateEvents.CountAsync());
    }

    [Fact]
    public async Task Ucretsiz_sure_icinde_cikis_odemesiz_izinlidir()
    {
        await CameraAsync(GateType.Entry, "06ABC123");
        _t.Clock.Advance(TimeSpan.FromMinutes(10));
        var exit = await CameraAsync(GateType.Exit, "06ABC123");
        Assert.Equal(GateDecision.Allowed, exit.Decision);
        Assert.Equal(0m, exit.Fee);
    }

    [Fact]
    public async Task Grace_suresi_asilinca_fark_ucreti_istenir()
    {
        await CameraAsync(GateType.Entry, "34ABC123");
        _t.Clock.Advance(TimeSpan.FromMinutes(50));
        var quote = await _t.Payments.QuoteAsync("34ABC123");
        Assert.Equal(30m, quote.Amount);
        await _t.Payments.PayAsync(new PayRequest(quote.SessionId, null, GoodCard));

        // Ödemeden 30 dk sonra (grace 15 dk aşıldı) toplam 80 dk → 45 TL; fark 15 TL
        _t.Clock.Advance(TimeSpan.FromMinutes(30));
        var exit = await CameraAsync(GateType.Exit, "34ABC123");
        Assert.Equal(GateDecision.Denied, exit.Decision);
        Assert.Equal(15m, exit.Fee);
    }

    [Fact]
    public async Task Dusuk_guven_onay_kuyruguna_duser_ve_operator_onaylar()
    {
        var r = await CameraAsync(GateType.Entry, "34ABC128", confidence: 0.40);
        Assert.Equal(GateDecision.PendingReview, r.Decision);
        Assert.Null(r.SessionId);

        var review = await _t.Db.PlateReviews.SingleAsync();
        Assert.Equal(ReviewStatus.Pending, review.Status);
        Assert.Equal(0, await _t.Db.ParkingSessions.CountAsync());

        // Operatör plakayı düzeltip onaylar → aynı karar fonksiyonu (manuel)
        var resolved = await _t.Gate.ResolveReviewAsync(review.Id, "34 ABC 123", approve: true, "operator@otopark.local");
        Assert.Equal(GateDecision.Allowed, resolved.Decision);
        Assert.True(await _t.Db.ParkingSessions.AnyAsync(s => s.Plate == "34ABC123" && s.Status == SessionStatus.Active));
        Assert.Equal(0, await _t.Gate.CountPendingReviewsAsync());

        // Aynı kayıt ikinci kez sonuçlandırılamaz
        await Assert.ThrowsAsync<AppException>(() => _t.Gate.ResolveReviewAsync(review.Id, null, true, null));
    }

    [Fact]
    public async Task Bicim_gecersiz_okuma_onay_kuyruguna_duser()
    {
        var r = await CameraAsync(GateType.Entry, "34ABC1Z3", confidence: 0.99, formatValid: false);
        Assert.Equal(GateDecision.PendingReview, r.Decision);
    }

    [Fact]
    public async Task Operator_reddederse_gecis_reddedilir()
    {
        await CameraAsync(GateType.Entry, "34ABC123", confidence: 0.2);
        var review = await _t.Db.PlateReviews.SingleAsync();
        var resolved = await _t.Gate.ResolveReviewAsync(review.Id, null, approve: false, "operator@otopark.local");
        Assert.Equal(GateDecision.Denied, resolved.Decision);
        Assert.Equal(0, await _t.Db.ParkingSessions.CountAsync());
    }

    [Fact]
    public async Task Acik_oturumu_olmayan_cikis_kamera_icin_onaya_manuel_icin_redde_gider()
    {
        var camera = await CameraAsync(GateType.Exit, "34ABC123");
        Assert.Equal(GateDecision.PendingReview, camera.Decision);

        var manual = await ManualAsync(GateType.Exit, "34ABC123");
        Assert.Equal(GateDecision.Denied, manual.Decision);
    }

    [Fact]
    public async Task Otopark_doluysa_giris_reddedilir()
    {
        foreach (var slot in await _t.Db.ParkingSlots.ToListAsync()) slot.IsOccupied = true;
        await _t.Db.SaveChangesAsync();

        var summary = await _t.Parking.GetSummaryAsync();
        Assert.Equal(28, summary.Total);
        Assert.Equal(0, summary.Free);

        var r = await CameraAsync(GateType.Entry, "34ABC123");
        Assert.Equal(GateDecision.Denied, r.Decision);
        Assert.Contains("dolu", r.Message);
    }

    [Fact]
    public async Task Kamera_yokken_aktif_oturumlar_dolulugu_belirler()
    {
        await ManualAsync(GateType.Entry, "34ABC123");
        await ManualAsync(GateType.Entry, "06ABC123");
        var summary = await _t.Parking.GetSummaryAsync();
        Assert.Equal("GAZI", summary.LotCode);
        Assert.Equal(2, summary.Occupied);
        Assert.Equal(24, summary.Free); // 26 normal cep − 2
        Assert.Equal(2, summary.DisabledFree);

        // Normal boş: A(8), B(10), C(8) → iki araç da B'ye önerildi → A(8), B(8), C(8): öneri A, 8 boş, normal cep
        var rec = await _t.Parking.GetRecommendationAsync();
        Assert.Equal("A", rec.ZoneCode);
        Assert.Equal(8, rec.FreeSlots);
        Assert.Equal(SlotType.Standard, rec.SlotType);
        Assert.Equal("A03", rec.SlotCode); // A01, A02 engelli: normal sürücüye önerilmez
    }

    [Fact]
    public async Task Rezervasyonlu_arac_otopark_doluyken_girebilir_ve_on_odeme_dusulur()
    {
        var driverId = (await _t.Db.Users.SingleAsync(u => u.Email == "surucu@otopark.local")).Id;

        var quote = await _t.Reservations.QuoteAsync(null, "B", null, _t.Now.AddMinutes(10), _t.Now.AddMinutes(130));
        Assert.True(quote.Available);
        Assert.Equal(40m, quote.Amount); // 2 saat × 20 TL

        var reservation = await _t.Reservations.CreateAsync(driverId,
            new CreateReservationRequest("06 ABC 123", null, "B", null, _t.Now.AddMinutes(10), _t.Now.AddMinutes(130)));
        Assert.Equal("GAZI", reservation.LotCode);
        Assert.Equal(SlotType.Standard, reservation.SlotType);
        Assert.Equal(ReservationStatus.PendingPayment, reservation.Status);

        var pay = await _t.Payments.PayAsync(new PayRequest(null, reservation.Id, GoodCard));
        Assert.Equal(PaymentStatus.Success, pay.Status);
        Assert.Equal(ReservationStatus.Confirmed, (await _t.Db.Reservations.SingleAsync()).Status);

        // Otopark kamerada tamamen dolu
        foreach (var slot in await _t.Db.ParkingSlots.ToListAsync()) slot.IsOccupied = true;
        await _t.Db.SaveChangesAsync();

        // Rezervasyonsuz araç giremez
        Assert.Equal(GateDecision.Denied, (await CameraAsync(GateType.Entry, "34ABC123")).Decision);

        // Rezervasyonlu araç girer (başlangıçtan 10 dk önce)
        var entry = await CameraAsync(GateType.Entry, "06ABC123");
        Assert.Equal(GateDecision.Allowed, entry.Decision);
        Assert.Equal("B", entry.SuggestedZone);
        Assert.Equal(ReservationStatus.CheckedIn, (await _t.Db.Reservations.SingleAsync()).Status);

        // 60 dk kaldı: tarife 30 TL − ön ödeme 40 TL → ödeme yok
        _t.Clock.Advance(TimeSpan.FromMinutes(60));
        var exit = await CameraAsync(GateType.Exit, "06ABC123");
        Assert.Equal(GateDecision.Allowed, exit.Decision);
        Assert.Equal(ReservationStatus.Completed, (await _t.Db.Reservations.SingleAsync()).Status);
    }

    [Fact]
    public async Task Bolge_kapasitesini_asan_rezervasyon_engellenir()
    {
        var driverId = (await _t.Db.Users.SingleAsync(u => u.Email == "surucu@otopark.local")).Id;
        var start = _t.Now.AddHours(1);
        var end = _t.Now.AddHours(2);

        // C bölgesi 8 cep
        for (var i = 0; i < 8; i++)
            await _t.Reservations.CreateAsync(driverId, new CreateReservationRequest($"34ABC{100 + i}", "GAZI", "C", SlotType.Standard, start, end));

        var quote = await _t.Reservations.QuoteAsync("GAZI", "C", SlotType.Standard, start, end);
        Assert.False(quote.Available);
        await Assert.ThrowsAsync<AppException>(() =>
            _t.Reservations.CreateAsync(driverId, new CreateReservationRequest("34ABC999", "GAZI", "C", SlotType.Standard, start, end)));
    }

    [Fact]
    public async Task Odenmeyen_rezervasyon_15_dk_sonra_iptal_edilir()
    {
        var driverId = (await _t.Db.Users.SingleAsync(u => u.Email == "surucu@otopark.local")).Id;
        await _t.Reservations.CreateAsync(driverId,
            new CreateReservationRequest("06ABC123", null, "A", null, _t.Now.AddHours(1), _t.Now.AddHours(2)));

        var changed = await ReservationExpiryWorker.ApplyAsync(_t.Db, _t.Now.AddMinutes(16));
        Assert.Equal(1, changed);
        Assert.Equal(ReservationStatus.Cancelled, (await _t.Db.Reservations.SingleAsync()).Status);
    }

    [Fact]
    public async Task Saklama_suresi_gecen_oturum_plakasi_anonimlestirilir()
    {
        _t.Db.ParkingSessions.Add(new ParkingSession
        {
            Plate = "34ABC123",
            EntryTime = _t.Now.AddDays(-41),
            ExitTime = _t.Now.AddDays(-40),
            Status = SessionStatus.Completed,
            Fee = 100m,
            PaidAmount = 100m,
            IsPaid = true
        });
        _t.Db.ParkingSessions.Add(new ParkingSession
        {
            Plate = "06ABC123",
            EntryTime = _t.Now.AddHours(-2),
            ExitTime = _t.Now.AddHours(-1),
            Status = SessionStatus.Completed
        });
        await _t.Db.SaveChangesAsync();

        await DataRetentionWorker.ApplyRetentionAsync(_t.Db, _t.Now);

        var plates = await _t.Db.ParkingSessions.Select(s => s.Plate).ToListAsync();
        Assert.Contains(plates, p => p.StartsWith(PlateHelper.HashPrefix));
        Assert.Contains("06ABC123", plates);
    }
}
