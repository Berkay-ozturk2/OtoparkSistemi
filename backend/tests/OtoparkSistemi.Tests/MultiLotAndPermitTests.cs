using Microsoft.EntityFrameworkCore;
using OtoparkSistemi.Api.BackgroundServices;
using OtoparkSistemi.Api.Data;
using OtoparkSistemi.Api.Domain;
using OtoparkSistemi.Api.Dtos;
using OtoparkSistemi.Api.Services;

namespace OtoparkSistemi.Tests;

/// <summary>Sözleşme bölüm 11: çoklu otopark, engelli park yerleri, izinler ve ihlaller.</summary>
public class MultiLotAndPermitTests : IDisposable
{
    private readonly TestDb _t = new();

    public void Dispose() => _t.Dispose();

    private Task<GateDecisionResponse> EnterAsync(string plate, string? lot = null) =>
        _t.Gate.ProcessAsync(new GateInput("giris-1", GateType.Entry, plate, 0.95, true, IsManual: false, LotCode: lot));

    private Task<GateDecisionResponse> ExitAsync(string plate, string? lot = null) =>
        _t.Gate.ProcessAsync(new GateInput("cikis-1", GateType.Exit, plate, 0.95, true, IsManual: false, LotCode: lot));

    private async Task OccupyAllStandardAsync(string lotCode)
    {
        var slots = await _t.Db.ParkingSlots
            .Include(s => s.Zone).ThenInclude(z => z!.Lot)
            .ToListAsync();
        foreach (var slot in slots.Where(x => x.Zone!.Lot!.Code == lotCode && x.Type == SlotType.Standard))
            slot.IsOccupied = true;
        await _t.Db.SaveChangesAsync();
    }

    private Task<SlotUpdateResult> CameraAsync(ParkingLot lot, string code, bool occupied) =>
        _t.Parking.ApplySlotStatesAsync(lot, new[] { (code, occupied, (double?)0.9) });

    private async Task<int> DriverIdAsync() =>
        (await _t.Db.Users.SingleAsync(u => u.Email == "surucu@otopark.local")).Id;

    // ======================= Seed =======================

    [Fact]
    public async Task Seed_otoparklarinin_cep_ve_engelli_sayilari_dogru()
    {
        var lots = await _t.Db.ParkingLots.AsNoTracking()
            .Include(l => l.Zones).ThenInclude(z => z.Slots)
            .ToListAsync();
        var expected = new Dictionary<string, (int Total, int Disabled)>
        {
            ["GAZI"] = (28, 2),
            ["MERKEZ"] = (96, 9),
            ["AVM"] = (144, 10),
            ["HASTANE"] = (60, 10),
            ["AKARBASI"] = (40, 1),
            ["MAHMUDIYE"] = (46, 0),
            ["ERTUGRULGAZI"] = (43, 0)
        };
        Assert.Equal(expected.Count, lots.Count);

        foreach (var lot in lots)
        {
            Assert.True(expected.ContainsKey(lot.Code), $"Beklenmeyen otopark: {lot.Code}");
            var slots = lot.Zones.SelectMany(z => z.Slots).ToList();
            Assert.Equal(expected[lot.Code].Total, slots.Count);
            Assert.Equal(expected[lot.Code].Disabled, slots.Count(s => s.Type == SlotType.Disabled));

            // Cep kodları otopark içinde benzersiz
            Assert.Equal(slots.Count, slots.Select(s => s.Code).Distinct(StringComparer.OrdinalIgnoreCase).Count());
            // Bölge kodları otopark içinde benzersiz
            Assert.Equal(lot.Zones.Count, lot.Zones.Select(z => z.Code).Distinct().Count());
        }

        var summaries = await _t.Parking.GetLotsAsync();
        Assert.Equal(expected.Keys.ToArray(), summaries.Select(l => l.Code).ToArray());
        Assert.Equal(26, summaries.Single(l => l.Code == "GAZI").FreeSlots); // normal araçlar için boş
        Assert.Equal(2, summaries.Single(l => l.Code == "GAZI").DisabledFree);
        Assert.Equal(3, summaries.Single(l => l.Code == "MERKEZ").Floors.Count);
    }

