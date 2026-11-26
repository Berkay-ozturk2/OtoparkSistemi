using Microsoft.EntityFrameworkCore;
using OtoparkSistemi.Api.Data;
using OtoparkSistemi.Api.Domain;
using OtoparkSistemi.Api.Dtos;

namespace OtoparkSistemi.Api.Services;

public class PaymentService(
    AppDbContext db,
    ParkingService parking,
    IPaymentProvider provider,
    AuditService audit,
    TimeProvider clock)
{
    private DateTime Now => clock.GetUtcNow().UtcDateTime;

    /// <summary>UC-03: plakaya göre ödenecek tutar (girişsiz).</summary>
    public async Task<PaymentQuoteDto> QuoteAsync(string plate, CancellationToken ct = default)
    {
        var normalized = PlateHelper.Normalize(plate);
        if (normalized.Length == 0) throw AppException.BadRequest("Plaka giriniz.");

        var session = await db.ParkingSessions.AsNoTracking()
                          .Include(s => s.Reservation)
                          .Where(s => s.Plate == normalized && s.Status == SessionStatus.Active)
                          .OrderByDescending(s => s.EntryTime)
                          .FirstOrDefaultAsync(ct)
                      ?? throw AppException.NotFound("Bu plakaya ait aktif park kaydı bulunamadı.");

        var now = Now;
        var ctx = await parking.GetFeeContextAsync(ct);
        var charge = parking.ComputeCharge(session, ctx, now);
        return new PaymentQuoteDto(session.Id, session.Plate, session.EntryTime,
            TimeHelper.MinutesBetween(session.EntryTime, now), charge.Due, session.IsPaid && charge.Due == 0m);
    }

    /// <summary>UC-03 / UC-04: kartla ödeme (oturum veya rezervasyon ön ödemesi).</summary>
    public async Task<PaymentResultDto> PayAsync(PayRequest request, CancellationToken ct = default)
    {
        if (request.SessionId.HasValue == request.ReservationId.HasValue)
            throw AppException.BadRequest("sessionId veya reservationId alanlarından yalnızca biri gönderilmelidir.");

        var cardRequest = request.Card;
        if (cardRequest == null || string.IsNullOrWhiteSpace(cardRequest.Number))
            throw AppException.BadRequest("Kart bilgileri eksik.");

        var now = Now;
        ParkingSession? session = null;
        Reservation? reservation = null;
        ChargeInfo? charge = null;
        decimal amount;
        string description;

        if (request.SessionId.HasValue)
        {
            var sessionId = request.SessionId.Value;
            session = await db.ParkingSessions.Include(s => s.Reservation)
                          .FirstOrDefaultAsync(s => s.Id == sessionId, ct)
                      ?? throw AppException.NotFound("Park kaydı bulunamadı.");
            if (session.Status != SessionStatus.Active)
                throw AppException.BadRequest("Bu park kaydı kapanmış; ödeme alınamaz.");

            var ctx = await parking.GetFeeContextAsync(ct);
            charge = parking.ComputeCharge(session, ctx, now);
            amount = charge.Due;
            if (amount <= 0m)
                throw AppException.BadRequest("Ödenecek tutar bulunmuyor.");
            description = $"Otopark ücreti - {session.Plate}";
        }
        else
        {
            var reservationId = request.ReservationId!.Value;
            reservation = await db.Reservations.FirstOrDefaultAsync(r => r.Id == reservationId, ct)
                          ?? throw AppException.NotFound("Rezervasyon bulunamadı.");
            if (reservation.Status != ReservationStatus.PendingPayment)
                throw AppException.BadRequest("Bu rezervasyon ödeme beklemiyor.");
            amount = reservation.Amount;
            description = $"Rezervasyon ön ödemesi - {reservation.Plate}";
        }

        var card = new CardInfo(cardRequest.HolderName, cardRequest.Number, cardRequest.ExpireMonth, cardRequest.ExpireYear, cardRequest.Cvc);
        var result = await provider.ChargeAsync(new PaymentChargeRequest(amount, card, description), ct);

        var payment = new Payment
        {
            Session = session,
            Reservation = reservation,
            Amount = amount,
            Method = PaymentMethod.Card,
            Status = result.Success ? PaymentStatus.Success : PaymentStatus.Failed,
            Provider = provider.Name,
            TransactionId = result.TransactionId,
            CardLast4 = CardHelper.Last4(cardRequest.Number), // yalnızca son 4 hane
            Message = result.Message,
            CreatedAt = now
        };
        db.Payments.Add(payment);

        if (result.Success)
        {
            if (session != null && charge != null)
                ApplySessionPayment(session, charge, amount, now);
            if (reservation != null)
            {
                reservation.Status = ReservationStatus.Confirmed;
                reservation.PaidAt = now;
            }
        }

        await db.SaveChangesAsync(ct);

        var target = session != null ? $"oturum #{session.Id}" : $"rezervasyon #{reservation?.Id}";
        await audit.LogAsync(result.Success ? "Kartla ödeme" : "Başarısız kart ödemesi",
            $"Ödeme #{payment.Id}, {target}, tutar {Money.Format(amount)} TL, kart **** {payment.CardLast4}", ct: ct);

        return new PaymentResultDto(payment.Id, payment.Status, amount, result.Message, result.TransactionId);
    }

    /// <summary>Gişe nakit ödemesi (operatör).</summary>
    public async Task<PaymentResultDto> CashPaymentAsync(int sessionId, string? operatorEmail, CancellationToken ct = default)
    {
        var session = await db.ParkingSessions.Include(s => s.Reservation)
                          .FirstOrDefaultAsync(s => s.Id == sessionId, ct)
                      ?? throw AppException.NotFound("Park kaydı bulunamadı.");
        if (session.Status != SessionStatus.Active)
            throw AppException.BadRequest("Bu park kaydı kapanmış; ödeme alınamaz.");

        var now = Now;
        var ctx = await parking.GetFeeContextAsync(ct);
        var charge = parking.ComputeCharge(session, ctx, now);
        var amount = charge.Due;
        if (amount <= 0m)
            throw AppException.BadRequest("Ödenecek tutar bulunmuyor.");

        var payment = new Payment
        {
            Session = session,
            Amount = amount,
            Method = PaymentMethod.Cash,
            Status = PaymentStatus.Success,
            Provider = "Gise",
            TransactionId = $"NAKIT-{now:yyyyMMddHHmmss}-{session.Id}",
            Message = "Nakit ödeme alındı.",
            CreatedBy = operatorEmail,
            CreatedAt = now
        };
        db.Payments.Add(payment);
        ApplySessionPayment(session, charge, amount, now);
        await db.SaveChangesAsync(ct);

        await audit.LogAsync("Nakit ödeme", $"Ödeme #{payment.Id}, oturum #{session.Id}, tutar {Money.Format(amount)} TL", operatorEmail, ct);
        return new PaymentResultDto(payment.Id, payment.Status, amount, $"Nakit ödeme alındı: {Money.Format(amount)} TL", payment.TransactionId);
    }

    private static void ApplySessionPayment(ParkingSession session, ChargeInfo charge, decimal amount, DateTime now)
    {
        session.PaidAmount += amount;
        session.IsPaid = true;
        session.PaidAt = now;
        session.Fee = charge.NetFee;
    }
}
