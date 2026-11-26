using Microsoft.EntityFrameworkCore;
using OtoparkSistemi.Api.Data;
using OtoparkSistemi.Api.Domain;
using OtoparkSistemi.Api.Dtos;

namespace OtoparkSistemi.Api.Services;

/// <summary>Bariyer kararı girdisi. Kamera olayı, manuel giriş/çıkış ve onay kuyruğu aynı yolu kullanır.</summary>
public record GateInput(
    string? CameraId,
    GateType Gate,
    string? Plate,
    double Confidence,
    bool FormatValid,
    bool IsManual,
    string? ImageBase64 = null,
    DateTime? CapturedAt = null,
    string? OperatorEmail = null,
    string? LotCode = null);

/// <summary>Giriş/çıkış karar mantığı (API sözleşmesi bölüm 3 ve 11.2).</summary>
public class GateService(AppDbContext db, ParkingService parking, IRealtimeNotifier notifier, TimeProvider clock)
{
    /// <summary>Kaydedilen görüntü kırpıntısı için üst sınır (karakter). Aşılırsa görüntü saklanmaz.</summary>
    public const int MaxImageLength = 2_000_000;

    private sealed record Outcome(
        GateDecision Decision,
        string Message,
        ParkingSession? Session = null,
        string? SuggestedZone = null,
        decimal Fee = 0m,
        bool StateChanged = false,
        string? SuggestedSlot = null,
        bool IsDisabledPermit = false,
        ParkingLot? StateLot = null,
        SlotType? SlotType = null);

    public async Task<GateDecisionResponse> ProcessAsync(GateInput input, CancellationToken ct = default)
    {
        var now = clock.GetUtcNow().UtcDateTime;
        // lotCode yoksa GAZI; bilinmeyen kod → 404 "Otopark bulunamadı"
        var lot = await parking.ResolveLotAsync(input.LotCode, ct);
        var settings = await parking.GetSettingsAsync(ct);
        var plate = PlateHelper.Normalize(input.Plate);
        var confidence = double.IsNaN(input.Confidence) ? 0d : Math.Clamp(input.Confidence, 0d, 1d);
        var cameraId = string.IsNullOrWhiteSpace(input.CameraId)
            ? (input.IsManual ? "manuel" : "bilinmiyor")
            : Truncate(input.CameraId.Trim(), 50);

        Outcome outcome;
        if (plate.Length == 0)
        {
            outcome = input.IsManual
                ? new Outcome(GateDecision.Denied, "Geçerli bir plaka giriniz.")
                : new Outcome(GateDecision.PendingReview, "Plaka okunamadı; görevli onayı bekleniyor.");
        }
        else if (!input.IsManual && (confidence < settings.ConfidenceThreshold || !input.FormatValid))
        {
            // Düşük güven veya TR biçimine uymayan okuma → operatör onay kuyruğu (UC-07)
            outcome = new Outcome(GateDecision.PendingReview, "Plaka okuması doğrulanamadı; görevli onayı bekleniyor.");
        }
        else if (input.Gate == GateType.Entry)
        {
            outcome = await DecideEntryAsync(lot, plate, input.IsManual, now, ct);
        }
        else
        {
            outcome = await DecideExitAsync(plate, input.IsManual, now, ct);
        }

        var storedPlate = plate.Length > 0 ? Truncate(plate, 32) : Truncate((input.Plate ?? string.Empty).Trim(), 32);
        var image = input.ImageBase64 != null && input.ImageBase64.Length <= MaxImageLength ? input.ImageBase64 : null;

        var ev = new GateEvent
        {
            LotCode = lot.Code,
            CameraId = cameraId,
            Gate = input.Gate,
            Plate = storedPlate,
            Confidence = confidence,
            FormatValid = input.FormatValid,
            Decision = outcome.Decision,
            Message = outcome.Message,
            IsManual = input.IsManual,
            Session = outcome.Session,
            SuggestedZone = outcome.SuggestedZone,
            SuggestedSlot = outcome.SuggestedSlot,
            SuggestedSlotType = outcome.SlotType,
            IsDisabledPermit = outcome.IsDisabledPermit,
            Fee = outcome.Fee,
            ImageBase64 = image,
            CapturedAt = input.CapturedAt.HasValue ? TimeHelper.AsUtc(input.CapturedAt.Value) : null,
            CreatedAt = now,
            OperatorEmail = input.OperatorEmail
        };
        db.GateEvents.Add(ev);

        var isReview = outcome.Decision == GateDecision.PendingReview;
        if (isReview)
        {
            db.PlateReviews.Add(new PlateReview
            {
                GateEvent = ev,
                LotCode = lot.Code,
                CameraId = cameraId,
                Gate = input.Gate,
                PlateRead = storedPlate,
                Confidence = confidence,
                Status = ReviewStatus.Pending,
                CreatedAt = now
            });
        }

        await db.SaveChangesAsync(ct);

        await notifier.GateEventAsync(ToBroadcast(ev));
        if (isReview)
            await notifier.ReviewQueueChangedAsync(await CountPendingReviewsAsync(ct), lot.Code);
        if (outcome.StateChanged)
        {
            // Çıkışta oturumun bulunduğu otoparkın özeti güncellenir
            var stateLot = outcome.StateLot ?? lot;
            await notifier.SummaryUpdatedAsync((await parking.GetLotSnapshotAsync(stateLot, ct)).ToSummary());
        }

        return new GateDecisionResponse(ev.Id, ev.Decision, ev.Message, ev.SessionId, ev.SuggestedZone, ev.Fee,
            ev.SuggestedSlot, ev.IsDisabledPermit, ev.LotCode, ev.SuggestedSlotType);
    }