    [Fact]
    public async Task Saha_krokileri_mevcut_veriler_korunarak_bir_kez_eklenir()
    {
        var lots = await _t.Db.ParkingLots.ToListAsync();
        var gazi = lots.Single(l => l.Code == "GAZI");
        gazi.Name = "Güncellenmiş pilot";
        _t.Db.ParkingLots.RemoveRange(lots.Where(l => l.Code is "AKARBASI" or "MAHMUDIYE" or "ERTUGRULGAZI"));
        await _t.Db.SaveChangesAsync();

        await DbSeeder.SeedAsync(_t.Db);
        await DbSeeder.SeedAsync(_t.Db);

        var summaries = await _t.Parking.GetLotsAsync();
        Assert.Equal("Güncellenmiş pilot", summaries.Single(l => l.Code == "GAZI").Name);
        Assert.Null(summaries.Single(l => l.Code == "GAZI").SiteReference);
        var referenceLots = summaries.Where(l => l.SiteReference != null).ToList();
        Assert.Equal(3, referenceLots.Count);
        foreach (var lot in referenceLots)
        {
            var layout = await _t.Parking.GetLayoutAsync(lot.Code);
            Assert.Equal(lot.SiteReference, layout.Lot.SiteReference);
            Assert.Equal(lot.TotalSlots, layout.Slots.Count);
            Assert.Contains(layout.Lot.Decor, d => d.Type == "surface");
            Assert.Contains(layout.Lot.Decor, d => d.Type == "access");
        }
    }

    [Fact]
    public async Task Seed_cepler_tuval_icinde_ve_ayni_katta_cakismiyor()
    {
        var lots = await _t.Db.ParkingLots.AsNoTracking()
            .Include(l => l.Zones).ThenInclude(z => z.Slots)
            .ToListAsync();

        foreach (var lot in lots)
        {
            var slots = lot.Zones.SelectMany(z => z.Slots.Select(s => (Slot: s, z.Floor))).ToList();
            foreach (var (s, _) in slots)
            {
                Assert.True(s.MapX >= 0 && s.MapY >= 0 && s.MapW > 0 && s.MapH > 0, $"{lot.Code}/{s.Code} geçersiz boyut");
                Assert.True(s.MapX + s.MapW <= lot.MapWidth, $"{lot.Code}/{s.Code} tuvalin sağına taşıyor");
                Assert.True(s.MapY + s.MapH <= lot.MapHeight, $"{lot.Code}/{s.Code} tuvalin altına taşıyor");
            }

            for (var i = 0; i < slots.Count; i++)
            {
                for (var j = i + 1; j < slots.Count; j++)
                {
                    if (slots[i].Floor != slots[j].Floor) continue;
                    var a = slots[i].Slot;
                    var b = slots[j].Slot;
                    var overlap = a.MapX < b.MapX + b.MapW && b.MapX < a.MapX + a.MapW
                                  && a.MapY < b.MapY + b.MapH && b.MapY < a.MapY + a.MapH;
                    Assert.False(overlap, $"{lot.Code}: {a.Code} ile {b.Code} çakışıyor");
                }
            }

            foreach (var d in LotJson.Decor(lot))
            {
                Assert.True(d.X >= 0 && d.Y >= 0 && d.X + d.W <= lot.MapWidth && d.Y + d.H <= lot.MapHeight,
                    $"{lot.Code}: {d.Type} süsü tuvalin dışında");
            }
            Assert.NotEmpty(LotJson.Decor(lot));
        }

        // Katlı otoparkta kat bazlı süs (floor) bulunur
        var merkez = lots.Single(l => l.Code == "MERKEZ");
        Assert.Contains(LotJson.Decor(merkez), d => d.Floor == -1);
        Assert.Contains(LotJson.Decor(merkez), d => d.Floor == null);

        // GAZI eski kroki koordinatları korunur (görüntü servisi uyumu)
        var gazi = lots.Single(l => l.Code == "GAZI");
        var gaziSlots = gazi.Zones.SelectMany(z => z.Slots).ToDictionary(s => s.Code);
        Assert.Equal((60, 60, 80, 120), (gaziSlots["A01"].MapX, gaziSlots["A01"].MapY, gaziSlots["A01"].MapW, gaziSlots["A01"].MapH));
        Assert.Equal(60 + 7 * 88, gaziSlots["C08"].MapX);
        Assert.Equal(460, gaziSlots["C08"].MapY);
        Assert.Equal(SlotType.Disabled, gaziSlots["A02"].Type);
        Assert.Equal(SlotType.Standard, gaziSlots["A03"].Type);

        // Engelli cepler (GAZI hariç) normal cepten %40 geniş
        var hastane = lots.Single(l => l.Code == "HASTANE").Zones.SelectMany(z => z.Slots).ToDictionary(s => s.Code);
        Assert.Equal(70, hastane["P01"].MapW);
        Assert.Equal(50, hastane["P07"].MapW);
    }

    [Fact]
    public async Task Bilinmeyen_otopark_404_doner()
    {
        var ex = await Assert.ThrowsAsync<AppException>(() => _t.Parking.GetSummaryAsync("YOK"));
        Assert.Equal(404, ex.StatusCode);
        Assert.Equal("Otopark bulunamadı", ex.Message);

        var gateEx = await Assert.ThrowsAsync<AppException>(() => EnterAsync("34ABC123", "YOK"));
        Assert.Equal(404, gateEx.StatusCode);
    }

    // ======================= Öneri ve giriş =======================

    [Fact]
    public async Task Normal_surucuye_engelli_cep_onerilmez_izinliye_onerilir()
    {
        var normal = await _t.Parking.GetRecommendationAsync("GAZI");
        Assert.Equal("B", normal.ZoneCode);
        Assert.Equal(SlotType.Standard, normal.SlotType);

        var disabled = await _t.Parking.GetRecommendationAsync("GAZI", disabled: true);
        Assert.Equal("A", disabled.ZoneCode);
        Assert.Equal("A01", disabled.SlotCode);
        Assert.Equal(SlotType.Disabled, disabled.SlotType);
        Assert.Equal(2, disabled.FreeSlots);
    }

    [Fact]
    public async Task Izinsiz_arac_yalnizca_engelli_yer_bosken_reddedilir_izinli_arac_girer()
    {
        await OccupyAllStandardAsync("GAZI");
        var summary = await _t.Parking.GetSummaryAsync("GAZI");
        Assert.Equal(0, summary.Free);
        Assert.Equal(2, summary.DisabledFree);

        var denied = await EnterAsync("34ABC123");
        Assert.Equal(GateDecision.Denied, denied.Decision);
        Assert.Equal("Otopark dolu. Kalan yerler engelli araçlara ayrılmıştır.", denied.Message);
        Assert.False(await _t.Db.ParkingSessions.AnyAsync(s => s.Plate == "34ABC123"));

        // Plaka normalize edilerek eşleşir
        var allowed = await EnterAsync("06 eng 061");
        Assert.Equal(GateDecision.Allowed, allowed.Decision);
        Assert.True(allowed.IsDisabledPermit);
        Assert.Equal("A", allowed.SuggestedZone);
        Assert.Equal("A01", allowed.SuggestedSlot);
        Assert.Equal(SlotType.Disabled, allowed.SlotType);

        var session = await _t.Db.ParkingSessions.Include(s => s.Lot).SingleAsync(s => s.Plate == "06ENG061");
        Assert.True(session.IsDisabledPermit);
        Assert.Equal("GAZI", session.Lot!.Code);

        var ev = await _t.Db.GateEvents.OrderByDescending(e => e.Id).FirstAsync();
        Assert.Equal("GAZI", ev.LotCode);
        Assert.True(ev.IsDisabledPermit);
    }