    /// <summary>Onay kuyruğundaki kaydı sonuçlandırır. Onaylanırsa aynı karar fonksiyonu isManual=true ile çalışır.</summary>
    public async Task<GateDecisionResponse> ResolveReviewAsync(int reviewId, string? correctedPlate, bool approve, string? operatorEmail, CancellationToken ct = default)
    {
        var review = await db.PlateReviews.Include(r => r.GateEvent).FirstOrDefaultAsync(r => r.Id == reviewId, ct)
                     ?? throw AppException.NotFound("Onay kaydı bulunamadı.");
        if (review.Status != ReviewStatus.Pending)
            throw AppException.BadRequest("Bu kayıt zaten sonuçlandırılmış.");

        var now = clock.GetUtcNow().UtcDateTime;
        review.ResolvedAt = now;
        review.ResolvedBy = operatorEmail;

        if (!approve)
        {
            review.Status = ReviewStatus.Rejected;
            if (review.GateEvent != null)
            {
                review.GateEvent.Decision = GateDecision.Denied;
                review.GateEvent.Message = "Görevli tarafından reddedildi.";
            }
            await db.SaveChangesAsync(ct);
            await notifier.ReviewQueueChangedAsync(await CountPendingReviewsAsync(ct), review.LotCode);
            return new GateDecisionResponse(review.GateEventId, GateDecision.Denied, "Geçiş görevli tarafından reddedildi.", null, null, 0m,
                null, false, review.LotCode);
        }

        var plate = PlateHelper.Normalize(string.IsNullOrWhiteSpace(correctedPlate) ? review.PlateRead : correctedPlate);
        if (plate.Length == 0)
            throw AppException.BadRequest("Onay için geçerli bir plaka giriniz.");

        review.Status = ReviewStatus.Approved;
        review.CorrectedPlate = plate;
        await db.SaveChangesAsync(ct);

        var result = await ProcessAsync(new GateInput(
            review.CameraId, review.Gate, plate, review.Confidence, FormatValid: true, IsManual: true,
            ImageBase64: null, CapturedAt: review.GateEvent?.CapturedAt, OperatorEmail: operatorEmail,
            LotCode: review.LotCode), ct);

        await notifier.ReviewQueueChangedAsync(await CountPendingReviewsAsync(ct), review.LotCode);
        return result;
    }

    public Task<int> CountPendingReviewsAsync(CancellationToken ct = default) =>
        db.PlateReviews.CountAsync(r => r.Status == ReviewStatus.Pending, ct);

    public static GateEventBroadcastDto ToBroadcast(GateEvent e) =>
        new(e.Id, e.CameraId, e.Gate, e.Plate, e.Confidence, e.Decision, e.Message, e.IsManual, e.CreatedAt,
            e.SessionId, e.SuggestedZone, e.Fee, e.Decision == GateDecision.Allowed ? "AÇIK" : "KAPALI",
            e.LotCode, e.IsDisabledPermit, e.SuggestedSlot, e.SuggestedSlotType);

    // ---------------- Giriş ----------------

    private async Task<Outcome> DecideEntryAsync(ParkingLot lot, string plate, bool isManual, DateTime now, CancellationToken ct)
    {
        // Bir araç aynı anda yalnızca bir otoparkta olabilir
        var alreadyInside = await db.ParkingSessions
            .AnyAsync(s => s.Plate == plate && s.Status == SessionStatus.Active, ct);
        if (alreadyInside)
            return new Outcome(GateDecision.Denied, "Araç zaten içeride.");

        if (!lot.IsActive)
            return new Outcome(GateDecision.Denied, "Bu otopark şu anda hizmet dışı.");

        var hasPermit = await PermitRules.HasValidPermitAsync(db, plate, now, ct);
        var lotId = lot.Id;

        // Aktif rezervasyon (bu otoparkta): başlangıçtan 30 dk önce ile bitiş arası
        var windowStart = now.AddMinutes(ParkingService.ReservationEarlyArrivalMinutes);
        var reservation = await db.Reservations
            .Include(r => r.Zone)
            .Where(r => r.Plate == plate
                        && r.Status == ReservationStatus.Confirmed
                        && r.StartTime <= windowStart
                        && r.EndTime > now
                        && r.Zone!.LotId == lotId)
            .OrderBy(r => r.StartTime)
            .FirstOrDefaultAsync(ct);

        if (reservation != null)
        {
            reservation.Status = ReservationStatus.CheckedIn;
            var reservedSession = new ParkingSession
            {
                Plate = plate,
                LotId = lotId,
                ZoneId = reservation.ZoneId,
                Reservation = reservation,
                EntryTime = now,
                Status = SessionStatus.Active,
                IsManualEntry = isManual,
                IsDisabledPermit = hasPermit
            };
            db.ParkingSessions.Add(reservedSession);
            var code = reservation.Zone?.Code;
            string? reservedSlot = null;
            if (reservation.SlotType == SlotType.Disabled)
            {
                var snap = await parking.GetLotSnapshotAsync(lot, ct);
                var zoneState = snap.Zones.FirstOrDefault(z => z.Zone.Id == reservation.ZoneId);
                // Rezervasyon için ayrılan cep de boş sayılır; önce ayrılmamış boş engelli cep, yoksa ayrılmış olan
                reservedSlot = zoneState == null
                    ? null
                    : OccupancySnapshot.FirstFreeSlotCode(zoneState, SlotType.Disabled)
                      ?? zoneState.Slots
                          .Where(x => x.IsActive && x.Type == SlotType.Disabled && !x.IsOccupied)
                          .OrderBy(x => x.Code, StringComparer.Ordinal)
                          .Select(x => x.Code)
                          .FirstOrDefault();
            }
            var reservedMessage = reservedSlot != null
                ? $"Hoş geldiniz. Rezervasyonunuz bulundu. Bölge: {code}, engelli park yeri: {reservedSlot}"
                : $"Hoş geldiniz. Rezervasyonunuz bulundu. Bölge: {code}";
            return new Outcome(GateDecision.Allowed, reservedMessage, reservedSession, code, 0m, true,
                reservedSlot, hasPermit, SlotType: reservedSlot != null ? (SlotType?)SlotType.Disabled : null);
        }

        var snapshot = await parking.GetLotSnapshotAsync(lot, ct);

        // Kapasite ayrımı: normal araç için boş = boş Standard; izinli araç için boş = boş Standard + boş Disabled
        if (hasPermit)
        {
            if (snapshot.FreeForPermitHolders <= 0)
                return new Outcome(GateDecision.Denied, "Otopark dolu. Boş yer bulunmuyor.", IsDisabledPermit: true);
        }
        else if (snapshot.Standard.Free <= 0)
        {
            return snapshot.Disabled.Free > 0
                ? new Outcome(GateDecision.Denied, "Otopark dolu. Kalan yerler engelli araçlara ayrılmıştır.")
                : new Outcome(GateDecision.Denied, "Otopark dolu. Boş yer bulunmuyor.");
        }

        // İzinli araçta öneri: boş engelli cebi olan bölge (yoksa normal öneri)
        var rec = snapshot.Recommend(disabled: hasPermit);
        var session = new ParkingSession
        {
            Plate = plate,
            LotId = lotId,
            ZoneId = rec?.Zone.Zone.Id,
            EntryTime = now,
            Status = SessionStatus.Active,
            IsManualEntry = isManual,
            IsDisabledPermit = hasPermit
        };
        db.ParkingSessions.Add(session);

        var zoneCode = rec?.Zone.Zone.Code;
        // suggestedSlot: önerilen bölgedeki ilk boş cep (izinli araçta engelli cep), slotType: o cebin türü
        var suggestedSlot = rec?.SlotCode;
        SlotType? suggestedType = rec?.SlotType;
        string message;
        if (rec == null)
            message = "Hoş geldiniz.";
        else if (rec.SlotType == SlotType.Disabled && suggestedSlot != null)
            message = $"Hoş geldiniz. Önerilen bölge: {zoneCode} (engelli park yeri {suggestedSlot})";
        else
            message = $"Hoş geldiniz. Önerilen bölge: {zoneCode}";

        return new Outcome(GateDecision.Allowed, message, session, zoneCode, 0m, true, suggestedSlot, hasPermit,
            SlotType: suggestedType);
    }