    [Fact]
    public async Task Izinli_araca_baska_otoparkta_engelli_cep_onerilir_ve_oturum_o_otoparka_yazilir()
    {
        var entry = await EnterAsync("06ENG061", "hastane");
        Assert.Equal(GateDecision.Allowed, entry.Decision);
        Assert.Equal("HASTANE", entry.LotCode);
        Assert.Equal("P", entry.SuggestedZone); // P: 6 engelli, A: 4 engelli
        Assert.Equal("P01", entry.SuggestedSlot);

        // Diğer otoparkın özeti etkilenmez
        Assert.Equal(0, (await _t.Parking.GetSummaryAsync("GAZI")).Occupied);
        var hastane = await _t.Parking.GetSummaryAsync("HASTANE");
        Assert.Equal(1, hastane.Occupied);
        Assert.Equal(1, hastane.DisabledOccupied);
        Assert.Equal(50, hastane.Free);

        // Araç bulma: otopark parametresi gerekmez
        var located = await _t.Parking.LocateAsync("06ENG061");
        Assert.Equal("HASTANE", located.LotCode);
        Assert.Equal("Şehir Hastanesi Otoparkı", located.LotName);

        // Aynı araç başka otoparka giremez
        var again = await EnterAsync("06ENG061", "AVM");
        Assert.Equal(GateDecision.Denied, again.Decision);

        // Çıkış: açık oturum hangi otoparktaysa o kapanır (ücretsiz süre içinde)
        _t.Clock.Advance(TimeSpan.FromMinutes(5));
        var exit = await ExitAsync("06ENG061", "HASTANE");
        Assert.Equal(GateDecision.Allowed, exit.Decision);
    }

    // ======================= Rezervasyon =======================

    [Fact]
    public async Task Izinsiz_engelli_rezervasyonu_403_izinli_basarili()
    {
        var driverId = await DriverIdAsync();
        var start = _t.Now.AddHours(1);
        var end = _t.Now.AddHours(2);

        var ex = await Assert.ThrowsAsync<AppException>(() => _t.Reservations.CreateAsync(driverId,
            new CreateReservationRequest("06ABC123", "GAZI", "A", SlotType.Disabled, start, end)));
        Assert.Equal(403, ex.StatusCode);
        Assert.Equal("Engelli park yeri rezervasyonu için onaylı engelli izni gerekir", ex.Message);

        var ok = await _t.Reservations.CreateAsync(driverId,
            new CreateReservationRequest("06ENG061", "GAZI", "A", SlotType.Disabled, start, end));
        Assert.Equal(SlotType.Disabled, ok.SlotType);
        Assert.Equal("GAZI", ok.LotCode);
        Assert.Equal("A", ok.ZoneCode);

        // C bölgesinde engelli cep yok
        var quote = await _t.Reservations.QuoteAsync("GAZI", "C", SlotType.Disabled, start, end);
        Assert.False(quote.Available);

        // Bölge kodu otopark içinde aranır: HASTANE'nin A bölgesi (Acil) ayrı bir bölgedir
        var hastaneQuote = await _t.Reservations.QuoteAsync("HASTANE", "A", SlotType.Standard, start, end);
        Assert.True(hastaneQuote.Available);
        Assert.Contains("Acil", hastaneQuote.Message);
    }

    // ======================= İhlal tespiti =======================

    [Fact]
    public async Task Engelli_cep_izinsiz_dolunca_ihlal_acilir_bosalinca_kapanir()
    {
        var gazi = await _t.Parking.ResolveLotAsync("GAZI");

        var r1 = await CameraAsync(gazi, "A01", true);
        var opened = Assert.Single(r1.OpenedViolations);
        Assert.Equal("A01", opened.SlotCode);
        Assert.Equal("GAZI", opened.LotCode);
        Assert.Equal("A", opened.ZoneCode);
        Assert.Equal(ViolationStatus.Open, opened.Status);

        var violation = await _t.Db.Violations.SingleAsync();
        Assert.Equal(ViolationStatus.Open, violation.Status);
        Assert.True((await _t.Parking.GetSlotsAsync("GAZI")).Single(s => s.Code == "A01").HasViolation);
        Assert.True(await _t.Db.AuditLogs.AnyAsync(a => a.Action == "Engelli park yeri ihlali tespit edildi"));

        // Durum değişmeden tekrar bildirilirse yeni ihlal açılmaz (cep başına tek açık ihlal)
        var r2 = await CameraAsync(gazi, "A01", true);
        Assert.Empty(r2.OpenedViolations);
        Assert.Equal(1, await _t.Db.Violations.CountAsync());

        // Normal cep dolunca ihlal açılmaz
        var r3 = await CameraAsync(gazi, "B01", true);
        Assert.Empty(r3.OpenedViolations);

        // Cep boşalınca otomatik kapanır
        var r4 = await CameraAsync(gazi, "A01", false);
        var resolved = Assert.Single(r4.ResolvedViolations);
        Assert.Equal(ViolationStatus.Resolved, resolved.Status);

        var stored = await _t.Db.Violations.AsNoTracking().SingleAsync();
        Assert.Equal(ViolationStatus.Resolved, stored.Status);
        Assert.Equal("Araç ayrıldı", stored.Note);
        Assert.NotNull(stored.ResolvedAt);
        Assert.False((await _t.Parking.GetSlotsAsync("GAZI")).Single(s => s.Code == "A01").HasViolation);
    }

    [Fact]
    public async Task Izinli_arac_iceride_iken_engelli_cep_dolunca_ihlal_acilmaz()
    {
        var entry = await EnterAsync("06ENG061");
        Assert.Equal(GateDecision.Allowed, entry.Decision);

        var gazi = await _t.Parking.ResolveLotAsync("GAZI");
        var r1 = await CameraAsync(gazi, "A01", true);
        Assert.Empty(r1.OpenedViolations);
        Assert.Equal(0, await _t.Db.Violations.CountAsync());

        // İkinci engelli cep de dolarsa: dolu engelli (2) > içerideki izinli araç (1) → ihlal
        var r2 = await CameraAsync(gazi, "A02", true);
        Assert.Equal("A02", Assert.Single(r2.OpenedViolations).SlotCode);
    }

    [Fact]
    public async Task Iki_engelli_cep_ayni_anda_dolunca_yalnizca_fazlasi_kadar_ihlal_acilir()
    {
        // İçeride 1 izinli araç varken kamera A01 ve A02'yi AYNI güncellemede dolu bildirir:
        // yalnızca 1 ihlal açılmalı (2 dolu engelli cep − 1 izinli araç)
        await EnterAsync("06ENG061");
        var gazi = await _t.Parking.ResolveLotAsync("GAZI");
        var r = await _t.Parking.ApplySlotStatesAsync(gazi, new[]
        {
            ("A01", true, (double?)0.9),
            ("A02", true, (double?)0.9)
        });
        Assert.Single(r.OpenedViolations);
        Assert.Equal(1, await _t.Db.Violations.CountAsync());
    }

    [Fact]
    public async Task Baska_otoparktaki_izinli_arac_ihlali_engellemez()
    {
        await EnterAsync("06ENG061", "MERKEZ");
        var gazi = await _t.Parking.ResolveLotAsync("GAZI");
        var r = await CameraAsync(gazi, "A01", true);
        Assert.Single(r.OpenedViolations);
    }

    // ======================= İzin başvuruları =======================