    // ---------------- Çıkış ----------------

    private async Task<Outcome> DecideExitAsync(string plate, bool isManual, DateTime now, CancellationToken ct)
    {
        // Plakanın açık oturumu hangi otoparktaysa o kapanır (bir araç tek otoparkta olabilir)
        var session = await db.ParkingSessions
            .Include(s => s.Reservation)
            .Include(s => s.Zone)
            .Include(s => s.Lot)
            .Where(s => s.Plate == plate && s.Status == SessionStatus.Active)
            .OrderByDescending(s => s.EntryTime)
            .FirstOrDefaultAsync(ct);

        if (session == null)
        {
            return isManual
                ? new Outcome(GateDecision.Denied, "Araç içeride bulunamadı.")
                : new Outcome(GateDecision.PendingReview, "Bu plakaya ait açık kayıt yok; görevli kontrolü gerekli.");
        }

        var ctx = await parking.GetFeeContextAsync(ct);
        var charge = parking.ComputeCharge(session, ctx, now);

        if (charge.Due > 0m)
        {
            return new Outcome(GateDecision.Denied,
                $"Ödeme gerekli: {Money.Format(charge.Due)} TL",
                session, session.Zone?.Code, charge.Due, false, IsDisabledPermit: session.IsDisabledPermit);
        }

        // Ücret yok veya ödenmiş (grace süresi içinde) → çıkış
        session.ExitTime = now;
        session.Status = SessionStatus.Completed;
        session.Fee = charge.WithinGrace ? session.PaidAmount : charge.NetFee;
        session.IsPaid = true; // borç kalmadı
        if (session.Reservation != null && session.Reservation.Status == ReservationStatus.CheckedIn)
            session.Reservation.Status = ReservationStatus.Completed;

        return new Outcome(GateDecision.Allowed, "Çıkış onaylandı. İyi yolculuklar.", session, session.Zone?.Code, 0m, true,
            IsDisabledPermit: session.IsDisabledPermit, StateLot: session.Lot);
    }

    private static string Truncate(string value, int max) => value.Length <= max ? value : value.Substring(0, max);
}