    [Fact]
    public async Task Surucu_basvurusu_bekler_yonetici_onaylar_ve_gecerli_olur()
    {
        var driverId = await DriverIdAsync();

        // Sürücünün araçlarından biri olmayan plaka → 400
        var notOwned = await Assert.ThrowsAsync<AppException>(() =>
            _t.Permits.CreateAsync(driverId, new CreatePermitRequest("34XYZ987", "Ali Veli", "EK-1")));
        Assert.Equal(400, notOwned.StatusCode);

        // Zaten onaylı izni olan plaka → 409
        var dup = await Assert.ThrowsAsync<AppException>(() =>
            _t.Permits.CreateAsync(driverId, new CreatePermitRequest("06ENG061", "Ayşe Yılmaz", "EK-2")));
        Assert.Equal(409, dup.StatusCode);

        var created = await _t.Permits.CreateAsync(driverId, new CreatePermitRequest("06 abc 123", "Örnek Sürücü", "EK-2026-0099"));
        Assert.Equal(PermitStatus.Pending, created.Status);
        Assert.Equal("06ABC123", created.Plate);
        Assert.Equal("surucu@otopark.local", created.UserEmail);
        Assert.False(created.IsValid);

        // Bekleyen başvuru varken tekrar → 409
        var pendingDup = await Assert.ThrowsAsync<AppException>(() =>
            _t.Permits.CreateAsync(driverId, new CreatePermitRequest("06ABC123", "Örnek Sürücü", "EK-3")));
        Assert.Equal(409, pendingDup.StatusCode);

        var mine = await _t.Permits.GetMyAsync(driverId);
        Assert.Equal(2, mine.Count); // seed onaylı izin (06ENG061) + yeni başvuru

        Assert.False((await _t.Permits.CheckAsync("06ABC123")).Valid);
        var approved = await _t.Permits.AdminUpdateAsync(created.Id,
            new UpdatePermitRequest(PermitStatus.Approved, _t.Now.AddYears(1), "Belge görüldü"), "admin@otopark.local");
        Assert.Equal(PermitStatus.Approved, approved.Status);
        Assert.True(approved.IsValid);
        Assert.Equal("admin@otopark.local", approved.ReviewedBy);

        var check = await _t.Permits.CheckAsync("06 ABC 123");
        Assert.True(check.Valid);
        Assert.NotNull(check.Permit);

        // Yönetici listesi: seed bekleyen başvuru (34ENG034) görünür
        var pending = await _t.Permits.GetAllAsync("Pending");
        Assert.Contains(pending, p => p.Plate == "34ENG034" && p.UserId == null && p.HolderName == "Mehmet Demir");

        // İptal edilen izin geçersizdir
        await _t.Permits.AdminUpdateAsync(created.Id, new UpdatePermitRequest(PermitStatus.Revoked, null, null), "admin@otopark.local");
        Assert.False((await _t.Permits.CheckAsync("06ABC123")).Valid);
    }

    [Fact]
    public async Task Suresi_dolmus_izin_gecersizdir_ve_giris_izinsiz_sayilir()
    {
        var permit = await _t.Db.DisabledPermits.SingleAsync(p => p.Plate == "06ENG061");
        permit.ValidUntil = _t.Now.AddDays(-1);
        await _t.Db.SaveChangesAsync();

        Assert.False((await _t.Permits.CheckAsync("06ENG061")).Valid);
        await OccupyAllStandardAsync("GAZI");
        var entry = await EnterAsync("06ENG061");
        Assert.Equal(GateDecision.Denied, entry.Decision);
    }

    [Fact]
    public async Task Yonetici_dogrudan_izin_verir_bekleyen_basvuru_onaylanir()
    {
        var dto = await _t.Permits.AdminCreateAsync(
            new AdminCreatePermitRequest("34 ENG 034", "Mehmet Demir", "EK-2026-0002", _t.Now.AddMonths(6)), "admin@otopark.local");
        Assert.Equal(PermitStatus.Approved, dto.Status);
        Assert.True(dto.IsValid);
        Assert.Equal(0, await _t.Permits.CountPendingAsync());
        Assert.Equal(1, await _t.Db.DisabledPermits.CountAsync(p => p.Plate == "34ENG034"));

        var conflict = await Assert.ThrowsAsync<AppException>(() => _t.Permits.AdminCreateAsync(
            new AdminCreatePermitRequest("34ENG034", "Mehmet Demir", null, null), "admin@otopark.local"));
        Assert.Equal(409, conflict.StatusCode);
    }

    [Fact]
    public async Task Saklama_gorevi_engelli_izinlerine_dokunmaz()
    {
        await DataRetentionWorker.ApplyRetentionAsync(_t.Db, _t.Now.AddDays(400));
        var plates = await _t.Db.DisabledPermits.AsNoTracking().Select(p => p.Plate).ToListAsync();
        Assert.Contains("06ENG061", plates);
        Assert.Contains("34ENG034", plates);
    }
}
